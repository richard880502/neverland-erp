import { randomUUID } from "crypto";
import type { MovementType, Prisma } from "@prisma/client";
import { processGoogleSheetProductQueue } from "@/lib/google-sheet-product-queue";
import { getGoogleSheetConnectionSetting, getGoogleSheetsApiClient, getGoogleSheetSyncConfig } from "@/lib/google-sheet-source";
import { prisma } from "@/lib/prisma";

export type MovementEventSpec = {
  label: string;
  warehouse: number;
  consignment: number;
  sold: number;
  defect: number;
};

export const movementEventSpecs: Record<MovementType, MovementEventSpec> = {
  RECEIVE: { label: "進貨", warehouse: 1, consignment: 0, sold: 0, defect: 0 },
  SHIP: { label: "出貨", warehouse: -1, consignment: 0, sold: 1, defect: 0 },
  SALES_RETURN: { label: "銷貨退回", warehouse: 1, consignment: 0, sold: -1, defect: 0 },
  PURCHASE_RETURN: { label: "進貨退出", warehouse: -1, consignment: 0, sold: 0, defect: 0 },
  CONSIGN_OUT: { label: "寄賣出貨", warehouse: -1, consignment: 1, sold: 0, defect: 0 },
  CONSIGN_RETURN: { label: "寄賣退回", warehouse: 1, consignment: -1, sold: 0, defect: 0 },
  CONSIGN_SOLD: { label: "寄賣售出", warehouse: 0, consignment: -1, sold: 1, defect: 0 },
  BUYOUT: { label: "買斷", warehouse: -1, consignment: 0, sold: 1, defect: 0 },
  DEFECT: { label: "蝦疵", warehouse: -1, consignment: 0, sold: 0, defect: 1 },
  ADJUSTMENT: { label: "庫存調整", warehouse: 1, consignment: 0, sold: 0, defect: 0 },
};

const movementLabels = Object.fromEntries(
  Object.entries(movementEventSpecs).map(([type, spec]) => [type, spec.label]),
) as Record<MovementType, string>;
const eventMasterHeaders = ["事件", "倉庫係數", "寄賣係數", "已售係數", "蝦疵係數"];
const outboundHeaders = ["ERP異動ID", "成交單價", "單號", "備註", "同步時間"];
const inventoryDataCheckFormula = "=MAP(B2:B,C2:C,D2:D,E2:E,F2:F,G2:G,LAMBDA(sku,channel,channelType,event,qty,productName,IF(AND(sku=\"\",channel=\"\",event=\"\",qty=\"\"),\"\",IF(OR(sku=\"\",channel=\"\",event=\"\",qty=\"\"),\"資料不完整\",IF(COUNTIF('事件主檔'!A2:A,event)=0,\"未知事件\",IF(OR(productName=\"\",channelType=\"\"),\"請檢查主檔\",\"OK\")))))))";

type SheetsClient = ReturnType<typeof getGoogleSheetsApiClient>;

export async function enqueueGoogleSheetMovement(tx: Prisma.TransactionClient, movementId: string) {
  return tx.googleSheetMovementQueue.create({ data: { movementId } });
}

type QueueMovement = Prisma.GoogleSheetMovementQueueGetPayload<{
  include: {
    movement: {
      include: {
        product: { select: { sku: true } };
        channel: { select: { name: true } };
      };
    };
  };
}>;

function dateInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const data = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${data.year}/${data.month}/${data.day}`;
}

function eventMasterRow(spec: MovementEventSpec) {
  return [spec.label, spec.warehouse, spec.consignment, spec.sold, spec.defect];
}

function sameCoefficient(value: unknown, expected: number) {
  if (value === "" || value == null) return false;
  return Number(value) === expected;
}

async function ensureMovementEventMaster(sheets: SheetsClient, spreadsheetId: string) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))",
  });
  const target = metadata.data.sheets?.find((sheet) => sheet.properties?.title === "事件主檔")?.properties;
  if (target?.sheetId == null) throw new Error("Google Sheet 缺少「事件主檔」工作表");
  if ((target.gridProperties?.columnCount ?? 0) < 5) throw new Error("「事件主檔」欄位不足，至少需要 A:E");

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'事件主檔'!A1:E",
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = response.data.values ?? [];
  const headers = (rows[0] ?? []).map((value) => String(value ?? "").trim());
  const hasHeaders = headers.some(Boolean);
  if (hasHeaders && eventMasterHeaders.some((header, index) => headers[index] !== header)) {
    throw new Error("「事件主檔」A:E 欄位名稱與 ERP 預期不一致");
  }
  if (!hasHeaders) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "'事件主檔'!A1:E1",
      valueInputOption: "RAW",
      requestBody: { values: [eventMasterHeaders] },
    });
  }

  const rowsByLabel = new Map<string, { row: number; values: unknown[] }>();
  for (let index = 1; index < rows.length; index += 1) {
    const label = String(rows[index]?.[0] ?? "").trim();
    if (!label) continue;
    if (rowsByLabel.has(label)) throw new Error(`「事件主檔」事件重複：${label}`);
    rowsByLabel.set(label, { row: index + 1, values: rows[index] ?? [] });
  }

  const missing: MovementEventSpec[] = [];
  for (const spec of Object.values(movementEventSpecs)) {
    const existing = rowsByLabel.get(spec.label);
    if (!existing) {
      missing.push(spec);
      continue;
    }
    const values = existing.values;
    const coefficients = [spec.warehouse, spec.consignment, spec.sold, spec.defect];
    const mismatch = coefficients.some((expected, index) => !sameCoefficient(values[index + 1], expected));
    if (mismatch) {
      throw new Error(`「事件主檔」${spec.label} 的庫存係數與 ERP 不一致，已停止同步避免庫存被算錯`);
    }
  }

  if (missing.length > 0) {
    const firstNewRow = Math.max(2, rows.length + 1);
    const lastNewRow = firstNewRow + missing.length - 1;
    if (lastNewRow > (target.gridProperties?.rowCount ?? 0)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            appendDimension: {
              sheetId: target.sheetId,
              dimension: "ROWS",
              length: lastNewRow - (target.gridProperties?.rowCount ?? 0),
            },
          }],
        },
      });
    }
    if (rows.length >= 2) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: missing.map((_, index) => ({
            copyPaste: {
              source: { sheetId: target.sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 5 },
              destination: { sheetId: target.sheetId, startRowIndex: firstNewRow - 1 + index, endRowIndex: firstNewRow + index, startColumnIndex: 0, endColumnIndex: 5 },
              pasteType: "PASTE_FORMAT",
              pasteOrientation: "NORMAL",
            },
          })),
        },
      });
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'事件主檔'!A${firstNewRow}:E${lastNewRow}`,
      valueInputOption: "RAW",
      requestBody: { values: missing.map(eventMasterRow) },
    });
  }

  const verification = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'事件主檔'!A2:E",
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const verifiedRows = new Map(
    (verification.data.values ?? [])
      .filter((row) => String(row?.[0] ?? "").trim())
      .map((row) => [String(row?.[0] ?? "").trim(), row]),
  );
  for (const spec of Object.values(movementEventSpecs)) {
    const row = verifiedRows.get(spec.label);
    if (!row) throw new Error(`「事件主檔」缺少事件：${spec.label}`);
    const coefficients = [spec.warehouse, spec.consignment, spec.sold, spec.defect];
    if (coefficients.some((expected, index) => !sameCoefficient(row[index + 1], expected))) {
      throw new Error(`「事件主檔」${spec.label} 驗證失敗，已停止同步`);
    }
  }
}

async function ensureMovementDataCheckFormula(sheets: SheetsClient, spreadsheetId: string) {
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'庫存異動'!M2",
    valueRenderOption: "FORMULA",
  });
  const formula = String(current.data.values?.[0]?.[0] ?? "");
  if (formula === inventoryDataCheckFormula) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "'庫存異動'!M2",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[inventoryDataCheckFormula]] },
  });
}

async function writeMovementsToGoogleSheet(spreadsheetId: string, timeZone: string, entries: QueueMovement[]) {
  const sheets = getGoogleSheetsApiClient(true);
  await ensureMovementEventMaster(sheets, spreadsheetId);
  await ensureMovementDataCheckFormula(sheets, spreadsheetId);

  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))" });
  const target = metadata.data.sheets?.find((sheet) => sheet.properties?.title === "庫存異動")?.properties;
  if (target?.sheetId == null) throw new Error("Google Sheet 缺少「庫存異動」工作表");
  if ((target.gridProperties?.columnCount ?? 0) < 18) throw new Error("「庫存異動」欄位不足，至少需要 A:R");

  const values = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ["'庫存異動'!A1:A", "'庫存異動'!N1:R"], majorDimension: "ROWS", valueRenderOption: "UNFORMATTED_VALUE" });
  const aValues = values.data.valueRanges?.[0]?.values ?? [];
  const outboundValues = values.data.valueRanges?.[1]?.values ?? [];
  const currentHeaders = (outboundValues[0] ?? []).map((value) => String(value ?? "").trim());
  const nonEmptyHeaders = currentHeaders.filter(Boolean);
  if (nonEmptyHeaders.length && outboundHeaders.some((header, index) => currentHeaders[index] !== header)) throw new Error("「庫存異動」N:R 已有其他欄位，無法安全建立 ERP 同步欄位");
  if (!nonEmptyHeaders.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ copyPaste: { source: { sheetId: target.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 12, endColumnIndex: 13 }, destination: { sheetId: target.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 13, endColumnIndex: 18 }, pasteType: "PASTE_FORMAT", pasteOrientation: "NORMAL" } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId, range: "'庫存異動'!N1:R1", valueInputOption: "RAW", requestBody: { values: [outboundHeaders] } });
  }

  const existingIds = new Map<string, number>();
  for (let index = 1; index < outboundValues.length; index += 1) {
    const id = String(outboundValues[index]?.[0] ?? "").trim();
    if (id) existingIds.set(id, index + 1);
  }
  const results = new Map<string, number>();
  const pending = entries.filter((entry) => {
    const existingRow = existingIds.get(entry.movementId);
    if (existingRow) results.set(entry.movementId, existingRow);
    return !existingRow;
  });
  if (!pending.length) return results;

  const startRow = aValues.length + 1;
  const endRow = startRow + pending.length - 1;
  if (endRow > (target.gridProperties?.rowCount ?? 0)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ appendDimension: { sheetId: target.sheetId, dimension: "ROWS", length: endRow - (target.gridProperties?.rowCount ?? 0) } }] } });
  }

  const syncedAt = new Date();
  const abc = pending.map((entry) => [dateInTimeZone(entry.movement.occurredAt, timeZone), entry.movement.product.sku, entry.movement.channel?.name ?? "初始化"]);
  const ef = pending.map((entry) => [movementLabels[entry.movement.type], entry.movement.quantity]);
  const nr = pending.map((entry) => [entry.movementId, entry.movement.unitPrice == null ? "" : Number(entry.movement.unitPrice), entry.movement.referenceNo ?? "", entry.movement.note ?? "", syncedAt.toISOString()]);

  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "USER_ENTERED", data: [
    { range: `'庫存異動'!A${startRow}:C${endRow}`, majorDimension: "ROWS", values: abc },
    { range: `'庫存異動'!E${startRow}:F${endRow}`, majorDimension: "ROWS", values: ef },
    { range: `'庫存異動'!N${startRow}:R${endRow}`, majorDimension: "ROWS", values: nr },
  ] } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    { copyPaste: { source: { sheetId: target.sheetId, startRowIndex: startRow - 1, endRowIndex: endRow, startColumnIndex: 12, endColumnIndex: 13 }, destination: { sheetId: target.sheetId, startRowIndex: startRow - 1, endRowIndex: endRow, startColumnIndex: 13, endColumnIndex: 18 }, pasteType: "PASTE_FORMAT", pasteOrientation: "NORMAL" } },
    { repeatCell: { range: { sheetId: target.sheetId, startRowIndex: startRow - 1, endRowIndex: endRow, startColumnIndex: 5, endColumnIndex: 6 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0" } } }, fields: "userEnteredFormat.numberFormat" } },
  ] } });

  const verification = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'庫存異動'!N${startRow}:N${endRow}`, valueRenderOption: "UNFORMATTED_VALUE" });
  const verifiedIds = verification.data.values ?? [];
  pending.forEach((entry, index) => {
    if (String(verifiedIds[index]?.[0] ?? "") !== entry.movementId) throw new Error(`Google Sheet 寫入驗證失敗：${entry.movementId}`);
    results.set(entry.movementId, startRow + index);
  });
  return results;
}

export async function processGoogleSheetMovementQueue(limit = 100) {
  // Product master must land first so a newly created SKU is visible to the Sheet
  // summary formulas before any movement for that SKU is appended.
  const productQueue = await processGoogleSheetProductQueue(limit);
  const config = getGoogleSheetSyncConfig();
  const connection = await getGoogleSheetConnectionSetting();
  await prisma.googleSheetMovementQueue.updateMany({ where: { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { status: "FAILED", processingToken: null, lastError: "上次同步程序中斷，已重新排入等待區", nextAttemptAt: new Date() } });
  const pendingCount = await prisma.googleSheetMovementQueue.count({ where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 10 } } });
  if (!config.hasCredentials) return { processed: 0, failed: 0, pending: pendingCount, demo: true, message: "目前是本地 Demo；Queue 已保留，設定可寫入的 Service Account 後才會送出", productQueue };

  const processingToken = randomUUID();
  const candidates = await prisma.googleSheetMovementQueue.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 10 }, nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: Math.min(Math.max(limit, 1), 100), select: { id: true } });
  if (!candidates.length) return { processed: 0, failed: 0, pending: pendingCount, demo: false, productQueue };
  await prisma.googleSheetMovementQueue.updateMany({ where: { id: { in: candidates.map((item) => item.id) }, status: { in: ["PENDING", "FAILED"] } }, data: { status: "PROCESSING", processingToken, lastError: null } });
  const claimed = await prisma.googleSheetMovementQueue.findMany({ where: { processingToken }, include: { movement: { include: { product: { select: { sku: true } }, channel: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } });
  if (!claimed.length) return { processed: 0, failed: 0, pending: pendingCount, demo: false, productQueue };

  try {
    const sheetRows = await writeMovementsToGoogleSheet(connection.spreadsheetId, connection.syncTimeZone, claimed);
    const syncedAt = new Date();
    await prisma.$transaction(claimed.map((item) => prisma.googleSheetMovementQueue.update({ where: { id: item.id }, data: { status: "SYNCED", attempts: { increment: 1 }, processingToken: null, spreadsheetId: connection.spreadsheetId, sheetRow: sheetRows.get(item.movementId) ?? null, syncedAt, lastError: null } })));
    return { processed: claimed.length, failed: 0, pending: Math.max(0, pendingCount - claimed.length), demo: false, productQueue };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Sheet 庫存異動同步失敗";
    const retryAt = new Date(Date.now() + 15 * 60_000);
    await prisma.googleSheetMovementQueue.updateMany({ where: { processingToken }, data: { status: "FAILED", attempts: { increment: 1 }, processingToken: null, lastError: message.slice(0, 1000), nextAttemptAt: retryAt } });
    return { processed: 0, failed: claimed.length, pending: pendingCount, demo: false, message, productQueue };
  }
}

export async function getGoogleSheetMovementQueueSummary() {
  const [counts, recent] = await Promise.all([
    prisma.googleSheetMovementQueue.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.googleSheetMovementQueue.findMany({ include: { movement: { include: { product: { select: { sku: true, name: true } }, channel: { select: { name: true } } } } }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return { counts: Object.fromEntries(counts.map((item) => [item.status, item._count._all])), recent };
}

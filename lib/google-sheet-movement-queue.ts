import { randomUUID } from "crypto";
import type { MovementType, Prisma } from "@prisma/client";
import { getGoogleSheetConnectionSetting, getGoogleSheetsApiClient, getGoogleSheetSyncConfig } from "@/lib/google-sheet-source";
import { prisma } from "@/lib/prisma";

const movementLabels: Record<MovementType, string> = {
  RECEIVE: "進貨",
  SHIP: "出貨",
  SALES_RETURN: "銷貨退回",
  PURCHASE_RETURN: "進貨退出",
  CONSIGN_OUT: "寄賣出貨",
  CONSIGN_RETURN: "寄賣退回",
  CONSIGN_SOLD: "寄賣售出",
  BUYOUT: "買斷",
  DEFECT: "蝦疵",
  ADJUSTMENT: "庫存調整",
};
const outboundHeaders = ["ERP異動ID", "成交單價", "單號", "備註", "同步時間"];

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

async function writeMovementsToGoogleSheet(spreadsheetId: string, timeZone: string, entries: QueueMovement[]) {
  const sheets = getGoogleSheetsApiClient(true);
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))" });
  const target = metadata.data.sheets?.find((sheet) => sheet.properties?.title === "庫存異動")?.properties;
  if (!target?.sheetId) throw new Error("Google Sheet 缺少「庫存異動」工作表");
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
  for (const entry of pending) if (entry.movement.type === "ADJUSTMENT") throw new Error(`異動 ${entry.movementId} 是庫存調整，原試算表尚未支援此事件`);

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
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ copyPaste: { source: { sheetId: target.sheetId, startRowIndex: startRow - 1, endRowIndex: endRow, startColumnIndex: 12, endColumnIndex: 13 }, destination: { sheetId: target.sheetId, startRowIndex: startRow - 1, endRowIndex: endRow, startColumnIndex: 13, endColumnIndex: 18 }, pasteType: "PASTE_FORMAT", pasteOrientation: "NORMAL" } }] } });

  const verification = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'庫存異動'!N${startRow}:N${endRow}`, valueRenderOption: "UNFORMATTED_VALUE" });
  const verifiedIds = verification.data.values ?? [];
  pending.forEach((entry, index) => {
    if (String(verifiedIds[index]?.[0] ?? "") !== entry.movementId) throw new Error(`Google Sheet 寫入驗證失敗：${entry.movementId}`);
    results.set(entry.movementId, startRow + index);
  });
  return results;
}

export async function processGoogleSheetMovementQueue(limit = 100) {
  const config = getGoogleSheetSyncConfig();
  const connection = await getGoogleSheetConnectionSetting();
  await prisma.googleSheetMovementQueue.updateMany({ where: { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { status: "FAILED", processingToken: null, lastError: "上次同步程序中斷，已重新排入等待區", nextAttemptAt: new Date() } });
  const pendingCount = await prisma.googleSheetMovementQueue.count({ where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 10 } } });
  if (!config.hasCredentials) return { processed: 0, failed: 0, pending: pendingCount, demo: true, message: "目前是本地 Demo；Queue 已保留，設定可寫入的 Service Account 後才會送出" };

  const processingToken = randomUUID();
  const candidates = await prisma.googleSheetMovementQueue.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 10 }, nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: Math.min(Math.max(limit, 1), 100), select: { id: true } });
  if (!candidates.length) return { processed: 0, failed: 0, pending: pendingCount, demo: false };
  await prisma.googleSheetMovementQueue.updateMany({ where: { id: { in: candidates.map((item) => item.id) }, status: { in: ["PENDING", "FAILED"] } }, data: { status: "PROCESSING", processingToken, lastError: null } });
  const claimed = await prisma.googleSheetMovementQueue.findMany({ where: { processingToken }, include: { movement: { include: { product: { select: { sku: true } }, channel: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } });
  if (!claimed.length) return { processed: 0, failed: 0, pending: pendingCount, demo: false };

  try {
    const sheetRows = await writeMovementsToGoogleSheet(connection.spreadsheetId, connection.syncTimeZone, claimed);
    const syncedAt = new Date();
    await prisma.$transaction(claimed.map((item) => prisma.googleSheetMovementQueue.update({ where: { id: item.id }, data: { status: "SYNCED", attempts: { increment: 1 }, processingToken: null, spreadsheetId: connection.spreadsheetId, sheetRow: sheetRows.get(item.movementId) ?? null, syncedAt, lastError: null } })));
    return { processed: claimed.length, failed: 0, pending: Math.max(0, pendingCount - claimed.length), demo: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Sheet 庫存異動同步失敗";
    const retryAt = new Date(Date.now() + 15 * 60_000);
    await prisma.googleSheetMovementQueue.updateMany({ where: { processingToken }, data: { status: "FAILED", attempts: { increment: 1 }, processingToken: null, lastError: message.slice(0, 1000), nextAttemptAt: retryAt } });
    return { processed: 0, failed: claimed.length, pending: pendingCount, demo: false, message };
  }
}

export async function getGoogleSheetMovementQueueSummary() {
  const [counts, recent] = await Promise.all([
    prisma.googleSheetMovementQueue.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.googleSheetMovementQueue.findMany({ include: { movement: { include: { product: { select: { sku: true, name: true } }, channel: { select: { name: true } } } } }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return { counts: Object.fromEntries(counts.map((item) => [item.status, item._count._all])), recent };
}

import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { getGoogleSheetConnectionSetting, getGoogleSheetsApiClient, getGoogleSheetSyncConfig } from "@/lib/google-sheet-source";
import { prisma } from "@/lib/prisma";

export type GoogleSheetProductOperation = "UPSERT" | "DELETE";

export async function enqueueGoogleSheetProduct(tx: Prisma.TransactionClient, product: { id: string; sku: string }, operation: GoogleSheetProductOperation = "UPSERT") {
  return tx.googleSheetProductQueue.create({ data: { productId: product.id, sku: product.sku, operation } });
}

export async function enqueueGoogleSheetProductBackfill() {
  const connection = await getGoogleSheetConnectionSetting();
  const [products, queued] = await Promise.all([
    prisma.product.findMany({
      where: { googleSheetQueues: { none: { spreadsheetId: connection.spreadsheetId, catalogSheetRow: { not: null }, status: "SYNCED" } } },
      select: { id: true, sku: true },
    }),
    prisma.googleSheetProductQueue.findMany({ where: { status: { in: ["PENDING", "PROCESSING", "FAILED"] } }, select: { sku: true } }),
  ]);
  const queuedSkus = new Set(queued.map((item) => item.sku));
  const pending = products.filter((product) => !queuedSkus.has(product.sku));
  if (pending.length) await prisma.googleSheetProductQueue.createMany({ data: pending.map((product) => ({ productId: product.id, sku: product.sku, operation: "UPSERT" })) });
  return { queued: pending.length, alreadyQueued: products.length - pending.length };
}

/**
 * An administrator-requested run retries failures immediately.
 *
 * Automatic delivery keeps its retry ceiling so a persistent configuration
 * problem cannot loop forever. A manual retry is intentionally different:
 * an administrator may have corrected the Sheet layout or credentials after
 * an item reached that ceiling, so reset its attempt count and let it run.
 */
export async function retryGoogleSheetProductQueue() {
  return prisma.googleSheetProductQueue.updateMany({
    where: { status: "FAILED" },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), processingToken: null, lastError: null },
  });
}

type QueueEntry = { id: string; sku: string; operation: string };
type CurrentProduct = { sku: string; name: string; size: string | null; safetyStock: number; listPrice: number | null; wholesalePrice: number | null; unitCost: number | null; description: string | null };
type CatalogRow = { row: number; skus: string[] };
type SheetRows = { master: number | null; catalog: number | null };
type SheetTarget = { sheetId: number; rowCount: number };
type RangeWrite = { range: string; majorDimension: "ROWS"; values: Array<Array<string | number>> };

async function ensureRows(spreadsheetId: string, target: SheetTarget, lastRow: number) {
  if (lastRow <= target.rowCount) return;
  const sheets = getGoogleSheetsApiClient(true);
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ appendDimension: { sheetId: target.sheetId, dimension: "ROWS", length: lastRow - target.rowCount } }] } });
}

async function copyRowFormat(spreadsheetId: string, target: SheetTarget, rows: number[], endColumnIndex: number) {
  if (!rows.length) return;
  const sheets = getGoogleSheetsApiClient(true);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: rows.map((row) => ({ copyPaste: {
      source: { sheetId: target.sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex },
      destination: { sheetId: target.sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 1, endColumnIndex },
      pasteType: "PASTE_FORMAT", pasteOrientation: "NORMAL",
    } })) },
  });
}

async function writeProductsToGoogleSheet(spreadsheetId: string, entries: QueueEntry[], currentProducts: Map<string, CurrentProduct>) {
  const sheets = getGoogleSheetsApiClient(true);
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))" });
  const properties = metadata.data.sheets?.map((sheet) => sheet.properties).filter((item): item is NonNullable<typeof item> => Boolean(item)) ?? [];
  const masterProperties = properties.find((sheet) => sheet.title === "商品主檔");
  const catalogProperties = properties.find((sheet) => sheet.title === "商品總覽");
  if (masterProperties?.sheetId == null || catalogProperties?.sheetId == null) throw new Error("Google Sheet 缺少「商品主檔」或「商品總覽」工作表");
  if ((masterProperties.gridProperties?.columnCount ?? 0) < 5 || (catalogProperties.gridProperties?.columnCount ?? 0) < 8) throw new Error("商品主檔或商品總覽欄位不足");
  const master: SheetTarget = { sheetId: masterProperties.sheetId, rowCount: masterProperties.gridProperties?.rowCount ?? 0 };
  const catalog: SheetTarget = { sheetId: catalogProperties.sheetId, rowCount: catalogProperties.gridProperties?.rowCount ?? 0 };
  const [masterResponse, catalogResponse] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: "'商品主檔'!B2:E", majorDimension: "ROWS", valueRenderOption: "UNFORMATTED_VALUE" }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "'商品總覽'!B2:H", majorDimension: "ROWS", valueRenderOption: "UNFORMATTED_VALUE" }),
  ]);
  const masterRows = masterResponse.data.values ?? [];
  const catalogRows = catalogResponse.data.values ?? [];
  // 商品總覽曾被人工維護成以商品名稱取代 SKU。Outbox 只需要定位本次
  // ERP 要寫入的 SKU；忽略不在本批次中的舊格式資料，不能讓它阻塞新品同步。
  const queuedSkus = new Set(entries.map((entry) => entry.sku));
  const masterBySku = new Map<string, number>();
  masterRows.forEach((row, index) => {
    const sku = String(row[0] ?? "").trim();
    if (!sku || !queuedSkus.has(sku) || masterBySku.has(sku)) return;
    masterBySku.set(sku, index + 2);
  });
  const catalogBySku = new Map<string, CatalogRow>();
  catalogRows.forEach((row, index) => {
    const skus = String(row[0] ?? "").trim().split(/\s+/).filter(Boolean);
    const catalogRow = { row: index + 2, skus };
    for (const sku of skus) {
      if (!queuedSkus.has(sku) || catalogBySku.has(sku)) continue;
      catalogBySku.set(sku, catalogRow);
    }
  });

  let nextMasterRow = masterRows.length + 2;
  let nextCatalogRow = catalogRows.length + 2;
  const resultRows = new Map<string, SheetRows>();
  const masterWrites: RangeWrite[] = [];
  const catalogWrites: RangeWrite[] = [];
  const masterClears: string[] = [];
  const catalogClears: string[] = [];
  const newMasterRows: number[] = [];
  const newCatalogRows: number[] = [];

  for (const entry of entries) {
    const current = currentProducts.get(entry.sku);
    let masterRow = masterBySku.get(entry.sku) ?? null;
    let catalogRow = catalogBySku.get(entry.sku) ?? null;
    if (current) {
      if (!masterRow) {
        masterRow = nextMasterRow++;
        masterBySku.set(current.sku, masterRow);
        newMasterRows.push(masterRow);
      }
      if (!catalogRow) {
        catalogRow = { row: nextCatalogRow++, skus: [current.sku] };
        catalogBySku.set(current.sku, catalogRow);
        newCatalogRows.push(catalogRow.row);
      }
      masterWrites.push({ range: `'商品主檔'!B${masterRow}:E${masterRow}`, majorDimension: "ROWS", values: [[current.sku, current.name, current.size ?? "", current.safetyStock]] });
      catalogWrites.push({ range: `'商品總覽'!B${catalogRow.row}:C${catalogRow.row}`, majorDimension: "ROWS", values: [[catalogRow.skus.join(" "), current.name]] });
      catalogWrites.push({ range: `'商品總覽'!E${catalogRow.row}:H${catalogRow.row}`, majorDimension: "ROWS", values: [[current.listPrice ?? "", current.wholesalePrice ?? "", current.unitCost ?? "", current.description ?? ""]] });
      resultRows.set(entry.id, { master: masterRow, catalog: catalogRow.row });
      continue;
    }

    if (masterRow) {
      masterClears.push(`'商品主檔'!B${masterRow}:E${masterRow}`);
      masterBySku.delete(entry.sku);
    }
    if (catalogRow) {
      const remainingSkus = catalogRow.skus.filter((sku) => sku !== entry.sku);
      catalogBySku.delete(entry.sku);
      if (remainingSkus.length) {
        catalogRow.skus = remainingSkus;
        catalogWrites.push({ range: `'商品總覽'!B${catalogRow.row}`, majorDimension: "ROWS", values: [[remainingSkus.join(" ")]] });
      } else {
        catalogClears.push(`'商品總覽'!B${catalogRow.row}:H${catalogRow.row}`);
      }
    }
    resultRows.set(entry.id, { master: masterRow, catalog: catalogRow?.row ?? null });
  }

  await Promise.all([ensureRows(spreadsheetId, master, Math.max(1, nextMasterRow - 1)), ensureRows(spreadsheetId, catalog, Math.max(1, nextCatalogRow - 1))]);
  await Promise.all([copyRowFormat(spreadsheetId, master, newMasterRows, 5), copyRowFormat(spreadsheetId, catalog, newCatalogRows, 8)]);
  if (masterWrites.length || catalogWrites.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [...masterWrites, ...catalogWrites] } });
  if (masterClears.length || catalogClears.length) await sheets.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges: [...masterClears, ...catalogClears] } });

  const verificationRanges: string[] = [];
  const expectations: string[] = [];
  for (const entry of entries) {
    const current = currentProducts.get(entry.sku);
    const rows = resultRows.get(entry.id);
    if (!current || !rows?.master || !rows.catalog) continue;
    verificationRanges.push(`'商品主檔'!B${rows.master}:B${rows.master}`, `'商品總覽'!B${rows.catalog}:B${rows.catalog}`);
    expectations.push(current.sku);
  }
  if (verificationRanges.length) {
    const verification = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: verificationRanges, valueRenderOption: "UNFORMATTED_VALUE" });
    expectations.forEach((sku, index) => {
      const masterSku = String(verification.data.valueRanges?.[index * 2]?.values?.[0]?.[0] ?? "").trim();
      const catalogSkus = String(verification.data.valueRanges?.[index * 2 + 1]?.values?.[0]?.[0] ?? "").trim().split(/\s+/);
      if (masterSku !== sku || !catalogSkus.includes(sku)) throw new Error(`Google Sheet 商品寫入驗證失敗：${sku}`);
    });
  }
  return resultRows;
}

export async function processGoogleSheetProductQueue(limit = 100) {
  const config = getGoogleSheetSyncConfig();
  const connection = await getGoogleSheetConnectionSetting();
  await prisma.googleSheetProductQueue.updateMany({ where: { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { status: "FAILED", processingToken: null, lastError: "上次同步程序中斷，已重新排入等待區", nextAttemptAt: new Date() } });
  const pendingCount = await prisma.googleSheetProductQueue.count({ where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 10 } } });
  if (!config.hasCredentials) return { processed: 0, failed: 0, pending: pendingCount, demo: true, message: "目前是本地 Demo；商品 Queue 已保留，設定可寫入的 Service Account 後才會送出" };
  const processingToken = randomUUID();
  const candidates = await prisma.googleSheetProductQueue.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 10 }, nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: Math.min(Math.max(limit, 1), 100), select: { id: true } });
  if (!candidates.length) return { processed: 0, failed: 0, pending: pendingCount, demo: false };
  await prisma.googleSheetProductQueue.updateMany({ where: { id: { in: candidates.map((item) => item.id) }, status: { in: ["PENDING", "FAILED"] } }, data: { status: "PROCESSING", processingToken, lastError: null } });
  const claimed = await prisma.googleSheetProductQueue.findMany({ where: { processingToken }, orderBy: { createdAt: "asc" } });
  if (!claimed.length) return { processed: 0, failed: 0, pending: pendingCount, demo: false };
  try {
    const products = await prisma.product.findMany({ where: { sku: { in: [...new Set(claimed.map((item) => item.sku))] } }, select: { sku: true, name: true, size: true, safetyStock: true, listPrice: true, wholesalePrice: true, unitCost: true, description: true } });
    const currentProducts = new Map(products.map((product) => [product.sku, { sku: product.sku, name: product.name, size: product.size, safetyStock: product.safetyStock, listPrice: product.listPrice == null ? null : Number(product.listPrice), wholesalePrice: product.wholesalePrice == null ? null : Number(product.wholesalePrice), unitCost: product.unitCost == null ? null : Number(product.unitCost), description: product.description }]));
    const sheetRows = await writeProductsToGoogleSheet(connection.spreadsheetId, claimed, currentProducts);
    const syncedAt = new Date();
    await prisma.$transaction(claimed.map((item) => prisma.googleSheetProductQueue.update({ where: { id: item.id }, data: { status: "SYNCED", attempts: { increment: 1 }, processingToken: null, spreadsheetId: connection.spreadsheetId, sheetRow: sheetRows.get(item.id)?.master ?? null, catalogSheetRow: sheetRows.get(item.id)?.catalog ?? null, syncedAt, lastError: null } })));
    return { processed: claimed.length, failed: 0, pending: Math.max(0, pendingCount - claimed.length), demo: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Sheet 商品主檔同步失敗";
    const retryAt = new Date(Date.now() + 15 * 60_000);
    await prisma.googleSheetProductQueue.updateMany({ where: { processingToken }, data: { status: "FAILED", attempts: { increment: 1 }, processingToken: null, lastError: message.slice(0, 1000), nextAttemptAt: retryAt } });
    return { processed: 0, failed: claimed.length, pending: pendingCount, demo: false, message };
  }
}

export async function getGoogleSheetProductQueueSummary() {
  const [counts, recent] = await Promise.all([
    prisma.googleSheetProductQueue.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.googleSheetProductQueue.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return { counts: Object.fromEntries(counts.map((item) => [item.status, item._count._all])), recent };
}

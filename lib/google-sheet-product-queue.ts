import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { getGoogleSheetConnectionSetting, getGoogleSheetsApiClient, getGoogleSheetSyncConfig } from "@/lib/google-sheet-source";
import { prisma } from "@/lib/prisma";

export type GoogleSheetProductOperation = "UPSERT" | "DELETE";

export async function enqueueGoogleSheetProduct(
  tx: Prisma.TransactionClient,
  product: { id: string; sku: string },
  operation: GoogleSheetProductOperation = "UPSERT",
) {
  return tx.googleSheetProductQueue.create({
    data: {
      productId: product.id,
      sku: product.sku,
      operation,
    },
  });
}

type QueueEntry = Prisma.GoogleSheetProductQueueGetPayload<{}>;
type CurrentProduct = { sku: string; name: string; size: string | null; safetyStock: number };

async function writeProductsToGoogleSheet(
  spreadsheetId: string,
  entries: QueueEntry[],
  currentProducts: Map<string, CurrentProduct>,
) {
  const sheets = getGoogleSheetsApiClient(true);
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))",
  });
  const target = metadata.data.sheets?.find((sheet) => sheet.properties?.title === "商品主檔")?.properties;
  if (!target?.sheetId) throw new Error("Google Sheet 缺少「商品主檔」工作表");
  if ((target.gridProperties?.columnCount ?? 0) < 5) throw new Error("「商品主檔」欄位不足，至少需要 A:E");

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'商品主檔'!B2:E",
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = response.data.values ?? [];
  const existingRows = new Map<string, number>();
  for (let index = 0; index < rows.length; index += 1) {
    const sku = String(rows[index]?.[0] ?? "").trim();
    if (!sku) continue;
    if (existingRows.has(sku)) throw new Error(`「商品主檔」SKU 重複：${sku}`);
    existingRows.set(sku, index + 2);
  }

  let nextRow = rows.length + 2;
  const resultRows = new Map<string, number | null>();
  const writes: Array<{ range: string; majorDimension: "ROWS"; values: Array<Array<string | number>> }> = [];
  const clears: string[] = [];
  const newRows: number[] = [];

  for (const entry of entries) {
    const current = currentProducts.get(entry.sku);
    const existingRow = existingRows.get(entry.sku);

    // A deleted SKU may be recreated before an older DELETE job runs. In that case,
    // always prefer the current ERP product so a stale queue item can never erase it.
    if (current) {
      const row = existingRow ?? nextRow++;
      if (!existingRow) {
        existingRows.set(entry.sku, row);
        newRows.push(row);
      }
      writes.push({
        range: `'商品主檔'!B${row}:E${row}`,
        majorDimension: "ROWS",
        values: [[current.sku, current.name, current.size ?? "", current.safetyStock]],
      });
      resultRows.set(entry.id, row);
      continue;
    }

    if (entry.operation === "DELETE") {
      if (existingRow) {
        clears.push(`'商品主檔'!B${existingRow}:E${existingRow}`);
        existingRows.delete(entry.sku);
        resultRows.set(entry.id, existingRow);
      } else {
        resultRows.set(entry.id, null);
      }
      continue;
    }

    // If an UPSERT reaches the worker after the product was deleted, remove any stale
    // Sheet row instead of resurrecting data from the queue snapshot.
    if (existingRow) {
      clears.push(`'商品主檔'!B${existingRow}:E${existingRow}`);
      existingRows.delete(entry.sku);
      resultRows.set(entry.id, existingRow);
    } else {
      resultRows.set(entry.id, null);
    }
  }

  const requiredLastRow = Math.max(1, nextRow - 1);
  if (requiredLastRow > (target.gridProperties?.rowCount ?? 0)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          appendDimension: {
            sheetId: target.sheetId,
            dimension: "ROWS",
            length: requiredLastRow - (target.gridProperties?.rowCount ?? 0),
          },
        }],
      },
    });
  }

  if (newRows.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: newRows.map((row) => ({
          copyPaste: {
            source: { sheetId: target.sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 5 },
            destination: { sheetId: target.sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 1, endColumnIndex: 5 },
            pasteType: "PASTE_FORMAT",
            pasteOrientation: "NORMAL",
          },
        })),
      },
    });
  }

  if (writes.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: writes },
    });
  }
  if (clears.length > 0) {
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId,
      requestBody: { ranges: clears },
    });
  }

  const verificationRanges = entries.flatMap((entry) => {
    const row = resultRows.get(entry.id);
    return row ? [`'商品主檔'!B${row}:E${row}`] : [];
  });
  const verification = verificationRanges.length > 0
    ? await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: verificationRanges, valueRenderOption: "UNFORMATTED_VALUE" })
    : null;
  let verificationIndex = 0;
  for (const entry of entries) {
    const row = resultRows.get(entry.id);
    if (!row) continue;
    const values = verification?.data.valueRanges?.[verificationIndex]?.values?.[0] ?? [];
    verificationIndex += 1;
    const current = currentProducts.get(entry.sku);
    if (current) {
      if (String(values[0] ?? "").trim() !== current.sku) throw new Error(`Google Sheet 商品主檔寫入驗證失敗：${current.sku}`);
      if (String(values[1] ?? "") !== current.name) throw new Error(`Google Sheet 商品名稱寫入驗證失敗：${current.sku}`);
    } else if (String(values[0] ?? "").trim()) {
      throw new Error(`Google Sheet 商品主檔刪除驗證失敗：${entry.sku}`);
    }
  }

  return resultRows;
}

export async function processGoogleSheetProductQueue(limit = 100) {
  const config = getGoogleSheetSyncConfig();
  const connection = await getGoogleSheetConnectionSetting();
  await prisma.googleSheetProductQueue.updateMany({
    where: { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    data: { status: "FAILED", processingToken: null, lastError: "上次同步程序中斷，已重新排入等待區", nextAttemptAt: new Date() },
  });
  const pendingCount = await prisma.googleSheetProductQueue.count({
    where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 10 } },
  });
  if (!config.hasCredentials) {
    return { processed: 0, failed: 0, pending: pendingCount, demo: true, message: "目前是本地 Demo；商品 Queue 已保留，設定可寫入的 Service Account 後才會送出" };
  }

  const processingToken = randomUUID();
  const candidates = await prisma.googleSheetProductQueue.findMany({
    where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 10 }, nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: { id: true },
  });
  if (!candidates.length) return { processed: 0, failed: 0, pending: pendingCount, demo: false };

  await prisma.googleSheetProductQueue.updateMany({
    where: { id: { in: candidates.map((item) => item.id) }, status: { in: ["PENDING", "FAILED"] } },
    data: { status: "PROCESSING", processingToken, lastError: null },
  });
  const claimed = await prisma.googleSheetProductQueue.findMany({
    where: { processingToken },
    orderBy: { createdAt: "asc" },
  });
  if (!claimed.length) return { processed: 0, failed: 0, pending: pendingCount, demo: false };

  try {
    const products = await prisma.product.findMany({
      where: { sku: { in: [...new Set(claimed.map((item) => item.sku))] } },
      select: { sku: true, name: true, size: true, safetyStock: true },
    });
    const currentProducts = new Map(products.map((product) => [product.sku, product]));
    const sheetRows = await writeProductsToGoogleSheet(connection.spreadsheetId, claimed, currentProducts);
    const syncedAt = new Date();
    await prisma.$transaction(claimed.map((item) => prisma.googleSheetProductQueue.update({
      where: { id: item.id },
      data: {
        status: "SYNCED",
        attempts: { increment: 1 },
        processingToken: null,
        spreadsheetId: connection.spreadsheetId,
        sheetRow: sheetRows.get(item.id) ?? null,
        syncedAt,
        lastError: null,
      },
    })));
    return { processed: claimed.length, failed: 0, pending: Math.max(0, pendingCount - claimed.length), demo: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Sheet 商品主檔同步失敗";
    const retryAt = new Date(Date.now() + 15 * 60_000);
    await prisma.googleSheetProductQueue.updateMany({
      where: { processingToken },
      data: { status: "FAILED", attempts: { increment: 1 }, processingToken: null, lastError: message.slice(0, 1000), nextAttemptAt: retryAt },
    });
    return { processed: 0, failed: claimed.length, pending: pendingCount, demo: false, message };
  }
}

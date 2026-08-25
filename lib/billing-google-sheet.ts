import { prisma } from "@/lib/prisma";
import { getGoogleSheetsApiClient } from "@/lib/google-sheet-source";

const DEFAULT_BILLING_SPREADSHEET_ID = "1FTvHytDhqSqsDIY_2VnEmDXYNBuSujSgBIrHpa4c4WU";
const DEFAULT_TEMPLATE_SHEET_NAME = "範本";
const BASE_ITEM_START_ROW = 13;
const BASE_ITEM_END_ROW = 27;
const BASE_PAYMENT_ROW = 29;

function taipeiDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function quoteSheetName(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function numberLabel(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function getConfig() {
  return {
    spreadsheetId: process.env.GOOGLE_BILLING_SHEET_ID || DEFAULT_BILLING_SPREADSHEET_ID,
    templateSheetName: process.env.GOOGLE_BILLING_TEMPLATE_SHEET_NAME || DEFAULT_TEMPLATE_SHEET_NAME,
  };
}

export async function openBillingGoogleSheet(statementId: string, actorUserId: string) {
  const statement = await prisma.billingStatement.findUnique({
    where: { id: statementId },
    include: {
      channel: true,
      items: { orderBy: { sku: "asc" } },
    },
  });
  if (!statement) throw new Error("找不到請款單");

  const { spreadsheetId, templateSheetName } = getConfig();
  const sheets = getGoogleSheetsApiClient(true);
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "spreadsheetId,sheets(properties(sheetId,title,index))",
  });
  const workbookSheets = metadata.data.sheets ?? [];
  const targetSheetName = statement.statementNo.slice(0, 100);
  const existing = workbookSheets.find((sheet) => sheet.properties?.title === targetSheetName)?.properties;
  if (existing?.sheetId != null) {
    return {
      created: false,
      sheetId: existing.sheetId,
      sheetName: targetSheetName,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${existing.sheetId}`,
    };
  }

  const template = workbookSheets.find((sheet) => sheet.properties?.title === templateSheetName)?.properties;
  if (template?.sheetId == null) throw new Error(`Google 請款單找不到「${templateSheetName}」公版頁籤`);

  let createdSheetId: number | null = null;
  try {
    const duplicated = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            duplicateSheet: {
              sourceSheetId: template.sheetId,
              insertSheetIndex: (template.index ?? 0) + 1,
              newSheetName: targetSheetName,
            },
          },
        ],
      },
    });
    createdSheetId = duplicated.data.replies?.[0]?.duplicateSheet?.properties?.sheetId ?? null;
    if (createdSheetId == null) throw new Error("Google Sheet 公版複製失敗");

    const extraRows = Math.max(0, statement.items.length - (BASE_ITEM_END_ROW - BASE_ITEM_START_ROW + 1));
    if (extraRows > 0) {
      const insertedStartIndex = BASE_ITEM_END_ROW; // before Excel/Sheets row 28
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: {
                  sheetId: createdSheetId,
                  dimension: "ROWS",
                  startIndex: insertedStartIndex,
                  endIndex: insertedStartIndex + extraRows,
                },
                inheritFromBefore: true,
              },
            },
            {
              copyPaste: {
                source: {
                  sheetId: createdSheetId,
                  startRowIndex: BASE_ITEM_END_ROW - 1,
                  endRowIndex: BASE_ITEM_END_ROW,
                  startColumnIndex: 0,
                  endColumnIndex: 9,
                },
                destination: {
                  sheetId: createdSheetId,
                  startRowIndex: insertedStartIndex,
                  endRowIndex: insertedStartIndex + extraRows,
                  startColumnIndex: 0,
                  endColumnIndex: 9,
                },
                pasteType: "PASTE_FORMAT",
                pasteOrientation: "NORMAL",
              },
            },
            ...Array.from({ length: extraRows }, (_, index) => ({
              mergeCells: {
                range: {
                  sheetId: createdSheetId!,
                  startRowIndex: insertedStartIndex + index,
                  endRowIndex: insertedStartIndex + index + 1,
                  startColumnIndex: 1,
                  endColumnIndex: 5,
                },
                mergeType: "MERGE_ALL",
              },
            })),
          ],
        },
      });
    }

    const itemEndRow = BASE_ITEM_END_ROW + extraRows;
    const paymentRow = BASE_PAYMENT_ROW + extraRows;
    const totalRow = paymentRow + 1;
    const partyRow = paymentRow + 4;
    const rangeSheetName = quoteSheetName(targetSheetName);

    await sheets.spreadsheets.values.batchClear({
      spreadsheetId,
      requestBody: {
        ranges: [
          `${rangeSheetName}!A${BASE_ITEM_START_ROW}:A${itemEndRow}`,
          `${rangeSheetName}!B${BASE_ITEM_START_ROW}:B${itemEndRow}`,
          `${rangeSheetName}!F${BASE_ITEM_START_ROW}:I${itemEndRow}`,
        ],
      },
    });

    const itemRows = statement.items.map((item, index) => {
      const row = BASE_ITEM_START_ROW + index;
      const name = item.size && !item.productName.includes(item.size)
        ? `${item.productName} ${item.size}`
        : item.productName;
      return {
        row,
        sku: item.sku,
        name,
        listPrice: Number(item.listPrice),
        settlementPrice: Number(item.settlementPrice),
        quantity: item.quantity,
      };
    });

    const settlementRate = Number(statement.settlementRate);
    const taxRate = Number(statement.taxRate);
    const sourceLabel = statement.sourceType === "CONSIGNMENT" ? "經銷寄賣" : "經銷買斷";
    const documentPeriod = `${taipeiDate(statement.issuedAt)}\n${taipeiDate(statement.periodStart)} ~ ${taipeiDate(statement.periodEnd)}`;

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: [
          { range: `${rangeSheetName}!B6`, values: [[documentPeriod]] },
          { range: `${rangeSheetName}!F6`, values: [[`${sourceLabel}${numberLabel(settlementRate * 10)}折稅外加`]] },
          { range: `${rangeSheetName}!B8`, values: [[statement.companyName || statement.channel.name]] },
          { range: `${rangeSheetName}!F8`, values: [[statement.taxId || ""]] },
          { range: `${rangeSheetName}!B9`, values: [[statement.contactName || ""]] },
          { range: `${rangeSheetName}!F9`, values: [[statement.contactEmail || ""]] },
          { range: `${rangeSheetName}!B10`, values: [[statement.billingAddress || ""]] },
          { range: `${rangeSheetName}!F10`, values: [[statement.contactPhone || ""]] },
          ...(itemRows.length ? [
            { range: `${rangeSheetName}!A${BASE_ITEM_START_ROW}:A${BASE_ITEM_START_ROW + itemRows.length - 1}`, values: itemRows.map((item) => [item.sku]) },
            { range: `${rangeSheetName}!B${BASE_ITEM_START_ROW}:B${BASE_ITEM_START_ROW + itemRows.length - 1}`, values: itemRows.map((item) => [item.name]) },
            {
              range: `${rangeSheetName}!F${BASE_ITEM_START_ROW}:I${BASE_ITEM_START_ROW + itemRows.length - 1}`,
              values: itemRows.map((item) => [
                item.listPrice,
                item.settlementPrice,
                item.quantity,
                `=G${item.row}*H${item.row}`,
              ]),
            },
          ] : []),
          { range: `${rangeSheetName}!B${paymentRow}`, values: [[`=SUM(I${BASE_ITEM_START_ROW}:I${itemEndRow})`]] },
          { range: `${rangeSheetName}!D${paymentRow}`, values: [[`營業稅（${numberLabel(taxRate * 100)}%)`]] },
          { range: `${rangeSheetName}!E${paymentRow}`, values: [[`=B${paymentRow}*${taxRate}`]] },
          { range: `${rangeSheetName}!H${paymentRow}`, values: [[Number(statement.shippingFee)]] },
          { range: `${rangeSheetName}!B${totalRow}`, values: [[`=B${paymentRow}+E${paymentRow}+H${paymentRow}`]] },
          { range: `${rangeSheetName}!F${partyRow}`, values: [[statement.companyName || statement.channel.name]] },
        ],
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: "BILLING_GOOGLE_SHEET_CREATED",
        entityType: "BillingStatement",
        entityId: statement.id,
        metadata: {
          statementNo: statement.statementNo,
          spreadsheetId,
          sheetId: createdSheetId,
          sheetName: targetSheetName,
        },
      },
    });

    return {
      created: true,
      sheetId: createdSheetId,
      sheetName: targetSheetName,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${createdSheetId}`,
    };
  } catch (error) {
    if (createdSheetId != null) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ deleteSheet: { sheetId: createdSheetId } }] },
      }).catch(() => undefined);
    }
    const status = (error as { code?: number })?.code;
    if (status === 403) {
      throw new Error("Google 請款單沒有寫入權限；請把 Neverland請款單 分享給目前 ERP 的 Service Account 並設為編輯者");
    }
    throw error;
  }
}

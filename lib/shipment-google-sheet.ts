import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getGoogleSheetsApiClient } from "@/lib/google-sheet-source";

// The template contract reserves A:AY for ERP data and BA:BB for ownership.
// Human notes belong in BC or farther right and are never cleared by ERP.
const MARKER = "NEVERLAND_SHIPMENT_TEMPLATE_V1";
function quote(name: string) { return `'${name.replace(/'/g, "''")}'`; }
function day(date: Date | null) { return date ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date) : ""; }

export async function renderShipmentSheet(id: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    // A transaction-scoped lock serializes retries, including remote tab creation.
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`shipment-sheet:${id}`}))::text`);
    const shipment = await tx.shipment.findUnique({ where: { id }, include: { channel: true, lines: true } });
    if (!shipment) throw new Error("找不到出貨單");
    const spreadsheetId = shipment.sheetSpreadsheetId ?? shipment.channel.shippingWorkbookId;
    const templateName = shipment.channel.shippingTemplateTab;
    if (!spreadsheetId || !templateName) throw new Error("請先為通路設定專用出貨工作簿與 V1 範本頁籤");
    const sheets = getGoogleSheetsApiClient(true);
    const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))" });
    const all = metadata.data.sheets ?? [];
    const template = all.find((s) => s.properties?.title === templateName)?.properties;
    if (template?.sheetId == null) throw new Error("找不到通路設定的出貨範本頁籤");
    const templateValues = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: [`${quote(templateName)}!BA1`, `${quote(templateName)}!A2:G2`] });
    const marker = templateValues.data.valueRanges?.[0]?.values?.[0]?.[0];
    const headers = templateValues.data.valueRanges?.[1]?.values?.[0] ?? [];
    if (marker !== MARKER || ["品項", "S", "M", "L", "XL", "2XL", "F"].some((v, i) => headers[i] !== v)) throw new Error("出貨範本格式不符 V1 規格，請檢查標記與標題");
    const tabName = shipment.sheetTabName ?? `SHIP-${shipment.id}`;
    let tab = all.find((s) => s.properties?.title === tabName)?.properties;
    if (shipment.sheetTabId != null && (!tab || tab.sheetId !== shipment.sheetTabId)) throw new Error("已連結的出貨頁籤不存在或識別碼不符");
    if (!tab) {
      const copied = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ duplicateSheet: { sourceSheetId: template.sheetId, newSheetName: tabName } }] } });
      tab = copied.data.replies?.[0]?.duplicateSheet?.properties;
      const refreshed = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))" });
      tab = refreshed.data.sheets?.find((s) => s.properties?.title === tabName)?.properties ?? tab;
    }
    if (tab?.sheetId == null) throw new Error("無法建立出貨頁籤");
    const ownership = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: [`${quote(tabName)}!BA1:BA2`] });
    const ownerValues = ownership.data.valueRanges?.[0]?.values ?? [];
    if (ownerValues[0]?.[0] !== MARKER || (ownerValues[1]?.[0] && ownerValues[1][0] !== id)) throw new Error("出貨頁籤識別標記不符，已停止更新");
    const standard = ["S", "M", "L", "XL", "2XL", "F"];
    const extras = [...new Set(shipment.lines.map((line) => line.size?.trim() || "未標示").filter((size) => !standard.includes(size)))].sort();
    const sizes = [...standard, ...extras];
    if (sizes.length > 40) throw new Error("尺寸種類超過範本可容納的數量");
    const groups = new Map<string, { name: string; retail: number; trade: number; quantities: Map<string, number> }>();
    for (const line of shipment.lines) {
      const retail = Number(line.retailPrice); const trade = Number(line.tradePrice);
      const key = JSON.stringify([line.name, retail, trade]);
      const group = groups.get(key) ?? { name: line.name, retail, trade, quantities: new Map() };
      const size = line.size?.trim() || "未標示";
      group.quantities.set(size, (group.quantities.get(size) ?? 0) + line.quantity); groups.set(key, group);
    }
    const rows: (string | number)[][] = [["Neverland"], ["品項", ...sizes, "售價", shipment.kind === "BUYOUT" ? "買斷價格" : "寄賣價格", "件數", "運費"], ...[...groups.values()].map((g) => [g.name, ...sizes.map((size) => g.quantities.get(size) ?? ""), g.retail, g.trade, [...g.quantities.values()].reduce((a, b) => a + b, 0), ""]), ["合計", ...sizes.map((size) => shipment.lines.filter((line) => (line.size?.trim() || "未標示") === size).reduce((sum, line) => sum + line.quantity, 0)), "", "", shipment.lines.reduce((sum, line) => sum + line.quantity, 0), shipment.freightRecoverable == null ? (shipment.freightActual == null ? "待確認" : 0) : Number(shipment.freightRecoverable)], ["物流方式", shipment.shippingMethod ?? ""], ["收件人", shipment.recipient ?? "", "電話", shipment.contactPhone ?? ""], ["地址", shipment.address ?? ""], ["預計出貨日", day(shipment.plannedDate)], ["實際出貨日", day(shipment.dispatchedAt)], ["備註", shipment.note ?? ""]];
    const cellRows = rows.map((row) => ({ values: row.map((value) => ({ userEnteredValue: typeof value === "number" ? { numberValue: value } : { stringValue: value } })) }));
    // One atomic Sheets batch both refreshes the grid and records ownership.
    // A bounded range clears only app-owned cells omitted from the supplied rows.
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
      { updateSheetProperties: { properties: { sheetId: tab.sheetId, gridProperties: { rowCount: Math.max(1000, tab.gridProperties?.rowCount ?? 1000), columnCount: Math.max(55, tab.gridProperties?.columnCount ?? 55) } }, fields: "gridProperties.rowCount,gridProperties.columnCount" } },
      { updateCells: { range: { sheetId: tab.sheetId, startRowIndex: 0, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 51 }, rows: cellRows, fields: "userEnteredValue" } },
      { updateCells: { range: { sheetId: tab.sheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 52, endColumnIndex: 53 }, rows: [{ values: [{ userEnteredValue: { stringValue: MARKER } }] }, { values: [{ userEnteredValue: { stringValue: id } }] }], fields: "userEnteredValue" } },
    ] } });
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit#gid=${tab.sheetId}`;
    await tx.shipment.update({ where: { id }, data: { sheetSpreadsheetId: spreadsheetId, sheetTabName: tabName, sheetTabId: tab.sheetId, sheetUrl: url } });
    await tx.auditLog.create({ data: { userId: actorId, action: "SHIPMENT_SHEET_RENDERED", entityType: "Shipment", entityId: id } });
    return { url };
  }, { timeout: 60000 });
}

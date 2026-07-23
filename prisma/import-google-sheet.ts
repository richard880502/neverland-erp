import { ChannelType, MovementType, Prisma, PrismaClient } from "@prisma/client";
import { readFile } from "fs/promises";
import path from "path";

const prisma = new PrismaClient();

type Cell = string | number | boolean | null;
type Sheet = { range: string; majorDimension: string; values: Cell[][] };
type Workbook = {
  spreadsheetId: string;
  title: string;
  fetchedAt: string;
  sheets: Record<string, Sheet>;
};

type Catalog = {
  listPrice: number | null;
  wholesalePrice: number | null;
  unitCost: number | null;
  description: string | null;
};

const eventTypes: Record<string, MovementType> = {
  "進貨": "RECEIVE",
  "出貨": "SHIP",
  "寄賣出貨": "CONSIGN_OUT",
  "寄賣退回": "CONSIGN_RETURN",
  "寄賣售出": "CONSIGN_SOLD",
  "買斷": "BUYOUT",
  "蝦疵": "DEFECT",
};

const channelTypes: Record<string, ChannelType> = {
  "系統": "SYSTEM",
  "直營": "DIRECT",
  "寄賣": "CONSIGNMENT",
  "買斷": "BUYOUT",
};

const saleTypes = new Set<MovementType>(["SHIP", "CONSIGN_SOLD", "BUYOUT"]);
const internalChannelNames = new Set(["初始化"]);
const confirmedListPriceOverrides = new Map<string, number>([
  ["N202509-01", 3080],
  ["N202509-02", 3080],
  ["N202509-03", 3080],
]);

function text(value: Cell | undefined) {
  return value == null ? "" : String(value).trim();
}

function optionalNumber(value: Cell | undefined) {
  if (value == null || value === "") return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`無效的非負數值：${String(value)}`);
  return result;
}

function excelDate(value: Cell | undefined) {
  const serial = Number(value);
  if (!Number.isFinite(serial)) throw new Error(`無效的 Excel 日期：${String(value)}`);
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000));
}

function requireSheet(workbook: Workbook, name: string) {
  const sheet = workbook.sheets[name];
  if (!sheet) throw new Error(`缺少工作表：${name}`);
  return sheet.values;
}

async function main() {
  const sourcePath = path.join(process.cwd(), "prisma", "google-sheet-data.json");
  const workbook = JSON.parse(await readFile(sourcePath, "utf8")) as Workbook;

  if (workbook.spreadsheetId !== "121W1NjIfpNk_nDX9TcpjtiaqokXKLwaOoPujQRoKaRE") {
    throw new Error("試算表 ID 不符，已中止匯入");
  }

  const productRows = requireSheet(workbook, "商品主檔").slice(1).filter((row) => text(row[0]));
  const channelRows = requireSheet(workbook, "通路主檔").slice(1)
    .filter((row) => text(row[0]) && !internalChannelNames.has(text(row[0])));
  const movementRows = requireSheet(workbook, "庫存異動").slice(1).filter((row) => text(row[0]) && text(row[1]) && text(row[4]));
  const overviewRows = requireSheet(workbook, "商品總覽").slice(1).filter((row) => text(row[0]));

  const catalogBySku = new Map<string, Catalog>();
  for (const row of overviewRows) {
    const catalog: Catalog = {
      listPrice: optionalNumber(row[3]),
      wholesalePrice: optionalNumber(row[4]),
      unitCost: optionalNumber(row[5]),
      description: text(row[6]) || null,
    };
    for (const sku of text(row[0]).split(/\s+/).filter(Boolean)) catalogBySku.set(sku, catalog);
  }
  for (const [sku, listPrice] of confirmedListPriceOverrides) {
    const catalog = catalogBySku.get(sku);
    if (!catalog) throw new Error(`找不到人工確認定價的 SKU：${sku}`);
    catalogBySku.set(sku, { ...catalog, listPrice });
  }

  const products = productRows.map((row) => ({
    sku: text(row[0]),
    name: text(row[1]),
    size: text(row[2]) || null,
    safetyStock: optionalNumber(row[3]) ?? 0,
    ...(catalogBySku.get(text(row[0])) ?? { listPrice: null, wholesalePrice: null, unitCost: null, description: null }),
  }));
  const channels = channelRows.map((row) => {
    const type = channelTypes[text(row[1])];
    if (!type) throw new Error(`未知的通路類型：${text(row[1])}`);
    return { name: text(row[0]), type };
  });

  if (products.some((product) => !product.name || !Number.isInteger(product.safetyStock))) throw new Error("商品主檔有無效欄位");
  if (new Set(products.map((product) => product.sku)).size !== products.length) throw new Error("商品主檔含重複 SKU");
  if (new Set(channels.map((channel) => channel.name)).size !== channels.length) throw new Error("通路主檔含重複名稱");

  const productSkus = new Set(products.map((product) => product.sku));
  const channelNames = new Set(channels.map((channel) => channel.name));
  const movements = movementRows.map((row, index) => {
    const type = eventTypes[text(row[4])];
    const quantity = Number(row[5]);
    const sku = text(row[1]);
    const sourceChannelName = text(row[2]);
    const channelName = internalChannelNames.has(sourceChannelName) ? "" : sourceChannelName;
    if (!type) throw new Error(`庫存異動第 ${index + 2} 列有未知事件：${text(row[4])}`);
    if (!productSkus.has(sku)) throw new Error(`庫存異動第 ${index + 2} 列找不到 SKU：${sku}`);
    if (channelName && !channelNames.has(channelName)) throw new Error(`庫存異動第 ${index + 2} 列找不到通路：${channelName}`);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`庫存異動第 ${index + 2} 列數量無效`);
    return { occurredAt: excelDate(row[0]), sku, channelName: channelName || null, type, quantity };
  });

  const expected = { products: 73, channels: 15, movements: 1103 };
  if (products.length !== expected.products || channels.length !== expected.channels || movements.length !== expected.movements) {
    throw new Error(`來源筆數不符，預期 ${JSON.stringify(expected)}，實際 ${JSON.stringify({ products: products.length, channels: channels.length, movements: movements.length })}`);
  }

  const unitPriceMissing = movements.filter((movement) => saleTypes.has(movement.type) && catalogBySku.get(movement.sku)?.listPrice == null);
  const soldUnits = movements.filter((movement) => saleTypes.has(movement.type)).reduce((sum, movement) => sum + movement.quantity, 0);
  const estimatedRevenue = movements.filter((movement) => saleTypes.has(movement.type)).reduce((sum, movement) => sum + (catalogBySku.get(movement.sku)?.listPrice ?? 0) * movement.quantity, 0);
  const validation = {
    spreadsheetId: workbook.spreadsheetId,
    title: workbook.title,
    products: products.length,
    channels: channels.length,
    movements: movements.length,
    soldUnits,
    estimatedRevenue,
    unpricedSaleRows: unitPriceMissing.length,
    unpricedSaleUnits: unitPriceMissing.reduce((sum, movement) => sum + movement.quantity, 0),
    confirmedListPriceOverrides: Object.fromEntries(confirmedListPriceOverrides),
    excludedInternalChannels: [...internalChannelNames],
  };

  if (process.env.IMPORT_DRY_RUN === "1") {
    console.log(JSON.stringify({ dryRun: true, ...validation }, null, 2));
    return;
  }

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("找不到有效的系統管理員，已中止匯入");

  await prisma.$transaction(async (tx) => {
    await tx.stockMovement.deleteMany();

    for (const product of products) {
      await tx.product.upsert({
        where: { sku: product.sku },
        update: {
          name: product.name,
          size: product.size,
          safetyStock: product.safetyStock,
          listPrice: product.listPrice,
          wholesalePrice: product.wholesalePrice,
          unitCost: product.unitCost,
          description: product.description,
          active: true,
        },
        create: { ...product, active: true },
      });
    }
    await tx.product.deleteMany({ where: { sku: { notIn: products.map((product) => product.sku) } } });

    for (const channel of channels) {
      await tx.channel.upsert({
        where: { name: channel.name },
        update: { type: channel.type, active: true },
        create: { ...channel, active: true },
      });
    }
    await tx.channel.deleteMany({ where: { name: { notIn: channels.map((channel) => channel.name) } } });

    const [storedProducts, storedChannels] = await Promise.all([
      tx.product.findMany({ select: { id: true, sku: true, listPrice: true } }),
      tx.channel.findMany({ select: { id: true, name: true } }),
    ]);
    const productBySku = new Map(storedProducts.map((product) => [product.sku, product]));
    const channelByName = new Map(storedChannels.map((channel) => [channel.name, channel.id]));

    await tx.stockMovement.createMany({
      data: movements.map((movement) => {
        const product = productBySku.get(movement.sku);
        if (!product) throw new Error(`寫入時找不到商品：${movement.sku}`);
        return {
          occurredAt: movement.occurredAt,
          type: movement.type,
          quantity: movement.quantity,
          unitPrice: saleTypes.has(movement.type) ? product.listPrice : null,
          productId: product.id,
          channelId: movement.channelName ? channelByName.get(movement.channelName) ?? null : null,
          createdById: admin.id,
          note: "來源：Google Sheet 完整匯入",
        };
      }),
    });

    await tx.auditLog.create({
      data: {
        userId: admin.id,
        action: "GOOGLE_SHEET_IMPORT",
        entityType: "Spreadsheet",
        entityId: workbook.spreadsheetId,
        metadata: validation as Prisma.InputJsonValue,
      },
    });
  }, { timeout: 120_000, maxWait: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  const [productCount, channelCount, movementCount] = await Promise.all([
    prisma.product.count(),
    prisma.channel.count(),
    prisma.stockMovement.count(),
  ]);
  if (productCount !== expected.products || channelCount !== expected.channels || movementCount !== expected.movements) {
    throw new Error(`匯入後筆數驗證失敗：${JSON.stringify({ productCount, channelCount, movementCount })}`);
  }

  console.log(JSON.stringify({ imported: true, ...validation, verified: { productCount, channelCount, movementCount } }, null, 2));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

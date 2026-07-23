import { createHash } from "crypto";
import { ChannelType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getGoogleSheetConnectionSetting, getGoogleSheetSyncConfig, readGoogleSheetWorkbook, type GoogleSheetWorkbook } from "@/lib/google-sheet-source";

type SyncEntity = "PRODUCT" | "CHANNEL";
export type SyncItemStatus = "NEW" | "MODIFIED" | "CONFLICT" | "UNCHANGED" | "ERROR";
type ProductData = {
  sku: string;
  name: string;
  size: string | null;
  safetyStock: number;
  listPrice: number | null;
  wholesalePrice: number | null;
  unitCost: number | null;
  description: string | null;
};
type ChannelData = { name: string; type: ChannelType };

export type GoogleSheetSyncItem = {
  id: string;
  entityType: SyncEntity;
  key: string;
  label: string;
  sourceRow: number | null;
  status: SyncItemStatus;
  changes: Array<{ field: string; label: string; before: string; after: string }>;
  message: string | null;
  sourceHash: string | null;
  databaseHash: string | null;
  data: ProductData | ChannelData | null;
};

export type GoogleSheetSyncSummary = {
  new: number;
  modified: number;
  conflict: number;
  error: number;
  unchanged: number;
  total: number;
  applied?: number;
  skipped?: number;
};

type CatalogData = {
  listPrice?: number | null;
  wholesalePrice?: number | null;
  unitCost?: number | null;
  description?: string | null;
};

const channelTypes: Record<string, ChannelType> = {
  系統: "SYSTEM",
  直營: "DIRECT",
  寄賣: "CONSIGNMENT",
  買斷: "BUYOUT",
};
const internalChannelNames = new Set(["初始化"]);
const productFieldLabels: Record<keyof ProductData, string> = {
  sku: "SKU",
  name: "商品名稱",
  size: "尺寸",
  safetyStock: "安全庫存",
  listPrice: "定價",
  wholesalePrice: "經銷價",
  unitCost: "成本",
  description: "商品文案",
};
const channelFieldLabels: Record<keyof ChannelData, string> = { name: "通路", type: "類型" };

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function price(value: unknown, field: string, row: number) {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`商品總覽第 ${row} 列的${field}不是有效的非負數`);
  return parsed;
}

function canonical(value: unknown): unknown {
  if (value instanceof Prisma.Decimal) return Number(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function shown(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "number") return new Intl.NumberFormat("zh-TW").format(value);
  if (value === "DIRECT") return "直營";
  if (value === "CONSIGNMENT") return "寄賣";
  if (value === "BUYOUT") return "買斷";
  if (value === "SYSTEM") return "系統";
  return String(value);
}

function changes<T extends Record<string, unknown>>(before: T | null, after: T, labels: Record<keyof T, string>) {
  return (Object.keys(labels) as Array<keyof T>)
    .filter((field) => field !== "sku" && JSON.stringify(canonical(before?.[field])) !== JSON.stringify(canonical(after[field])))
    .map((field) => ({ field: String(field), label: labels[field], before: shown(before?.[field]), after: shown(after[field]) }));
}

function classify(sourceHash: string, databaseHash: string | null, state: { sourceHash: string; databaseHash: string } | undefined) {
  if (!databaseHash) return "NEW" as const;
  if (databaseHash === sourceHash) return "UNCHANGED" as const;
  if (!state) return "MODIFIED" as const;
  const databaseChanged = databaseHash !== state.databaseHash;
  const sheetChanged = sourceHash !== state.sourceHash;
  return databaseChanged && (sheetChanged || sourceHash === state.sourceHash) ? "CONFLICT" as const : "MODIFIED" as const;
}

function errorItem(entityType: SyncEntity, key: string, label: string, sourceRow: number | null, message: string): GoogleSheetSyncItem {
  return {
    id: `${entityType}:${key}:${sourceRow ?? "unknown"}`,
    entityType,
    key,
    label,
    sourceRow,
    status: "ERROR",
    changes: [],
    message,
    sourceHash: null,
    databaseHash: null,
    data: null,
  };
}

async function buildPreview(workbook: GoogleSheetWorkbook) {
  const [products, channels, states] = await Promise.all([
    prisma.product.findMany(),
    prisma.channel.findMany(),
    prisma.googleSheetEntityState.findMany({ where: { spreadsheetId: workbook.spreadsheetId } }),
  ]);
  const productBySku = new Map(products.map((item) => [item.sku, item]));
  const channelByName = new Map(channels.map((item) => [item.name, item]));
  const stateByKey = new Map(states.map((item) => [`${item.entityType}:${item.entityKey}`, item]));
  const items: GoogleSheetSyncItem[] = [];

  const catalogBySku = new Map<string, CatalogData>();
  const overviewRows = workbook.sheets["商品總覽"].values.slice(1);
  for (let index = 0; index < overviewRows.length; index += 1) {
    const row = overviewRows[index];
    const rowNumber = index + 2;
    const skus = text(row[0]).split(/\s+/).filter(Boolean);
    if (!skus.length) continue;
    try {
      const catalog: CatalogData = {
        listPrice: price(row[3], "定價", rowNumber),
        wholesalePrice: price(row[4], "經銷價", rowNumber),
        unitCost: price(row[5], "成本", rowNumber),
        description: row[6] == null || row[6] === "" ? undefined : text(row[6]),
      };
      for (const sku of skus) {
        if (catalogBySku.has(sku)) {
          items.push(errorItem("PRODUCT", sku, sku, rowNumber, `商品總覽的 SKU ${sku} 重複出現`));
        } else {
          catalogBySku.set(sku, catalog);
        }
      }
    } catch (error) {
      items.push(errorItem("PRODUCT", skus.join("、"), skus.join("、"), rowNumber, error instanceof Error ? error.message : "商品價格格式錯誤"));
    }
  }

  const seenSkus = new Set<string>();
  const productRows = workbook.sheets["商品主檔"].values.slice(1);
  for (let index = 0; index < productRows.length; index += 1) {
    const row = productRows[index];
    const sourceRow = index + 2;
    const sku = text(row[0]);
    if (!sku) continue;
    const name = text(row[1]);
    if (seenSkus.has(sku)) {
      items.push(errorItem("PRODUCT", sku, name || sku, sourceRow, `商品主檔的 SKU ${sku} 重複出現`));
      continue;
    }
    seenSkus.add(sku);
    const safetyStock = row[3] == null || row[3] === "" ? 0 : Number(row[3]);
    if (!name) {
      items.push(errorItem("PRODUCT", sku, sku, sourceRow, "商品名稱不可空白"));
      continue;
    }
    if (!Number.isInteger(safetyStock) || safetyStock < 0) {
      items.push(errorItem("PRODUCT", sku, name, sourceRow, "安全庫存必須是非負整數"));
      continue;
    }
    const existing = productBySku.get(sku);
    const catalog = catalogBySku.get(sku) ?? {};
    const data: ProductData = {
      sku,
      name,
      size: text(row[2]) || null,
      safetyStock,
      listPrice: catalog.listPrice === undefined ? existing?.listPrice == null ? null : Number(existing.listPrice) : catalog.listPrice,
      wholesalePrice: catalog.wholesalePrice === undefined ? existing?.wholesalePrice == null ? null : Number(existing.wholesalePrice) : catalog.wholesalePrice,
      unitCost: catalog.unitCost === undefined ? existing?.unitCost == null ? null : Number(existing.unitCost) : catalog.unitCost,
      description: catalog.description === undefined ? existing?.description ?? null : catalog.description,
    };
    const before: ProductData | null = existing ? {
      sku: existing.sku,
      name: existing.name,
      size: existing.size,
      safetyStock: existing.safetyStock,
      listPrice: existing.listPrice == null ? null : Number(existing.listPrice),
      wholesalePrice: existing.wholesalePrice == null ? null : Number(existing.wholesalePrice),
      unitCost: existing.unitCost == null ? null : Number(existing.unitCost),
      description: existing.description,
    } : null;
    const sourceHash = hash(data);
    const databaseHash = before ? hash(before) : null;
    const status = classify(sourceHash, databaseHash, stateByKey.get(`PRODUCT:${sku}`));
    items.push({
      id: `PRODUCT:${sku}`,
      entityType: "PRODUCT",
      key: sku,
      label: `${sku} · ${name}`,
      sourceRow,
      status,
      changes: changes(before, data, productFieldLabels),
      message: status === "CONFLICT" ? "ERP 在上次同步後也有修改；自動同步不會覆蓋" : null,
      sourceHash,
      databaseHash,
      data,
    });
  }

  for (const [sku] of catalogBySku) {
    if (!seenSkus.has(sku)) items.push(errorItem("PRODUCT", sku, sku, null, `商品總覽有 ${sku}，但商品主檔找不到`));
  }

  const seenChannels = new Set<string>();
  const channelRows = workbook.sheets["通路主檔"].values.slice(1);
  for (let index = 0; index < channelRows.length; index += 1) {
    const row = channelRows[index];
    const sourceRow = index + 2;
    const name = text(row[0]);
    if (!name || internalChannelNames.has(name)) continue;
    if (seenChannels.has(name)) {
      items.push(errorItem("CHANNEL", name, name, sourceRow, `通路主檔的「${name}」重複出現`));
      continue;
    }
    seenChannels.add(name);
    const type = channelTypes[text(row[1])];
    if (!type) {
      items.push(errorItem("CHANNEL", name, name, sourceRow, `未知的通路類型：${text(row[1]) || "空白"}`));
      continue;
    }
    const existing = channelByName.get(name);
    const data: ChannelData = { name, type };
    const before: ChannelData | null = existing ? { name: existing.name, type: existing.type } : null;
    const sourceHash = hash(data);
    const databaseHash = before ? hash(before) : null;
    const status = classify(sourceHash, databaseHash, stateByKey.get(`CHANNEL:${name}`));
    items.push({
      id: `CHANNEL:${name}`,
      entityType: "CHANNEL",
      key: name,
      label: name,
      sourceRow,
      status,
      changes: changes(before, data, channelFieldLabels),
      message: status === "CONFLICT" ? "ERP 在上次同步後也有修改；自動同步不會覆蓋" : null,
      sourceHash,
      databaseHash,
      data,
    });
  }

  const summary = summarize(items);
  return { items, summary, sourceDigest: hash({ spreadsheetId: workbook.spreadsheetId, fetchedAt: workbook.fetchedAt, sheets: workbook.sheets }) };
}

function summarize(items: GoogleSheetSyncItem[]): GoogleSheetSyncSummary {
  const count = (status: SyncItemStatus) => items.filter((item) => item.status === status).length;
  return {
    new: count("NEW"),
    modified: count("MODIFIED"),
    conflict: count("CONFLICT"),
    error: count("ERROR"),
    unchanged: count("UNCHANGED"),
    total: items.length,
  };
}

export async function createManualSyncPreview(userId: string) {
  const workbook = await readGoogleSheetWorkbook();
  const preview = await buildPreview(workbook);
  return prisma.googleSheetSyncRun.create({
    data: {
      mode: "MANUAL",
      status: "PENDING_CONFIRMATION",
      source: workbook.source,
      spreadsheetId: workbook.spreadsheetId,
      spreadsheetTitle: workbook.title,
      sourceFetchedAt: new Date(workbook.fetchedAt),
      sourceDigest: preview.sourceDigest,
      summary: preview.summary as unknown as Prisma.InputJsonValue,
      items: preview.items as unknown as Prisma.InputJsonValue,
      requestedById: userId,
    },
  });
}

function parseItems(value: Prisma.JsonValue | null): GoogleSheetSyncItem[] {
  if (!Array.isArray(value)) return [];
  return value as unknown as GoogleSheetSyncItem[];
}

function currentProductData(product: {
  sku: string;
  name: string;
  size: string | null;
  safetyStock: number;
  listPrice: Prisma.Decimal | null;
  wholesalePrice: Prisma.Decimal | null;
  unitCost: Prisma.Decimal | null;
  description: string | null;
}): ProductData {
  return {
    sku: product.sku,
    name: product.name,
    size: product.size,
    safetyStock: product.safetyStock,
    listPrice: product.listPrice == null ? null : Number(product.listPrice),
    wholesalePrice: product.wholesalePrice == null ? null : Number(product.wholesalePrice),
    unitCost: product.unitCost == null ? null : Number(product.unitCost),
    description: product.description,
  };
}

export async function applyGoogleSheetSyncRun(runId: string, actorId: string | null) {
  const claimed = await prisma.googleSheetSyncRun.updateMany({
    where: { id: runId, status: "PENDING_CONFIRMATION" },
    data: { status: "APPLYING", confirmedAt: new Date() },
  });
  if (claimed.count !== 1) throw new Error("這次同步已套用、已失效或正在處理");

  try {
    const run = await prisma.googleSheetSyncRun.findUniqueOrThrow({ where: { id: runId } });
    const items = parseItems(run.items);
    let applied = 0;
    let skipped = 0;
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        if (!item.data || !item.sourceHash || item.status === "ERROR" || item.status === "CONFLICT") {
          if (item.status !== "UNCHANGED") skipped += 1;
          continue;
        }

        if (item.entityType === "PRODUCT") {
          const data = item.data as ProductData;
          const current = await tx.product.findUnique({ where: { sku: item.key } });
          const currentHash = current ? hash(currentProductData(current)) : null;
          if (currentHash !== item.databaseHash) {
            skipped += 1;
            continue;
          }
          const stored = await tx.product.upsert({
            where: { sku: data.sku },
            update: {
              name: data.name,
              size: data.size,
              safetyStock: data.safetyStock,
              listPrice: data.listPrice,
              wholesalePrice: data.wholesalePrice,
              unitCost: data.unitCost,
              description: data.description,
            },
            create: { ...data, active: true },
          });
          const databaseHash = hash(currentProductData(stored));
          await tx.googleSheetEntityState.upsert({
            where: { spreadsheetId_entityType_entityKey: { spreadsheetId: run.spreadsheetId, entityType: "PRODUCT", entityKey: item.key } },
            update: { sourceHash: item.sourceHash, databaseHash, sourceRow: item.sourceRow, lastSyncedAt: now },
            create: { spreadsheetId: run.spreadsheetId, entityType: "PRODUCT", entityKey: item.key, sourceHash: item.sourceHash, databaseHash, sourceRow: item.sourceRow, lastSyncedAt: now },
          });
          if (item.status !== "UNCHANGED") applied += 1;
        } else {
          const data = item.data as ChannelData;
          const current = await tx.channel.findUnique({ where: { name: item.key } });
          const currentData = current ? { name: current.name, type: current.type } : null;
          const currentHash = currentData ? hash(currentData) : null;
          if (currentHash !== item.databaseHash) {
            skipped += 1;
            continue;
          }
          const stored = await tx.channel.upsert({
            where: { name: data.name },
            update: { type: data.type },
            create: { ...data, active: true },
          });
          const databaseHash = hash({ name: stored.name, type: stored.type });
          await tx.googleSheetEntityState.upsert({
            where: { spreadsheetId_entityType_entityKey: { spreadsheetId: run.spreadsheetId, entityType: "CHANNEL", entityKey: item.key } },
            update: { sourceHash: item.sourceHash, databaseHash, sourceRow: item.sourceRow, lastSyncedAt: now },
            create: { spreadsheetId: run.spreadsheetId, entityType: "CHANNEL", entityKey: item.key, sourceHash: item.sourceHash, databaseHash, sourceRow: item.sourceRow, lastSyncedAt: now },
          });
          if (item.status !== "UNCHANGED") applied += 1;
        }
      }

      const initial = (run.summary ?? {}) as Record<string, number>;
      const summary = { ...initial, applied, skipped };
      await tx.googleSheetSyncRun.update({
        where: { id: run.id },
        data: {
          status: skipped || Number(initial.conflict ?? 0) || Number(initial.error ?? 0) ? "COMPLETED_WITH_ISSUES" : "COMPLETED",
          summary,
          completedAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: run.mode === "SCHEDULED" ? "GOOGLE_SHEET_SCHEDULED_SYNC" : "GOOGLE_SHEET_MANUAL_SYNC",
          entityType: "GoogleSheetSyncRun",
          entityId: run.id,
          metadata: { spreadsheetId: run.spreadsheetId, applied, skipped, summary } as Prisma.InputJsonValue,
        },
      });
    }, { timeout: 60_000, maxWait: 10_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return prisma.googleSheetSyncRun.findUniqueOrThrow({ where: { id: runId } });
  } catch (error) {
    await prisma.googleSheetSyncRun.update({
      where: { id: runId },
      data: { status: "FAILED", error: error instanceof Error ? error.message : "同步套用失敗", completedAt: new Date() },
    });
    throw error;
  }
}

export async function runScheduledGoogleSheetSync(scheduleKey?: string, actorId: string | null = null) {
  const config = getGoogleSheetSyncConfig();
  const connection = await getGoogleSheetConnectionSetting();
  let run = await prisma.googleSheetSyncRun.create({
    data: {
      mode: "SCHEDULED",
      status: "FETCHING",
      source: config.sourceMode,
      spreadsheetId: connection.spreadsheetId,
      scheduleKey,
    },
  });
  try {
    const workbook = await readGoogleSheetWorkbook(connection.spreadsheetId);
    const preview = await buildPreview(workbook);
    run = await prisma.googleSheetSyncRun.update({
      where: { id: run.id },
      data: {
        status: "PENDING_CONFIRMATION",
        source: workbook.source,
        spreadsheetTitle: workbook.title,
        sourceFetchedAt: new Date(workbook.fetchedAt),
        sourceDigest: preview.sourceDigest,
        summary: preview.summary as unknown as Prisma.InputJsonValue,
        items: preview.items as unknown as Prisma.InputJsonValue,
      },
    });
    return applyGoogleSheetSyncRun(run.id, actorId);
  } catch (error) {
    await prisma.googleSheetSyncRun.update({
      where: { id: run.id },
      data: { status: "FAILED", error: error instanceof Error ? error.message : "定時同步失敗", completedAt: new Date() },
    }).catch(() => undefined);
    throw error;
  }
}

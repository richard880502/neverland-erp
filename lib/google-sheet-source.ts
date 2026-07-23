import { readFile } from "fs/promises";
import path from "path";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

type Cell = string | number | boolean | null;
type SheetValues = { values: Cell[][] };

export type GoogleSheetWorkbook = {
  spreadsheetId: string;
  title: string;
  fetchedAt: string;
  source: "GOOGLE_SHEETS_API" | "LOCAL_DEMO";
  sheets: Record<"商品主檔" | "商品總覽" | "通路主檔", SheetValues>;
};

const DEFAULT_SPREADSHEET_ID = "121W1NjIfpNk_nDX9TcpjtiaqokXKLwaOoPujQRoKaRE";
const CONNECTION_ID = "primary";
const ranges = {
  商品主檔: "'商品主檔'!B1:E",
  商品總覽: "'商品總覽'!B1:H",
  通路主檔: "'通路主檔'!A1:B",
} as const;

function credentialsFromEnvironment() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const decoded = raw.trim().startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(decoded) as { client_email: string; private_key: string };
  }

  const client_email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const private_key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  return client_email && private_key ? { client_email, private_key } : null;
}

export function getGoogleSheetsApiClient(write = false) {
  const credentials = credentialsFromEnvironment();
  if (!credentials) throw new Error("尚未設定 Google Service Account 憑證");
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [write
      ? "https://www.googleapis.com/auth/spreadsheets"
      : "https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

async function readLiveWorkbook(spreadsheetId: string): Promise<GoogleSheetWorkbook> {
  const sheets = getGoogleSheetsApiClient(false);
  const [metadata, values] = await Promise.all([
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: "spreadsheetId,properties.title",
    }),
    sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: Object.values(ranges),
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER",
    }),
  ]);

  const byRange = new Map<string, unknown[][]>(
    (values.data.valueRanges ?? [])
      .filter((entry): entry is typeof entry & { range: string } => Boolean(entry.range))
      .map((entry) => [entry.range, entry.values ?? []]),
  );
  const getValues = (name: keyof typeof ranges) => {
    const exact = byRange.get(ranges[name]);
    if (exact) return exact as Cell[][];
    const matched = [...byRange.entries()].find(([range]) => range.startsWith(`'${name}'!`));
    if (!matched) throw new Error(`Google Sheet 缺少工作表：${name}`);
    return matched[1] as Cell[][];
  };

  return {
    spreadsheetId,
    title: metadata.data.properties?.title ?? "Google Sheet",
    fetchedAt: new Date().toISOString(),
    source: "GOOGLE_SHEETS_API",
    sheets: {
      商品主檔: { values: getValues("商品主檔") },
      商品總覽: { values: getValues("商品總覽") },
      通路主檔: { values: getValues("通路主檔") },
    },
  };
}

async function readDemoWorkbook(spreadsheetId: string): Promise<GoogleSheetWorkbook> {
  const configured = process.env.GOOGLE_SHEETS_DEMO_FILE;
  const demoPath = configured
    ? path.isAbsolute(configured)
      ? configured
      : path.join(/* turbopackIgnore: true */ process.cwd(), configured)
    : path.join(process.cwd(), "prisma", "google-sheet-data.json");
  const parsed = JSON.parse(await readFile(demoPath, "utf8")) as {
    spreadsheetId: string;
    title: string;
    fetchedAt: string;
    sheets: Record<string, SheetValues>;
  };
  if (parsed.spreadsheetId !== spreadsheetId) throw new Error("本地 Demo 快照的試算表 ID 不符");
  for (const name of Object.keys(ranges)) {
    if (!parsed.sheets[name]) throw new Error(`本地 Demo 快照缺少工作表：${name}`);
  }
  return {
    spreadsheetId,
    title: parsed.title,
    fetchedAt: parsed.fetchedAt,
    source: "LOCAL_DEMO",
    sheets: {
      商品主檔: parsed.sheets["商品主檔"],
      商品總覽: parsed.sheets["商品總覽"],
      通路主檔: parsed.sheets["通路主檔"],
    },
  };
}

export function getGoogleSheetSyncConfig() {
  const timeZone = process.env.GOOGLE_SHEET_SYNC_TIME_ZONE || "Asia/Taipei";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new Error(`無效的同步時區：${timeZone}`);
  }
  const hour = Number(process.env.GOOGLE_SHEET_SYNC_HOUR ?? "3");
  const minute = Number(process.env.GOOGLE_SHEET_SYNC_MINUTE ?? "0");
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error("同步時間必須是 00:00 到 23:59");
  }
  const hasCredentials = Boolean(credentialsFromEnvironment());
  const demoAvailable = process.env.NODE_ENV !== "production" || Boolean(process.env.GOOGLE_SHEETS_DEMO_FILE);
  return {
    spreadsheetId: process.env.GOOGLE_SHEET_ID || DEFAULT_SPREADSHEET_ID,
    timeZone,
    hour,
    minute,
    enabled: process.env.GOOGLE_SHEET_SYNC_ENABLED === "true",
    hasCredentials,
    demoAvailable,
    sourceMode: hasCredentials ? "GOOGLE_SHEETS_API" as const : demoAvailable ? "LOCAL_DEMO" as const : "UNAVAILABLE" as const,
  };
}

export function parseGoogleSheetReference(input: string) {
  const value = input.trim();
  if (!value) throw new Error("請輸入 Google Sheet 網址或試算表 ID");
  try {
    const url = new URL(value);
    if (url.hostname !== "docs.google.com") throw new Error("請使用 docs.google.com 的 Google Sheet 網址");
    const match = url.pathname.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
    if (!match) throw new Error("無法從網址辨識試算表 ID");
    return match[1];
  } catch (error) {
    if (/^[A-Za-z0-9_-]{20,}$/.test(value)) return value;
    if (error instanceof Error && error.message !== "Invalid URL") throw error;
    throw new Error("Google Sheet 網址或試算表 ID 格式不正確");
  }
}

export async function getGoogleSheetConnectionSetting() {
  const config = getGoogleSheetSyncConfig();
  const stored = await prisma.googleSheetConnection.findUnique({ where: { id: CONNECTION_ID } });
  return {
    id: CONNECTION_ID,
    spreadsheetId: stored?.spreadsheetId ?? config.spreadsheetId,
    spreadsheetTitle: stored?.spreadsheetTitle ?? null,
    lastTestedAt: stored?.lastTestedAt ?? null,
    lastTestStatus: stored?.lastTestStatus ?? null,
    lastTestSource: stored?.lastTestSource ?? null,
    lastTestError: stored?.lastTestError ?? null,
    automaticSyncEnabled: stored?.automaticSyncEnabled ?? config.enabled,
    syncTimeZone: stored?.syncTimeZone ?? config.timeZone,
    syncHour: stored?.syncHour ?? config.hour,
    syncMinute: stored?.syncMinute ?? config.minute,
    settingSource: stored ? "DATABASE" as const : "ENVIRONMENT" as const,
  };
}

export async function saveGoogleSheetConnection(input: {
  spreadsheetId: string;
  spreadsheetTitle?: string | null;
  lastTestedAt?: Date | null;
  lastTestStatus?: string | null;
  lastTestSource?: string | null;
  lastTestError?: string | null;
  updatedById: string;
}) {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.googleSheetConnection.findUnique({ where: { id: CONNECTION_ID } });
    const connection = await tx.googleSheetConnection.upsert({
      where: { id: CONNECTION_ID },
      update: input,
      create: { id: CONNECTION_ID, ...input },
    });
    if (previous?.spreadsheetId !== input.spreadsheetId) {
      await tx.googleSheetSyncRun.updateMany({
        where: { status: "PENDING_CONFIRMATION" },
        data: { status: "CANCELLED", error: "連線試算表已變更，請重新建立同步預覽", completedAt: new Date() },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: input.updatedById,
        action: "GOOGLE_SHEET_CONNECTION_UPDATED",
        entityType: "GoogleSheetConnection",
        entityId: CONNECTION_ID,
        metadata: {
          beforeSpreadsheetId: previous?.spreadsheetId ?? null,
          spreadsheetId: input.spreadsheetId,
          spreadsheetTitle: input.spreadsheetTitle ?? null,
          testSource: input.lastTestSource ?? null,
        },
      },
    });
    return connection;
  });
}

export async function saveGoogleSheetSchedule(input: {
  automaticSyncEnabled: boolean;
  syncTimeZone: string;
  syncHour: number;
  syncMinute: number;
  updatedById: string;
}) {
  new Intl.DateTimeFormat("en-US", { timeZone: input.syncTimeZone }).format();
  const current = await getGoogleSheetConnectionSetting();
  return prisma.$transaction(async (tx) => {
    const connection = await tx.googleSheetConnection.upsert({
      where: { id: CONNECTION_ID },
      update: input,
      create: {
        id: CONNECTION_ID,
        spreadsheetId: current.spreadsheetId,
        ...input,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.updatedById,
        action: "GOOGLE_SHEET_SCHEDULE_UPDATED",
        entityType: "GoogleSheetConnection",
        entityId: CONNECTION_ID,
        metadata: {
          enabled: input.automaticSyncEnabled,
          timeZone: input.syncTimeZone,
          hour: input.syncHour,
          minute: input.syncMinute,
        },
      },
    });
    return connection;
  });
}

export async function readGoogleSheetWorkbook(spreadsheetIdOverride?: string) {
  const config = getGoogleSheetSyncConfig();
  const spreadsheetId = spreadsheetIdOverride ?? (await getGoogleSheetConnectionSetting()).spreadsheetId;
  if (config.hasCredentials) return readLiveWorkbook(spreadsheetId);
  if (config.demoAvailable) return readDemoWorkbook(spreadsheetId);
  throw new Error("Google Sheet 同步尚未設定憑證");
}

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const execFileAsync = promisify(execFile);
const MAX_FILE_SIZE = 12 * 1024 * 1024;

type ParsedRow = {
  sheetName: string;
  rowNumber: number;
  status: "READY" | "REVIEW" | "REJECTED";
  reason: string | null;
  raw: Record<string, string>;
  normalized: Record<string, unknown>;
};
type ParsedResult = { summary: { total: number; READY: number; REVIEW: number; REJECTED: number }; rows: ParsedRow[] };

export const runtime = "nodejs";

export async function POST(request: Request) {
  let dir: string | null = null;
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "請選擇 Excel 檔案" }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "目前匯入預覽僅支援 .xlsx" }, { status: 400 });
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Excel 檔案大小需小於 12 MB" }, { status: 400 });

    dir = await mkdtemp(path.join(tmpdir(), "neverland-finance-"));
    const inputPath = path.join(dir, "input.xlsx");
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));
    const scriptPath = path.join(process.cwd(), "scripts", "parse-finance-xlsx.py");
    const { stdout } = await execFileAsync("python3", [scriptPath, inputPath], { maxBuffer: 20 * 1024 * 1024, timeout: 30_000 });
    const parsed = JSON.parse(stdout) as ParsedResult;
    if (!parsed.summary || !Array.isArray(parsed.rows)) throw new Error("Excel parser 回傳格式錯誤");

    const batchId = randomUUID();
    await prisma.financeImportBatch.create({
      data: {
        id: batchId,
        filename: file.name,
        source: "EXCEL",
        status: "PREVIEW",
        summary: parsed.summary,
        createdById: auth.user.id,
        rows: {
          create: parsed.rows.map((row) => ({
            id: randomUUID(),
            sheetName: row.sheetName,
            rowNumber: row.rowNumber,
            status: row.status,
            reason: row.reason,
            raw: row.raw as Prisma.InputJsonValue,
            normalized: row.normalized as Prisma.InputJsonValue,
          })),
        },
      },
    });
    return NextResponse.json({ ...parsed, batchId });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Excel 預覽失敗" }, { status: 500 });
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

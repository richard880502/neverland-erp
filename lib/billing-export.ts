import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";

const execFileAsync = promisify(execFile);

function taipeiDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

async function statementPayload(id: string) {
  const statement = await prisma.billingStatement.findUnique({
    where: { id },
    include: { channel: true, items: { orderBy: { sku: "asc" } } },
  });
  if (!statement) throw new Error("找不到請款單");
  return {
    statementNo: statement.statementNo,
    channelName: statement.channel.name,
    sourceType: statement.sourceType,
    periodStart: taipeiDate(statement.periodStart),
    periodEnd: taipeiDate(statement.periodEnd),
    issuedAt: taipeiDate(statement.issuedAt),
    companyName: statement.companyName,
    taxId: statement.taxId,
    contactName: statement.contactName,
    contactEmail: statement.contactEmail,
    contactPhone: statement.contactPhone,
    billingAddress: statement.billingAddress,
    settlementRate: Number(statement.settlementRate),
    taxRate: Number(statement.taxRate),
    shippingFee: Number(statement.shippingFee),
    items: statement.items.map((item) => ({
      sku: item.sku,
      productName: item.productName,
      size: item.size,
      listPrice: Number(item.listPrice),
      settlementPrice: Number(item.settlementPrice),
      quantity: item.quantity,
      subtotal: Number(item.subtotal),
    })),
  };
}

async function renderDocument(id: string, directory: string, format: "xlsx" | "pdf") {
  const payload = await statementPayload(id);
  const dataPath = path.join(directory, "billing.json");
  const outputPath = path.join(directory, `${safeName(payload.statementNo)}.${format}`);
  const templatePath = path.join(process.cwd(), "public", "templates", "Neverland請款單.xlsx");
  const scriptPath = path.join(process.cwd(), "scripts", "render-billing-template.py");
  await writeFile(dataPath, JSON.stringify(payload), "utf8");
  await execFileAsync(
    "python3",
    [scriptPath, "--template", templatePath, "--data", dataPath, "--output", outputPath, "--format", format],
    { timeout: format === "pdf" ? 60_000 : 45_000 },
  );
  return { payload, outputPath };
}

export async function exportBillingStatement(id: string, format: "xlsx" | "pdf") {
  const directory = await mkdtemp(path.join(tmpdir(), "neverland-billing-"));
  try {
    const { payload, outputPath } = await renderDocument(id, directory, format);
    const content = await readFile(outputPath);
    const customer = safeName(payload.companyName || payload.channelName);
    return {
      content,
      fileName: `${payload.statementNo}-${customer}.${format}`,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") throw new Error("伺服器尚未安裝請款匯出元件（Python / LibreOffice UNO）");
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

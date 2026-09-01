import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const shippingPayerSchema = z.enum(["COMPANY", "CUSTOMER", "CHANNEL", "SUPPLIER"]);
const settlementCycleSchema = z.enum(["PER_ORDER", "DAILY", "WEEKLY", "MONTHLY", "PER_SHIPMENT", "PER_PAYOUT", "MANUAL"]);
const billingTriggerSchema = z.enum(["EXTERNAL_STATEMENT", "DELIVERED", "SHIPPED", "ORDER_COMPLETED", "PAYOUT_RECEIVED", "PAYMENT_RECEIVED", "MANUAL"]);

const updateSchema = z.object({
  active: z.boolean().optional(),
  companyName: z.string().trim().max(160).nullable().optional(),
  taxId: z.string().trim().max(32).nullable().optional(),
  contactName: z.string().trim().max(120).nullable().optional(),
  contactEmail: z.string().trim().email().max(200).nullable().optional(),
  contactPhone: z.string().trim().max(80).nullable().optional(),
  billingAddress: z.string().trim().max(300).nullable().optional(),
  settlementRate: z.number().min(0).max(1).nullable().optional(),
  taxRate: z.number().min(0).max(1).nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  settlementCycle: settlementCycleSchema.nullable().optional(),
  billingTrigger: billingTriggerSchema.nullable().optional(),
  billingWithinDays: z.number().int().min(0).max(365).nullable().optional(),
  includeShippingInBilling: z.boolean().optional(),
  requiresSalesInvoice: z.boolean().optional(),
  defaultShippingMethod: z.string().trim().max(120).nullable().optional(),
  defaultShippingFee: z.number().min(0).max(1_000_000).nullable().optional(),
  defaultShippingPayer: shippingPayerSchema.nullable().optional(),
}).strict().refine((value) => Object.values(value).some((item) => item !== undefined), { message: "沒有可更新欄位" });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請檢查通路設定欄位" }, { status: 400 });
    const { id } = await context.params;
    const existing = await prisma.channel.findUnique({ where: { id }, select: { id: true, name: true, type: true, active: true } });
    if (!existing) return NextResponse.json({ error: "找不到通路" }, { status: 404 });

    const billingProfileKeys = [
      "companyName", "taxId", "contactName", "contactEmail", "contactPhone", "billingAddress",
      "settlementRate", "taxRate", "paymentTermsDays",
    ] as const;
    if (billingProfileKeys.some((key) => parsed.data[key] !== undefined) && !["CONSIGNMENT", "BUYOUT"].includes(existing.type)) {
      return NextResponse.json({ error: "只有寄賣或買斷通路可設定客戶請款資料" }, { status: 400 });
    }

    const settlementPolicyKeys = [
      "settlementCycle", "billingTrigger", "billingWithinDays", "includeShippingInBilling", "requiresSalesInvoice",
    ] as const;
    if (settlementPolicyKeys.some((key) => parsed.data[key] !== undefined) && !["DIRECT", "CONSIGNMENT", "BUYOUT"].includes(existing.type)) {
      return NextResponse.json({ error: "此通路類型不支援銷售 / 結算規則" }, { status: 400 });
    }

    const channel = await prisma.$transaction(async (tx) => {
      const updated = await tx.channel.update({ where: { id }, data: parsed.data });
      const activeOnly = Object.keys(parsed.data).length === 1 && parsed.data.active !== undefined;
      await tx.auditLog.create({
        data: {
          userId: auth.user.id,
          action: activeOnly ? (parsed.data.active ? "CHANNEL_ENABLED" : "CHANNEL_DISABLED") : "CHANNEL_SETTINGS_UPDATED",
          entityType: "Channel",
          entityId: id,
          metadata: { name: existing.name, updatedFields: Object.keys(parsed.data) },
          ipAddress: clientIp(request),
        },
      });
      return updated;
    });
    return NextResponse.json(channel);
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: "通路設定無法更新" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const { id } = await context.params;
    const channel = await prisma.channel.findUnique({
      where: { id },
      select: { id: true, name: true, _count: { select: { movements: true, billingStatements: true } } },
    });
    if (!channel) return NextResponse.json({ error: "找不到通路" }, { status: 404 });
    if (channel._count.movements > 0 || channel._count.billingStatements > 0) {
      return NextResponse.json({ error: "通路已有庫存或請款紀錄，請改用停用以保留帳務歷史" }, { status: 409 });
    }

    await prisma.$transaction([
      prisma.channel.delete({ where: { id } }),
      prisma.auditLog.create({
        data: { userId: auth.user.id, action: "CHANNEL_DELETED", entityType: "Channel", entityId: id, metadata: { name: channel.name }, ipAddress: clientIp(request) },
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return NextResponse.json({ error: "通路已有關聯紀錄，請改用停用" }, { status: 409 });
    }
    return NextResponse.json({ error: "通路無法刪除" }, { status: 500 });
  }
}

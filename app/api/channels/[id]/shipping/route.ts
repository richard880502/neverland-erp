import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const payerSchema = z.enum(["COMPANY", "CUSTOMER", "CHANNEL", "SUPPLIER"]);
const schema = z.object({
  defaultShippingMethod: z.string().trim().max(120).nullable(),
  defaultShippingFee: z.number().min(0).max(1_000_000).nullable(),
  defaultShippingPayer: payerSchema.nullable(),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請檢查物流方式、運費與負擔者" }, { status: 400 });
    const { id } = await context.params;
    const channel = await prisma.channel.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!channel) return NextResponse.json({ error: "找不到通路" }, { status: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "Channel"
        SET
          "defaultShippingMethod" = ${parsed.data.defaultShippingMethod},
          "defaultShippingFee" = ${parsed.data.defaultShippingFee},
          "defaultShippingPayer" = ${parsed.data.defaultShippingPayer},
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${id}
      `;
      await tx.auditLog.create({ data: {
        userId: auth.user.id,
        action: "CHANNEL_SHIPPING_DEFAULTS_UPDATED",
        entityType: "Channel",
        entityId: id,
        metadata: { name: channel.name, ...parsed.data },
        ipAddress: clientIp(request),
      }});
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "物流預設無法更新" }, { status: 500 });
  }
}

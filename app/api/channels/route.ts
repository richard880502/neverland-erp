import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ name: z.string().trim().min(1).max(120), type: z.enum(["SYSTEM", "DIRECT", "CONSIGNMENT", "BUYOUT"]) });

function policyDefaults(type: z.infer<typeof schema>["type"]) {
  if (type === "CONSIGNMENT") return { settlementCycle: "MONTHLY" as const, billingTrigger: "EXTERNAL_STATEMENT" as const };
  if (type === "BUYOUT") return { settlementCycle: "PER_SHIPMENT" as const, billingTrigger: "DELIVERED" as const, billingWithinDays: 7 };
  return {};
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] }); const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "請檢查通路欄位" }, { status: 400 });
    const channel = await prisma.$transaction(async (tx) => {
      const created = await tx.channel.create({ data: { ...parsed.data, ...policyDefaults(parsed.data.type) } });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "CHANNEL_CREATED", entityType: "Channel", entityId: created.id, metadata: { name: created.name, type: created.type, settlementCycle: created.settlementCycle, billingTrigger: created.billingTrigger, billingWithinDays: created.billingWithinDays }, ipAddress: clientIp(request) } });
      return created;
    });
    return NextResponse.json(channel, { status: 201 });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: "通路名稱已存在或無法儲存" }, { status: 409 });
  }
}

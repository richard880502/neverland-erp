import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "@/lib/auth";
import { requireApiKey } from "@/lib/api-key-auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  items: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(80),
        name: z.string().trim().min(1).max(160),
      }),
    )
    .min(1)
    .max(100),
});

export async function POST(request: Request) {
  try {
    await requireApiKey(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "請檢查商品資料" }, { status: 400 });

    const created: string[] = [];
    const alreadyExisted: string[] = [];

    for (const item of parsed.data.items) {
      const existing = await prisma.product.findUnique({ where: { sku: item.sku }, select: { id: true } });
      await prisma.product.upsert({
        where: { sku: item.sku },
        create: { sku: item.sku, name: item.name, active: true },
        update: {},
      });
      if (existing) alreadyExisted.push(item.sku);
      else created.push(item.sku);
    }

    return NextResponse.json({ created, alreadyExisted }, { status: 200 });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "商品同步失敗" }, { status: 409 });
  }
}

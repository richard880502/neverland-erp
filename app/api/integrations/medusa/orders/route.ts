import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authErrorResponse } from "@/lib/auth";
import { requireApiKey } from "@/lib/api-key-auth";
import { prisma } from "@/lib/prisma";
import { sumInventory } from "@/lib/inventory";
import { enqueueGoogleSheetMovement } from "@/lib/google-sheet-movement-queue";

const MEDUSA_SYNC_USER_EMAIL = "medusa-sync@internal.neverland";
const MEDUSA_CHANNEL_NAME = "官網";

const schema = z.object({
  orderId: z.string().trim().min(1).max(200),
  items: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(80),
        quantity: z.coerce.number().int().positive(),
        unitPrice: z.coerce.number().min(0).optional(),
      }),
    )
    .min(1),
});

export async function POST(request: Request) {
  try {
    const apiKey = await requireApiKey(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "請檢查訂單資料" }, { status: 400 });
    const input = parsed.data;
    const referencePrefix = `medusa:${input.orderId}:`;

    let replayed = false;
    const movements = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.stockMovement.findMany({
          where: { referenceNo: { startsWith: referencePrefix } },
        });
        if (existing.length) {
          replayed = true;
          return existing;
        }

        const skus = input.items.map((item) => item.sku);
        const products = await tx.product.findMany({ where: { sku: { in: skus } } });
        const productBySku = new Map(products.map((product) => [product.sku, product]));
        const missingSkus = skus.filter((sku) => !productBySku.has(sku));
        if (missingSkus.length) throw new Error(`找不到商品 SKU：${missingSkus.join(", ")}`);

        const channel = await tx.channel.findUnique({ where: { name: MEDUSA_CHANNEL_NAME } });
        if (!channel) throw new Error(`找不到通路「${MEDUSA_CHANNEL_NAME}」`);

        const syncUser = await tx.user.findUnique({ where: { email: MEDUSA_SYNC_USER_EMAIL } });
        if (!syncUser) throw new Error("找不到 Medusa 自動同步使用者，請先執行 db:seed");

        const requestedBySku = new Map<string, number>();
        for (const item of input.items) requestedBySku.set(item.sku, (requestedBySku.get(item.sku) ?? 0) + item.quantity);
        for (const [sku, requestedQuantity] of requestedBySku) {
          const product = productBySku.get(sku)!;
          const priorMovements = await tx.stockMovement.findMany({ where: { productId: product.id } });
          const total = sumInventory(priorMovements);
          if (total.warehouse < requestedQuantity) {
            throw new Error(`商品 ${sku} 倉庫庫存不足，目前只有 ${total.warehouse} 件，需要 ${requestedQuantity} 件`);
          }
        }

        const created = [];
        for (const item of input.items) {
          const product = productBySku.get(item.sku)!;
          const movement = await tx.stockMovement.create({
            data: {
              occurredAt: new Date(),
              type: "SHIP",
              productId: product.id,
              channelId: channel.id,
              quantity: item.quantity,
              unitPrice: item.unitPrice ?? null,
              referenceNo: `${referencePrefix}${item.sku}`,
              createdById: syncUser.id,
            },
          });
          await enqueueGoogleSheetMovement(tx, movement.id);
          created.push(movement);
        }

        await tx.auditLog.create({
          data: {
            userId: null,
            action: "MEDUSA_ORDER_SYNCED",
            entityType: "StockMovement",
            metadata: { orderId: input.orderId, apiKeyId: apiKey.apiKeyId, skus },
          },
        });

        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return NextResponse.json(movements, { status: replayed ? 200 : 201 });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "訂單同步失敗" }, { status: 409 });
  }
}

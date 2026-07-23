import { prisma } from "@/lib/prisma";
import { ProductManager } from "@/components/ProductManager";
import { getCurrentUser } from "@/lib/auth";

export default async function ProductsPage() {
  const [products, user] = await Promise.all([
    prisma.product.findMany({
      orderBy: [{ name: "asc" }, { size: "asc" }],
      include: { _count: { select: { movements: true } } },
    }),
    getCurrentUser(),
  ]);
  return <ProductManager canWrite={user?.role !== "VIEWER"} products={products.map(({ _count, ...p }) => ({
    ...p,
    listPrice: p.listPrice ? Number(p.listPrice) : null,
    wholesalePrice: p.wholesalePrice ? Number(p.wholesalePrice) : null,
    unitCost: p.unitCost ? Number(p.unitCost) : null,
    movementCount: _count.movements,
  }))} />;
}

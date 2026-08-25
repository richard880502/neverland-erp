import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { BillingManager } from "@/components/BillingManager";

function date(value: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

export default async function BillingPage() {
  const [channels, products, statements, user] = await Promise.all([
    prisma.channel.findMany({ where: { active: true, type: { in: ["CONSIGNMENT", "BUYOUT"] } }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { active: true }, orderBy: { sku: "asc" }, select: { id: true, sku: true, name: true, size: true, listPrice: true } }),
    prisma.billingStatement.findMany({ include: { channel: true }, orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }], take: 200 }),
    getCurrentUser(),
  ]);
  const stats = statements.reduce((acc, statement) => {
    const amount = Number(statement.totalAmount);
    acc.count += 1;
    if (statement.status === "ISSUED") acc.outstanding += amount;
    if (statement.status === "PAID") acc.paid += Number(statement.paidAmount ?? statement.totalAmount);
    return acc;
  }, { outstanding: 0, paid: 0, count: 0 });
  return <BillingManager
    canWrite={user?.role !== "VIEWER"}
    stats={stats}
    products={products.map((product) => ({ ...product, listPrice: product.listPrice == null ? null : Number(product.listPrice) }))}
    channels={channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type as "CONSIGNMENT" | "BUYOUT",
      companyName: channel.companyName,
      taxId: channel.taxId,
      contactName: channel.contactName,
      contactEmail: channel.contactEmail,
      contactPhone: channel.contactPhone,
      billingAddress: channel.billingAddress,
      settlementRate: channel.settlementRate == null ? null : Number(channel.settlementRate),
      taxRate: channel.taxRate == null ? null : Number(channel.taxRate),
      paymentTermsDays: channel.paymentTermsDays,
    }))}
    statements={statements.map((statement) => ({
      id: statement.id,
      statementNo: statement.statementNo,
      companyName: statement.companyName,
      channelName: statement.channel.name,
      periodStart: date(statement.periodStart),
      periodEnd: date(statement.periodEnd),
      totalAmount: Number(statement.totalAmount),
      status: statement.status,
      issuedAt: date(statement.issuedAt),
    }))}
  />;
}

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { BillingManager } from "@/components/BillingManager";
import { DirectSettlementManager } from "@/components/DirectSettlementManager";

function date(value: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function b2bSettlementCycle(value: string | null) {
  return value === "MONTHLY" || value === "PER_SHIPMENT" || value === "MANUAL" ? value : null;
}

function b2bBillingTrigger(value: string | null) {
  return value === "EXTERNAL_STATEMENT" || value === "DELIVERED" || value === "SHIPPED" || value === "MANUAL" ? value : null;
}

function directSettlementCycle(value: string | null) {
  return value === "PER_ORDER" || value === "DAILY" || value === "WEEKLY" || value === "MONTHLY" || value === "PER_PAYOUT" || value === "MANUAL" ? value : null;
}

function directBillingTrigger(value: string | null) {
  return value === "ORDER_COMPLETED" || value === "PAYOUT_RECEIVED" || value === "PAYMENT_RECEIVED" || value === "MANUAL" ? value : null;
}

export default async function BillingPage() {
  const [channels, directChannels, directSettlements, products, statements, user] = await Promise.all([
    prisma.channel.findMany({ where: { active: true, type: { in: ["CONSIGNMENT", "BUYOUT"] } }, orderBy: { name: "asc" } }),
    prisma.channel.findMany({ where: { active: true, type: "DIRECT" }, orderBy: { name: "asc" } }),
    prisma.directSettlement.findMany({ orderBy: [{ settledAt: "desc" }, { createdAt: "desc" }], take: 200 }),
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
  const directChannelById = new Map(directChannels.map((channel) => [channel.id, channel.name]));
  const canWrite = user?.role !== "VIEWER";

  return <>
    <BillingManager
      canWrite={canWrite}
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
        settlementCycle: b2bSettlementCycle(channel.settlementCycle),
        billingTrigger: b2bBillingTrigger(channel.billingTrigger),
        billingWithinDays: channel.billingWithinDays,
        includeShippingInBilling: channel.includeShippingInBilling,
        requiresSalesInvoice: channel.requiresSalesInvoice,
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
    />
    {directChannels.length > 0 && <div className="billing-page">
      <DirectSettlementManager
        canWrite={canWrite}
        channels={directChannels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          settlementCycle: directSettlementCycle(channel.settlementCycle),
          billingTrigger: directBillingTrigger(channel.billingTrigger),
          requiresSalesInvoice: channel.requiresSalesInvoice,
        }))}
        settlements={directSettlements.map((settlement) => ({
          id: settlement.id,
          settlementNo: settlement.settlementNo,
          channelName: directChannelById.get(settlement.channelId) ?? settlement.channelId,
          periodStart: date(settlement.periodStart),
          periodEnd: date(settlement.periodEnd),
          settledAt: date(settlement.settledAt),
          grossSales: Number(settlement.grossSales),
          shippingIncome: Number(settlement.shippingIncome),
          refundAmount: Number(settlement.refundAmount),
          platformFee: Number(settlement.platformFee),
          paymentFee: Number(settlement.paymentFee),
          otherFee: Number(settlement.otherFee),
          expectedPayout: Number(settlement.expectedPayout),
          actualPayout: settlement.actualPayout == null ? null : Number(settlement.actualPayout),
          discrepancy: settlement.discrepancy == null ? null : Number(settlement.discrepancy),
          status: settlement.status,
        }))}
      />
    </div>}
  </>;
}

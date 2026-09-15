import { Prisma } from "@prisma/client";

/**
 * Returns original ledger rows only. A filter match on either member of a
 * reversal pair keeps the complete event together for list pagination.
 */
export function reversalEventWhere(match: Prisma.StockMovementWhereInput): Prisma.StockMovementWhereInput {
  return {
    reversalOfId: null,
    ...(Object.keys(match).length ? { OR: [match, { reversal: { is: match } }] } : {}),
  };
}

import { MovementType, Prisma } from "@prisma/client";

export const movementLabels: Record<MovementType, string> = {
  RECEIVE: "進貨",
  SHIP: "出貨",
  SALES_RETURN: "銷貨退回",
  PURCHASE_RETURN: "進貨退出",
  CONSIGN_OUT: "寄賣出貨",
  CONSIGN_RETURN: "寄賣退回",
  CONSIGN_SOLD: "寄賣售出",
  BUYOUT: "買斷",
  DEFECT: "瑕疵",
  ADJUSTMENT: "庫存調整",
};

export const channelTypeLabels = {
  SYSTEM: "系統",
  DIRECT: "直營",
  CONSIGNMENT: "寄賣",
  BUYOUT: "買斷",
} as const;

export function deltas(type: MovementType, quantity: number) {
  switch (type) {
    case "RECEIVE": return { warehouse: quantity, consignment: 0, sold: 0, defect: 0 };
    case "SHIP": return { warehouse: -quantity, consignment: 0, sold: quantity, defect: 0 };
    case "SALES_RETURN": return { warehouse: quantity, consignment: 0, sold: -quantity, defect: 0 };
    case "PURCHASE_RETURN": return { warehouse: -quantity, consignment: 0, sold: 0, defect: 0 };
    case "CONSIGN_OUT": return { warehouse: -quantity, consignment: quantity, sold: 0, defect: 0 };
    case "CONSIGN_RETURN": return { warehouse: quantity, consignment: -quantity, sold: 0, defect: 0 };
    case "CONSIGN_SOLD": return { warehouse: 0, consignment: -quantity, sold: quantity, defect: 0 };
    case "BUYOUT": return { warehouse: -quantity, consignment: 0, sold: quantity, defect: 0 };
    case "DEFECT": return { warehouse: -quantity, consignment: 0, sold: 0, defect: quantity };
    case "ADJUSTMENT": return { warehouse: quantity, consignment: 0, sold: 0, defect: 0 };
  }
}

export type MovementForCalc = {
  type: MovementType;
  quantity: number;
  channelId: string | null;
  unitPrice: Prisma.Decimal | null;
  occurredAt: Date;
  productId: string;
};

export function sumInventory(movements: MovementForCalc[]) {
  return movements.reduce(
    (sum, movement) => {
      const delta = deltas(movement.type, movement.quantity);
      sum.warehouse += delta.warehouse;
      sum.consignment += delta.consignment;
      sum.sold += delta.sold;
      sum.defect += delta.defect;
      return sum;
    },
    { warehouse: 0, consignment: 0, sold: 0, defect: 0 },
  );
}

export function isSale(type: MovementType) {
  return type === "SHIP" || type === "CONSIGN_SOLD" || type === "BUYOUT" || type === "SALES_RETURN";
}

export function salesSign(type: MovementType) {
  return type === "SALES_RETURN" ? -1 : 1;
}

# Neverland ERP

Neverland ERP 是以 Next.js、Prisma 與 PostgreSQL 建構的庫存與銷售管理系統，包含商品、通路、庫存異動、Google Sheet 同步與 Remote MCP/OAuth 整合。

## 庫存異動

庫存採 ledger 模式：每次實物流動新增一筆異動；輸入錯誤使用沖銷，不直接刪除歷史紀錄。

支援事件包含：

- 進貨（`RECEIVE`）
- 出貨（`SHIP`）
- 銷貨退回（`SALES_RETURN`）：商品回補倉庫，已售數量與營收扣回
- 進貨退出（`PURCHASE_RETURN`）：退回供應商並扣除倉庫庫存
- 寄賣出貨 / 寄賣退回 / 寄賣售出
- 買斷、瑕疵、庫存調整

「寄賣代發」是一個複合操作：從指定寄賣經銷扣除寄賣庫存，並把銷售歸入指定直營通路。系統在同一個 Serializable transaction 中建立 `CONSIGN_RETURN` 與 `SHIP`，確保兩筆一起成功或一起失敗。

## MCP 庫存操作

Remote MCP 的寫入操作採兩階段確認：第一次呼叫只建立 preview 與短效 `confirmationToken`，只有使用者明確確認後，以完全相同參數再次呼叫才會寫入。

庫存相關 MCP tools：

- `create_inventory_movement`：一般庫存異動
- `create_sales_return`：銷貨退回
- `create_purchase_return`：進貨退出
- `create_consignment_direct_fulfillment`：寄賣代發
- `reverse_inventory_movement`：沖銷既有異動

這些工具仍會在 commit 時重新執行角色、OAuth scope、通路類型、價格與庫存檢查，並將異動加入 Google Sheet 同步 queue。

## Development

```bash
npm ci
npx prisma migrate deploy
npm test
npm run test:integration
npm run lint
npm run build
```

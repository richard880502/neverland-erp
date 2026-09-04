# 運費代墊模式

`shippingPayer = REIMBURSABLE` 代表：

- Neverland 先支付物流費。
- 出貨時仍建立 Finance 物流費支出。
- B2B 請款預覽會把該運費列入可回收運費。
- 同一 `shippingGroupKey` 只計一次運費，避免同箱多 SKU 重複加總。
- 此模式只適用寄賣與買斷通路；直營通路仍使用公司 / 客戶 / 通路直接負擔的既有規則。

這個模式沿用既有 `defaultShippingPayer` / `shippingPayer` 字串欄位，不需要資料庫欄位遷移，既有資料保持相容。

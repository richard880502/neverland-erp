# 運費代墊模式

`shippingPayer = REIMBURSABLE` 代表：

- Neverland 先支付物流費。
- 出貨時仍建立 Finance 物流費支出。
- B2B 請款預覽會把該運費列入可回收運費。
- 同一 `shippingGroupKey` 只計一次運費，避免同箱多 SKU 重複加總。
- 此模式只適用寄賣與買斷通路；直營通路仍使用公司 / 客戶 / 通路直接負擔的既有規則。

這個模式沿用既有 `defaultShippingPayer` / `shippingPayer` 字串欄位，不需要資料庫欄位遷移，既有資料保持相容。

## 明細運費（實付 / 應收拆開）

經銷出貨單與庫存異動（含幫經銷代寄）可改填三個金額，取代 `shippingFee` / `shippingPayer`：

| 欄位 | 意義 |
|---|---|
| `shippingActual` | 物流實際收費 |
| `shippingPaid` | Neverland 實際支付，記一筆 Finance 物流支出（同一 `shippingGroupKey` 只記一次） |
| `shippingRecoverable` | 之後向寄賣 / 買斷通路請款回收的金額，不可超過 `shippingPaid` |

- 金額存在 `ShippingGroup`；異動上的舊欄位只保存「我方支付」（`COMPANY`，付 0 時為 `CHANNEL`），所以不會被舊版代墊規則重複請款。
- 請款預覽會帶入期間內尚未請款的 `shippingRecoverable`；建立請款單時寫入 `BillingShippingClaim`（每個群組唯一），作廢請款單會釋放，之後可重新請款。請款運費不可少於本期待回收總額，要少收請先改出貨單的「向通路回收」。
- 出貨單運費可留空表示「待確認」：出貨時不套用通路預設運費，之後在出貨紀錄「補登運費」，系統會同步群組、異動與同一筆 Finance 支出；已列入請款的運費需先作廢請款單才能修改。

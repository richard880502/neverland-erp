# Neverland ERP

Neverland ERP 是為 Neverland 品牌商品、總倉、直營與寄賣通路設計的輕量 ERP / 庫存後台。系統以 PostgreSQL 的庫存異動帳作為正式資料來源，從異動即時計算各 SKU 在總倉與各通路的庫存，並提供銷售分析、商品圖片、帳號權限、Google Authenticator 雙重驗證、Google Sheet 同步、請款管理，以及 Remote MCP / OAuth 整合。

> Current release target: **v3.0.2**

## v3.0.2 — Billing statements and Google Sheets workflow

v3.0.2 新增經銷 / 寄賣請款流程，讓 ERP 直接產生請款快照、計算應收金額，並沿用既有 `Neverland請款單` Google Sheet 公版進行線上編輯。

- 新增 `BillingStatement` / `BillingStatementItem` 請款快照，保存客戶資料、商品、數量、建議售價、經銷價、稅率、運費與總額。
- 選擇客戶與日期區間後，可依庫存異動自動帶入建議品項與數量；使用者仍可自由增刪品項、修改數量或完全手動建立請款單。
- 寄賣通路依 `CONSIGN_SOLD` 建議請款，買斷通路依 `BUYOUT` 建議請款；日期只作為自動帶入便利功能，不限制人工請款。
- 請款單編號依請款日期自動產生，例如 `BL-202608-001`、`BL-202609-001`，每月流水號重新起算。
- 請款詳情新增 `Google 試算表` 按鈕：ERP 會在既有 `Neverland請款單` 試算表中複製 `範本` 頁籤，命名為對應 `BL-...`，填入 ERP 請款資料後直接開啟該頁籤。
- 已存在的 `BL-...` 頁籤只會重新開啟，不會再次覆蓋，保留財務人員在線上手動調整的內容。
- 商品超過公版原本 15 列時，由 Google Sheets 在付款區塊上方動態插入商品列，讓 Google 原生排版引擎處理 Footer、印章與版面位置。
- PostgreSQL 仍是請款資料 source of truth；Google Sheet 僅作為正式文件、排版與人工編輯層。
- XLSX / PDF 直接匯出仍保留為 fallback，目前由 LibreOffice UNO 處理；後續排版一致性追蹤於 [#15](https://github.com/richard880502/neverland-erp/issues/15)。

## v3.0.0 — Stateless storage and admin productivity

v3.0.0 將商品圖片儲存全面改為私有 MinIO／S3-compatible Object Storage，並加入商品定價與後台操作體驗的改善。

- 商品圖片上傳、讀取與刪除皆使用 MinIO；資料庫僅保存 object key，不再有 runtime 本機上傳 fallback。
- 保留 Sharp 產生 1600px 原圖與 320px 縮圖 WebP，圖片透過短效簽名網址供已授權使用者直接讀取。
- 提供既有商品圖片的一次性遷移工具與完整驗證流程，讓 ERP 可以維持 stateless 部署。
- 管理員可在商品管理頁直接編輯售價，包含精簡的價格編輯介面與 API 權限控管。
- 側欄帳號頭像針對中文 initials、帳號區塊與日期篩選樣式進行調整，提升緊湊版面的一致性。

## v2.0.0 — Medusa-aligned Admin UI

v2.0.0 主要更新 Neverland ERP 的後台視覺系統，讓它與 `neverland-medusa` 的 Admin Dashboard 使用同一套產品語言，同時保留原本 ERP 的 business logic、API、權限與資料模型。

這次外觀更新包含：

- 全新的 Medusa-inspired App Shell：淺色 Sidebar、分組導覽、active state、breadcrumb 與 compact account control。
- 統一的 neutral surface、border、shadow、radius、spacing 與 typography hierarchy。
- interactive / focus / chart accent 改為 Medusa 類型的 blue + neutral 色系，不再使用原本的紫色主視覺。
- Dashboard KPI、filter、chart、Inventory、Products、Channels、Movements、Users、Google Sheet Sync 與 Account / Security 頁面整體視覺統一。
- Login page 改為管理後台 auth card，並修正 viewport 置中、brand mark 對齊與窄畫面呈現。
- Sidebar 左下角帳號資訊加入固定 action column 與 ellipsis，長 email / role 不再溢出。
- 核心管理頁共用 `PageHeader`，減少各頁自行維護不同 header 樣式。
- Desktop 為主要操作體驗，同時保留 tablet / narrow viewport fallback。

UI implementation 採用本地 design tokens / primitives 對齊 Medusa，而不是把 Medusa Dashboard runtime 直接嵌入 ERP，因此 ERP 仍維持獨立的 Next.js application。

## 核心功能

### Inventory / Stock ledger

- 商品 / SKU / 尺寸即時庫存。
- 總倉、寄賣據點與可調貨位置。
- 進貨、出貨、銷貨退回、進貨退出、寄賣出貨、寄賣退回、寄賣售出、買斷、瑕疵與庫存調整。
- 商品選擇支援 SKU / 名稱 / 尺寸快速搜尋與編碼排序。
- 寄賣代發會在同一個 Serializable transaction 中建立 `CONSIGN_RETURN` + 直營 `SHIP`，從寄賣經銷扣庫存並將營收歸入直營通路。
- 銷貨退回會回補倉庫並扣回已售數量與營收；進貨退出會扣除總倉庫存。
- 負庫存防護、沖銷與稽核紀錄。
- PostgreSQL 不可變更異動帳作為正式庫存來源。

### Billing / Accounts receivable

- 寄賣與買斷通路請款單建立、明細快照與應收總額計算。
- 依日期區間自動帶入請款建議品項，也支援完全手動建立。
- 客戶公司資料、統編、聯絡資訊、結算折數、稅率與付款條件可由通路主檔自動帶入。
- 支援商品小計、營業稅、運費與請款總額計算。
- 支援標記已收款與請款單作廢，保留 audit history。
- `Google 試算表` 可直接複製既有請款公版並開啟對應 `BL-...` 頁籤線上修改。
- XLSX / PDF 直接匯出保留為 fallback。

### Dashboard

- 日期、通路與商品全域篩選。
- 銷售額 / 銷量趨勢。
- 通路占比、熱銷與滯銷排行。
- KPI 與前一期比較。
- 即時庫存與低庫存 SKU。

### Product / Channel master data

- 商品 SKU、名稱、尺寸、安全庫存、價格、成本、文案與圖片。
- 直營、寄賣、買斷等通路主檔。
- 啟用 / 停用與有歷史資料時的刪除保護。

### Accounts & Security

- 管理員、庫存人員、檢視者角色。
- Cookie session、bcrypt、登入失敗鎖定與 audit log。
- Google Authenticator 相容 TOTP 與一次性備援碼。
- 帳號停用、密碼重設與 session revoke。

### Google Sheet sync

- Google Sheet URL / ID 後台設定。
- 主檔預覽、衝突檢查與安全套用。
- 每日排程同步。
- Inventory Outbox Queue 寫回 Google Sheet。
- 重試、防重複、同步歷史與錯誤狀態。
- 請款流程另沿用既有 `Neverland請款單` Google Sheet 公版；ERP Service Account 必須具備該試算表編輯權限。

### Remote MCP / OAuth

ERP 提供 protected, stateless Streamable HTTP MCP endpoint，可讓支援 MCP / OAuth 的 agent 或 assistant 在使用者權限範圍內操作 ERP。

庫存寫入採兩階段 preview / confirmation，包含：

- `create_inventory_movement`：一般庫存異動
- `create_sales_return`：銷貨退回
- `create_purchase_return`：進貨退出
- `create_consignment_direct_fulfillment`：寄賣代發
- `reverse_inventory_movement`：沖銷既有異動

確認 commit 時仍會重新執行角色、OAuth scope、通路類型、價格與庫存驗證，並將異動加入 Google Sheet 同步 queue。

完整設定與連線說明：[`docs/mcp-chatgpt-codex.md`](docs/mcp-chatgpt-codex.md)

## 技術架構

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16、React 19、TypeScript |
| Charts | Recharts |
| Backend | Next.js Route Handlers |
| ORM | Prisma 6 |
| Database | PostgreSQL 16 |
| Auth | Cookie Session、bcrypt、TOTP、OAuth 2.1 / MCP |
| Images | Sharp、WebP、private MinIO／S3-compatible Object Storage |
| Google | Google Sheets API、Service Account |
| Document export | Google Sheets、LibreOffice UNO (XLSX/PDF fallback) |
| Runtime | Node.js 24、Docker |
| Deployment | Zeabur |

## Local development

使用 Docker：

```bash
cp .env.example .env
docker compose up --build
```

直接使用 Node.js：

```bash
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

常用檢查：

```bash
npm test
npm run test:integration
npm run lint
npm run build
```

## Documentation

原本 README 中完整的資料權責、庫存帳本、Google Sheet 同步、Service Account、Docker、Zeabur、備份、安全與維運說明已完整保留在：

- [`docs/operations-reference.md`](docs/operations-reference.md) — ERP 完整操作與維運文件
- [`docs/mcp-chatgpt-codex.md`](docs/mcp-chatgpt-codex.md) — Remote MCP / OAuth / ChatGPT / Codex 連線文件

## Data ownership principles

- PostgreSQL 是 ERP 的正式帳本；Google Sheet 是主檔來源、相容的異動檢視表，以及請款文件的線上排版 / 編輯層。
- BillingStatement / BillingStatementItem 是請款建立當下的正式 ERP 快照；Google Sheet 手動修改不會反向改寫既有請款快照。
- 庫存不是可直接覆寫的單一數字，而是所有有效 Stock Movement 加總後的結果。
- 歷史異動不直接修改或刪除，錯誤資料透過沖銷處理。
- 已有歷史關聯的商品與通路不能任意刪除。
- Google Sheet 同步使用唯一鍵、內容雜湊與同步基準做衝突判斷，不是整表覆蓋。

## CI

GitHub Actions 會在 push / pull request 執行：

1. `npm ci`
2. `npx prisma migrate deploy`
3. `npm test`
4. `npm run test:integration`
5. Billing XLSX template validation / LibreOffice UNO smoke test
6. `npm run lint`
7. `npm run build`

只有 CI 全部通過後才應合併到 `main`。

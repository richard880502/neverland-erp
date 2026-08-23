# Neverland ERP

Neverland ERP 是為 Neverland 品牌商品、總倉、直營與寄賣通路設計的輕量 ERP / 庫存後台。系統以 PostgreSQL 的庫存異動帳作為正式資料來源，從異動即時計算各 SKU 在總倉與各通路的庫存，並提供銷售分析、商品圖片、帳號權限、Google Authenticator 雙重驗證、Google Sheet 同步，以及 Remote MCP / OAuth 整合。

> Current release target: **v2.0.0**

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
- 進貨、出貨、寄賣出貨、寄賣退回、寄賣售出、買斷、瑕疵與庫存調整。
- 負庫存防護、沖銷與稽核紀錄。
- PostgreSQL 不可變更異動帳作為正式庫存來源。

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

### Remote MCP / OAuth

ERP 提供 protected, stateless Streamable HTTP MCP endpoint，可讓支援 MCP / OAuth 的 agent 或 assistant 在使用者權限範圍內操作 ERP。

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
| Images | Sharp、WebP、persistent Volume |
| Google | Google Sheets API、Service Account |
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

- PostgreSQL 是 ERP 的正式帳本；Google Sheet 是主檔來源與相容的異動檢視表。
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
5. `npm run lint`
6. `npm run build`

只有 CI 全部通過後才應合併到 `main`。

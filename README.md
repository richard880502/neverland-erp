# Neverland ERP

Neverland ERP 是面向品牌商品、總倉、直營與寄賣通路的輕量 ERP，涵蓋商品／庫存、銷售分析、財務與請款、Google Sheets 同步，以及可透過 ChatGPT／Codex 操作的 Remote MCP。

資料以 **PostgreSQL 為正式來源**：庫存由不可變更的異動帳計算；請款金額與品項快照保存在 ERP。Google Sheets 用於同步與請款文件的線上編輯，不作為正式帳本。

> **最新已發布版本：v3.0.7** · **準備發布：v3.0.8**（`package.json` 版本已更新，尚未建立 Release）
>
> [GitHub Releases](https://github.com/richard880502/neverland-erp/releases) · [MCP 連線說明](docs/mcp-chatgpt-codex.md) · [操作與維運參考](docs/operations-reference.md)

## v3.0.8 — MCP 與 ERP API 對齊、精簡請款匯出（待發布）

- **MCP 庫存與物流對齊**：`create_inventory_movement` 支援物流方式、運費、負擔者與物流群組；預覽顯示預計物流支出，並驗證確認後是否有通路預設值變更。
- **批次庫存異動**：新增 `create_inventory_movements_batch`，同批多 SKU 以同一筆交易處理、共用物流群組，避免公司／代墊運費被逐品項重複記帳；任一品項失敗則整批回滾。
- **MCP 財務寫入**：新增 `create_finance_transaction`，透過 `finance:write` OAuth 授權、角色檢查及兩階段確認建立手動收支，避免重複建立系統自動產生的物流支出。
- **防止 API／MCP 功能落差**：CI 新增欄位／型別契約測試（`npm run test:parity`）與資料庫整合測試，檢查庫存、物流、財務的實際寫入結果與權限。
- **退役 LibreOffice**：移除低使用率的請款 PDF／XLSX 伺服器端匯出、UNO 渲染程式與相關 Docker 依賴。請款仍可透過 **Google 試算表 → 檔案 → 下載** 取得 PDF／Excel；財務 Excel 匯入所需的 Python 3 繼續保留。

相關變更：[MCP 對齊 PR #83](https://github.com/richard880502/neverland-erp/pull/83) · [CI 精簡 PR #85](https://github.com/richard880502/neverland-erp/pull/85) · [LibreOffice 退役 PR #87](https://github.com/richard880502/neverland-erp/pull/87)／[Issue #84](https://github.com/richard880502/neverland-erp/issues/84)。

## 主要功能

| 模組 | 功能 |
| --- | --- |
| **商品與庫存** | SKU、尺寸、價格、圖片；總倉／各通路庫存；進出貨、寄賣、退貨、盤點調整與沖銷；負庫存防護及稽核紀錄。 |
| **銷售分析** | 銷售額、銷量、通路佔比、熱銷商品與低庫存指標。 |
| **財務管理** | 收入、費用、分類、付款與對帳狀態、發票資料、Excel 匯入，以及符合條件的物流支出自動同步。 |
| **請款管理** | 寄賣／買斷請款快照、稅額與運費計算、收款／作廢紀錄；由既有 Google Sheet 公版建立請款頁籤並保留人工修改。 |
| **Google Sheets** | 商品／庫存異動同步佇列、重試與歷史紀錄；ERP 資料和 Sheet 文件權責分離。 |
| **Remote MCP** | 透過 OAuth 2.1 授權 Agent 查詢或異動庫存、請款與財務；高風險寫入採預覽／確認流程，沿用 ERP 權限與業務驗證。 |
| **安全與帳號** | 角色權限、雙重驗證（TOTP）、登入與連線撤銷、操作稽核。 |

### MCP 使用方式

1. 在 ERP 的「**設定 → AI 助理連線設定**」選擇 ChatGPT 或 Codex，依引導取得連線資訊。
2. MCP Endpoint 為 `https://<erp-domain>/mcp`；完成 ERP OAuth 授權後，Agent 只能使用授權範圍內的工具。
3. 庫存、請款、財務等寫入操作遵循預覽／使用者確認；`finance:write` 必須額外授權。

設定與工具清單請見 [Remote MCP 文件](docs/mcp-chatgpt-codex.md)；API／MCP 防回歸規則請見 [Parity Gate](docs/mcp-api-parity.md)。目前的契約測試涵蓋主要庫存與財務寫入流程，**不代表所有 REST API 都已有對應 MCP 工具**。

## 技術架構

| 項目 | 採用技術 |
| --- | --- |
| Web / API | Next.js 16、React 19、TypeScript、Route Handlers |
| 資料庫 / ORM | PostgreSQL 16、Prisma 7 |
| 認證 / MCP | Session、TOTP、OAuth 2.1、Streamable HTTP MCP |
| 圖片 | Sharp／WebP、私有 S3 相容 Object Storage（例如 MinIO） |
| Google 整合 | Google Sheets API、Service Account |
| 執行與部署 | Node.js 24、Docker、Coolify |
| 額外執行環境 | Python 3（財務 Excel 匯入；不包含 LibreOffice） |

## 本機啟動

先依 `.env.example` 建立環境設定，填入資料庫、物件儲存及必要的 Google 憑證。

使用 Docker Compose：

```bash
cp .env.example .env
docker compose up --build
```

或於已準備 PostgreSQL 的環境執行：

```bash
npm ci
npx prisma migrate deploy
npm run db:seed
npm run dev
```

正式部署需設定 HTTPS 公開網址（`NEXT_PUBLIC_APP_URL`），並妥善管理 MCP OAuth、Google Service Account、資料庫與物件儲存憑證。詳細操作請參考 [維運文件](docs/operations-reference.md)。

## 開發檢查與發布

```bash
npm test                    # 單元與契約相關測試
npm run test:parity         # MCP ↔ ERP API 欄位／權限對齊
npm run test:integration    # PostgreSQL 業務流程與副作用
npm run lint
npm run build
```

PR 的 GitHub Actions CI 同時執行相依性安全檢查與 Docker 建置／健康檢查；正式部署由 Coolify 工作流程追蹤。財務 Excel 匯入的 Python parser 也保留靜態檢查。

**v3.0.8 發版方式**：當 `main` 的 CI、安全性、Docker 及 Coolify 檢查通過後，在 GitHub **Actions → Publish release → Run workflow** 選擇 `main`，輸入 `v3.0.8`。工作流程會核對 `package.json`、`package-lock.json`、README 的版本說明及必要檢查，再建立 Git Tag／GitHub Release；**合併或部署不會自動發布 Release**。

## 文件與歷史

- [歷史版本與完整更新紀錄 — GitHub Releases](https://github.com/richard880502/neverland-erp/releases)（v3.0.7 及之前的版本）
- [MCP / OAuth 設定與工具說明](docs/mcp-chatgpt-codex.md)
- [MCP ↔ API 對齊測試規範](docs/mcp-api-parity.md)
- [財務模組技術文件](docs/finance/README.md)
- [ERP 詳細維運參考](docs/operations-reference.md)

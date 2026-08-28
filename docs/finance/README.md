# Neverland ERP Finance Module

## Goal
Build a lightweight finance/cashflow module inside the existing ERP without mixing finance states with product, order, inventory, or purchasing states.

## Current implementation status

Implemented on `feature/finance-module`:

- Finance workspace at `/finance`.
- Monthly income, expense, cash-flow, and receivable KPIs.
- Income entry separated into sales channel, customer/store, product, quantity, summary, and amount.
- Expense entry separated into expense group, expense detail, payee, related store/person, product, quantity, summary, and amount.
- Product revenue ranking by month.
- Expense structure grouped by top-level category.
- Income channel ranking by month.
- Independent payment, reconciliation, and invoice statuses.
- Transaction list/create/update API with existing ERP authentication and audit logging.
- Legacy `.xlsx` preview parser for `115年收支明細`, including the optimized `收支細項` layout.
- Import buckets: READY / REVIEW / REJECTED.
- Persisted import batch and import rows before commit.
- Confirmed import by server-side `batchId`; browser-submitted normalized rows are not trusted at commit time.
- Legacy sheet + row idempotency protection.
- Exact unique product-name + size matching to existing ERP products when importing historical rows.
- Finance models registered through Prisma multi-file schema plus deployable migrations.

Not included in the current accounting scope yet:

- Double-entry bookkeeping / general ledger.
- Automatic bank reconciliation.
- Detailed invoice attachment workflow and historical invoice-sheet matching.
- Full receivable/payable sub-ledgers.
- Medusa / Shopee live synchronization.
- MCP finance tools.

## Domain boundaries

- Commerce owns product/order lifecycle.
- Inventory owns stock and stock movement.
- Purchasing owns suppliers and purchase orders.
- Finance owns money movement, invoice/payment/reconciliation state, and reporting.
- Finance may reference products/orders/vendors but must not mutate their domain status directly.

## Transaction semantics

The optimized spreadsheet showed that one generic `subCategory` is not enough. Income and expense use different concepts.

### Income

```text
Direction: INCOME
Sales channel: 蝦皮 / 官網 / 經銷 / 親友 / IG / other
Customer/store: optional
Product items: optional
Summary: optional
Amount
```

For example, `收支細項 = 經銷` is stored as `salesChannel = 經銷`; `經銷/店家 = Chambers` is stored as the transaction counterparty and can also resolve to an existing ERP Channel when names match.

### Expense

```text
Direction: EXPENSE
Expense group
  -> Expense detail
Payee: optional
Related store/person: optional
Product items: optional
Summary
Amount
```

`counterparty` means the actual payer/payee side of the money movement. `relatedParty` is contextual. This distinction matters for legacy rows such as an outbound shipping expense where `經銷/店家 = Simon` means the shipment was related to Simon, while the actual payee may be 郵局 or 7-11.

### Summary vs note

- `summary`: what the money was for, corresponding to the spreadsheet `項目` field.
- `note`: operational remarks, invoice references, exceptions, payment notes, etc.

## Expense taxonomy

Top-level groups are not directly selectable for a transaction; users select a leaf detail.

```text
商品成本
├ 製作費
├ 再製費
└ 進貨運費

物流
└ 出貨運費

行銷
├ 公關品
├ 拍攝
├ 租棚費用
└ 廣告費

營運
├ 包裝 / 文具
├ 會計
├ 網站 / 軟體
├ 會費
└ 其他
```

Legacy V1 categories remain readable for historical transactions but obsolete duplicate picker options are hidden.

## Core entities

### FinanceTransaction
- occurredAt
- direction: INCOME | EXPENSE
- amount
- categoryId
- salesChannel
- counterparty
- relatedParty
- summary
- channelId (optional existing ERP Channel reference id)
- source: MANUAL | EXCEL | BILLING | SHOPEE | BANK | OTHER
- sourceRef
- paymentStatus
- reconciliationStatus
- invoiceStatus
- legacySheet / legacyRow
- note
- createdById

### FinanceTransactionItem
A transaction may contain zero or more product lines. This enables monthly product revenue and product-cost analysis without putting product lifecycle state inside Finance.

```text
FinanceTransaction
  -> FinanceTransactionItem
       -> productId (optional existing ERP product reference)
```

Historical/imported rows preserve product name/size even when a unique ERP product cannot be matched.

### FinanceCategory
Hierarchical category structure with a fixed income/expense direction. Expense parent categories are grouping nodes; transactions use leaf details.

### FinanceInvoice
Transaction-linked invoice metadata and status. Detailed attachment and historical invoice matching remain follow-up work.

### FinanceImportBatch / FinanceImportRow
Import previews are persisted before any transaction is created.

- Batch records filename, summary, creator, and completion state.
- Rows preserve source sheet + row number, raw values, normalized values, status, and reason.
- Commit accepts a batch id and re-reads READY rows on the server.
- `(legacySheet, legacyRow)` prevents duplicate historical transactions.

## Excel migration strategy

The spreadsheet is a legacy source, not the target data model.

```text
.xlsx
  -> parse-finance-xlsx.py
  -> normalized rows
     - 科目 -> direction
     - 收支細項 -> salesChannel or expense category
     - 經銷/店家 -> customer/store or relatedParty
     - 製作（廠商） -> production + inferred payee
     - 項目 -> summary
     - 產品名稱/尺寸/件數 -> transaction items
  -> READY / REVIEW / REJECTED
  -> persisted FinanceImportBatch
  -> user confirms READY rows
  -> server reloads batch
  -> product/category/channel mapping
  -> FinanceTransaction + FinanceTransactionItem
```

Negative amounts or negative quantities are intentionally classified as REVIEW rather than silently imported because they can represent refunds, returns, or adjustments. `發票明細` is not auto-linked yet because invoice matching needs stricter rules than date/amount guessing.

## State isolation

Do not use one generic shared `status` across domains.

Examples:
- Product: product lifecycle / active state
- Order/Billing: their own payment and document states
- Finance: paymentStatus / reconciliationStatus / invoiceStatus

A product can remain active while a related Finance transaction is pending, refunded, or reconciled. Finance only references the product.

## API

- `GET /api/finance/transactions`
- `POST /api/finance/transactions`
- `PATCH /api/finance/transactions/:id`
- `POST /api/finance/import/preview`
- `POST /api/finance/import/commit`

Writes require existing ERP ADMIN/STAFF authorization and use the ERP audit log pattern.

## Follow-up roadmap

### V1.1
- Review/edit UI for REVIEW import rows.
- Invoice detail create/edit and attachment storage.
- Transaction drawer with item/invoice history.
- Refund/reversal workflow instead of manual negative transactions.

### V1.2
- Receivable/payable due dates and aging.
- Bank/platform CSV import and reconciliation suggestions.
- Link BillingStatement paid events into FinanceTransaction.

### V2 integrations
- Medusa order/refund events.
- Shopee settlement import/API.
- Bank feeds where available.
- MCP tools such as `finance.transactions.list`, `finance.transactions.create`, `finance.import.preview`, `finance.reconcile`, and `finance.report.summary`.

# Neverland ERP Finance Module

## Goal
Build a lightweight finance/cashflow module inside the existing ERP without mixing finance states with product, order, inventory, or purchasing states.

## V1 implementation status

Implemented on `feature/finance-module`:

- Finance workspace at `/finance`.
- Monthly income, expense, cash-flow, and receivable KPIs.
- Manual income/expense entry with category, counterparty, note, and optional product relation.
- Product revenue ranking by month from finance transaction items.
- Finance categories with explicit INCOME / EXPENSE direction.
- Independent payment, reconciliation, and invoice statuses.
- Transaction list/create/update API with existing ERP authentication and audit logging.
- Legacy `.xlsx` preview parser for `115年收支明細`.
- Import buckets: READY / REVIEW / REJECTED.
- Persisted import batch and import rows before commit.
- Confirmed import by server-side `batchId`; browser-submitted normalized rows are not trusted at commit time.
- Legacy sheet + row idempotency protection.
- Exact unique product-name + size matching to existing ERP products when importing historical rows.
- Finance models registered through Prisma multi-file schema plus deployable migration.

Not included in V1 accounting scope yet:

- Double-entry bookkeeping / general ledger.
- Automatic bank reconciliation.
- Detailed invoice attachment workflow and historical invoice-sheet matching.
- Full receivable/payable sub-ledgers.
- Medusa / Shopee live synchronization.
- MCP finance tools.

These are follow-up capabilities and should build on the FinanceTransaction foundation rather than change product lifecycle state.

## Domain boundaries

- Commerce owns product/order lifecycle.
- Inventory owns stock and stock movement.
- Purchasing owns suppliers and purchase orders.
- Finance owns money movement, invoice/payment/reconciliation state, and reporting.
- Finance may reference products/orders/vendors but must not mutate their domain status directly.

## Core entities

### FinanceTransaction
- occurredAt
- direction: INCOME | EXPENSE
- categoryId
- counterparty
- amount
- channelId (optional reference id)
- source: MANUAL | EXCEL | BILLING | SHOPEE | BANK | OTHER
- sourceRef
- paymentStatus
- reconciliationStatus
- invoiceStatus
- legacySheet / legacyRow
- note
- createdById

### FinanceTransactionItem
A transaction may contain zero or more product lines. This is what enables monthly product revenue analysis without putting product state inside Finance.

```text
FinanceTransaction
  -> FinanceTransactionItem
       -> productId (optional existing ERP product reference)
```

Historical/imported rows may preserve product name/size even when a unique ERP product cannot be matched.

### FinanceCategory
Hierarchical category structure with a fixed income/expense direction.

Initial categories:
- 商品銷售
- 經銷收入
- 商品成本 / 製作費
- 行銷 / 宣傳
- 物流 / 運費
- 行政 / 雜支

### FinanceInvoice
Transaction-linked invoice metadata and status. V1 creates the schema/status boundary; detailed attachment and historical invoice matching remain follow-up work.

### FinanceImportBatch / FinanceImportRow
Import previews are persisted before any transaction is created.

- Batch records filename, summary, creator, and completion state.
- Rows preserve source sheet + row number, raw values, normalized values, status, and reason.
- Commit accepts a batch id and re-reads READY rows on the server.
- `(legacySheet, legacyRow)` prevents duplicate historical transactions.

## Excel migration strategy

The existing spreadsheet is a legacy source, not the target data model.

```text
.xlsx
  -> parse-finance-xlsx.py
  -> normalized rows
  -> READY / REVIEW / REJECTED
  -> persisted FinanceImportBatch
  -> user confirms READY rows
  -> server reloads batch
  -> product/category mapping
  -> FinanceTransaction + FinanceTransactionItem
```

Current parser focuses on `115年收支明細` and recognizes the existing mixed income/expense structure. `發票明細` is intentionally not auto-linked yet because invoice matching needs stricter rules than date/amount guessing.

## State isolation

Do not use one generic shared `status` across domains.

Examples:
- Product: product lifecycle / active state
- Order/Billing: their own payment and document states
- Finance: paymentStatus / reconciliationStatus / invoiceStatus

A product can remain active while a related Finance transaction is pending, refunded, or reconciled. Finance only references the product.

## API V1

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
- Expense-by-category visualization.
- Transaction drawer with item/invoice history.

### V1.2
- Receivable/payable due dates and aging.
- Bank/platform CSV import and reconciliation suggestions.
- Link BillingStatement paid events into FinanceTransaction.

### V2 integrations
- Medusa order/refund events.
- Shopee settlement import/API.
- Bank feeds where available.
- MCP tools such as `finance.transactions.list`, `finance.transactions.create`, `finance.import.preview`, `finance.reconcile`, and `finance.report.summary`.

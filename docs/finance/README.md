# Neverland ERP Finance Module

## Goal
Build a lightweight finance/cashflow module inside the existing ERP without mixing finance states with product, order, inventory, or purchasing states.

## Domain boundaries

- Commerce owns product/order lifecycle.
- Inventory owns stock and stock movement.
- Purchasing owns suppliers and purchase orders.
- Finance owns transactions, invoices, receivables/payables, reconciliation, and reporting.
- Finance may reference products/orders/vendors but must not mutate their domain status directly.

## Core entities

### Transaction
- id
- transaction_date
- direction: income | expense
- category_id
- counterparty_id (optional)
- amount
- currency
- payment_account_id (optional)
- payment_status: unpaid | partially_paid | paid | refunded
- reconciliation_status: unmatched | matched | reconciled
- source_type: manual | medusa | shopee | bank_csv | excel_import | other
- source_id (optional)
- product_id/order_id/purchase_order_id (optional references)
- project_id (optional)
- note
- created_by
- created_at / updated_at

### FinanceCategory
Hierarchical category tree for consistent classification.

### Invoice
- transaction_id
- invoice_number
- issued_at
- gross_amount
- net_amount
- tax_amount
- status: missing | received | voided | allowance
- attachment_url (optional)

### Receivable / Payable
- linked transaction/order/purchase order
- due_date
- amount_due
- amount_paid
- status

### Reconciliation
Links imported bank/platform settlement records to ERP finance transactions.

## Frontend V1

1. Finance Dashboard
2. Transactions
3. Transaction Create/Edit Drawer
4. Receivables & Payables
5. Reconciliation
6. Category Settings
7. Import Center (Excel/CSV)

## Excel migration strategy

Current spreadsheet is treated as a legacy source, not as the target data model.

Pipeline:

```text
Excel / CSV
   -> source parser
   -> normalized import row
   -> mapping layer
   -> validation
   -> preview/dry-run
   -> approved import
   -> Finance domain entities
```

### Import requirements
- Preserve source sheet + row number for traceability.
- Normalize income vs expense.
- Normalize category names and aliases.
- Parse invoice number/status separately from free text.
- Match existing ERP products/vendors/orders when possible.
- Do not auto-create ambiguous relations silently.
- Produce three result buckets: ready, needs_review, rejected.
- Import must be idempotent using source fingerprint/import batch id.

## State isolation

Do not use one generic shared `status` across domains.

Examples:
- Product: product_status
- Order: order_status / payment_status / fulfillment_status
- Finance: payment_status / reconciliation_status / invoice_status

A purchase order may be `received` while its related payable remains `unpaid`; both states are valid simultaneously.

## Suggested implementation phases

### Phase 1 - foundation
- schema and migrations
- finance categories
- transaction CRUD
- transaction list + drawer
- import batch schema

### Phase 2 - migration
- legacy Excel parser
- mapping rules
- dry-run preview
- manual review flow
- first historical import

### Phase 3 - operations
- receivables/payables
- invoice attachments
- reconciliation
- dashboard aggregates

### Phase 4 - integrations
- Medusa order events
- Shopee CSV/API
- bank CSV
- MCP finance tools

## MCP candidates
- finance.transactions.list
- finance.transactions.create
- finance.transactions.update
- finance.invoices.create
- finance.receivables.list
- finance.payables.list
- finance.reconcile
- finance.import.preview
- finance.import.commit
- finance.report.summary

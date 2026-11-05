# MCP ↔ ERP API parity gate

This repository treats the ERP domain validation schemas as the source of truth
for *writable* inventory and finance operations. MCP must not silently lose
fields when browser/API behavior evolves.

## Required CI checks

```bash
npm run test:parity           # fast schema/permission/discovery contract
npm run test:integration      # database-backed side-effect parity
```

`.github/workflows/ci.yml` runs both on every PR, in addition to the existing
tests, lint, and Next.js build. The CI job fails if either parity suite fails.

> To **block merging** a red PR, configure GitHub Settings → Rules → Rulesets
> (or branch protection) for `main` and require the `CI / test` check.
> A failed Actions workflow alone is not an unconditional merge restriction.

## What is protected

| Source of truth | MCP tool | Contract |
| --- | --- | --- |
| `movementInputSchema` (used by `POST /api/movements`) | `create_inventory_movement` | All top-level writable fields; `productId` → `sku`; required fields and movement type enum |
| Same movement schema | `create_inventory_movements_batch` | Shipping fields, typed SKU/quantity rows, confirmation token |
| Same movement schema | `create_sales_return`, `create_purchase_return` | Shipping fields, fee bounds, payer enum |
| `consignmentDirectFulfillmentSchema` | `create_consignment_direct_fulfillment` | All fields; `productId` → `sku` |
| `financeCreateSchema` (used by `POST /api/finance/transactions`) | `create_finance_transaction` | All allowed writable fields, required fields, status enums, item and invoice fields, numeric limits |

The finance MCP intentionally **does not** expose `source`, `sourceRef`,
`legacySheet`, or `legacyRow`. MCP writes must remain `MANUAL` and cannot
forge auto-generated shipping expenses. The contract test explicitly names
these exceptions; any change to the API fields forces review.

Both entrypoint tests ensure the HTTP route still invokes the matching shared
domain service. The database integration tests exercise actual MCP preview and
commit calls against the same service used by HTTP handlers, checking equivalent
persisted movements, shipping expenses and finance transactions. They also
exercise atomic multi-SKU shipments, a single shared shipping expense,
rejected overdrawn batches, stale confirmation previews, role and OAuth scopes.

## When adding a feature

1. Update the **API/domain Zod schema** and business service.
2. Update MCP discovery (`inputSchema`) **and** its runtime parser; changing
   only a description is not enough. Preserve the preview/confirm flow.
3. Add an integration case comparing the resulting database fields/side effects.
4. If a field is deliberately web-only or system-controlled, add a documented,
   narrowly scoped exception to `tests/mcp-api-parity.test.ts`; otherwise
   leave the test failing until MCP supports it.
5. Run the parity and integration tests, then check CI in the PR.

### Important boundary

These checks cover the **inventory, shipment, returns, consignment
fulfillment, and finance-create operations listed above**. They do not claim
that every ERP REST endpoint has an MCP equivalent, or that an actual
authenticated browser HTTP session was exercised. Expand the contract table
and tests when onboarding additional API families.

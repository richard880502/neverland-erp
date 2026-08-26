# Neverland ERP Remote MCP

Neverland ERP exposes a protected, stateless Streamable HTTP MCP endpoint at:

```text
https://<erp-domain>/mcp
```

It uses a credential separate from the ERP browser session. The access token and refresh token are random opaque values; only their SHA-256 hashes are stored. Revoking a connection invalidates both kinds of token immediately.

## Deployment

1. Deploy the app behind HTTPS and set its public, canonical URL:

   ```dotenv
   NEXT_PUBLIC_APP_URL=https://erp.example.com
   ```

2. Apply the database migration:

   ```bash
   npm run db:migrate
   ```

3. The authorization server supports Client ID Metadata Documents (CIMD) and retains Dynamic Client Registration at `/register` for backward compatibility. Web clients must register HTTPS callbacks and use an exact registered redirect URI. Native/CLI clients may register only HTTP loopback callbacks on `127.0.0.1`, `[::1]`, or `localhost`; for those loopback callbacks the host, path, and query must match the registered URI, while the ephemeral port may change between authorization attempts.

4. Configure edge rate limiting as a second layer for `/mcp`, `/authorize`, `/token`, and `/revoke`. The application has per-instance guardrails, but edge limits work across replicas.

## Discovery and OAuth

The deployment serves:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
/authorize
/token
/revoke
```

Only Authorization Code + PKCE `S256` is accepted. Implicit and password grants are not exposed. Tokens are audience-bound to `https://<erp-domain>/mcp`; a token cannot be replayed against another endpoint. The authorization metadata advertises `offline_access`, which is selected by default so ChatGPT can use the rotating refresh token without requiring frequent sign-in.

Authorization responses include the RFC 9207 `iss` parameter, exactly matching the authorization metadata issuer. The MCP endpoint uses stateless JSON-RPC and negotiates the stable 2025 protocol versions without sticky routing.

When an MCP client first calls `/mcp` without a token, it receives a `401` and a `WWW-Authenticate` header pointing at the protected-resource metadata. The host then opens the Neverland ERP login page, where the user sees a consent screen. Read scopes are selected by default; the following are unchecked until explicitly approved:

- `inventory:write`
- `movements:reverse`
- `sync:run`
- `billing:write`

`billing:read` is a normal read scope and is part of the default read-only grant set. `billing:write` is intentionally separated so an assistant can inspect and preview receivables without gaining authority to create or void financial documents.

ERP roles are still authoritative. Effective permission is the intersection of the OAuth scope and the role: a Viewer cannot gain write capability by requesting a write scope. Billing writes are available only to Staff/Admin users.

## Inventory write tools

With `inventory:write`, Staff/Admin users can use the following two-phase tools:

- `create_inventory_movement` — general stock ledger events.
- `create_sales_return` — replenishes warehouse inventory and subtracts sold quantity/revenue. Requires the original sales channel and transaction price so net sales reporting remains correct.
- `create_purchase_return` — removes stock from the warehouse for supplier returns without deleting or editing the original receive event.
- `create_consignment_direct_fulfillment` — deducts stock from a CONSIGNMENT source while attributing the sale to a DIRECT channel. Commit creates `CONSIGN_RETURN` and `SHIP` inside one Serializable transaction.

The read tool `list_inventory_movements` recognizes `SALES_RETURN` and `PURCHASE_RETURN`. `get_sales_summary` and `get_sales_by_channel` include `SALES_RETURN` with a negative sign, so returned quantity and refund amount reduce net quantity and net revenue.

## Billing tools

With `billing:read`, any ERP role can discover the read-only Billing tools permitted by its OAuth grant:

- `list_billing_statements` — filters by channel, company / statement number keyword, status and issued-date range.
- `get_billing_statement` — returns the immutable customer, item and pricing snapshot for a BillingStatement ID or `BL-...` statement number.
- `preview_billing_statement` — reads `CONSIGN_SOLD` or `BUYOUT` movements for a period and calculates suggested quantities, settlement price, tax, shipping and total without creating a BillingStatement.

With `billing:write`, Staff/Admin users can use:

- `create_billing_statement` — accepts manual items or items copied from a preview. Items can be addressed by `productId` or SKU. The first call returns a financial preview and a five-minute `confirmationToken`; the second identical call commits the BillingStatement.
- `void_billing_statement` — destructive two-phase action for `ISSUED` statements only. Paid or already-void statements remain protected by the Billing domain service.
- `create_billing_google_sheet` — two-phase external write that creates or opens the matching `BL-...` tab in the existing `Neverland請款單` workbook. Existing tabs are returned without overwriting manual edits.

Billing confirmation snapshots include the channel and product update state. If customer master data or product pricing changes between preview and commit, the old confirmation token no longer matches and the assistant must show a fresh preview before committing. Database BillingStatement data remains the source of truth; the Google Sheet is still the document / manual-editing layer and is written by the ERP Service Account rather than the MCP user's Google identity.

Successful Billing writes also add MCP-specific audit events containing `source=MCP`, `connectionId` and `clientId`, in addition to the existing Billing domain audit events.

## ChatGPT / Codex acceptance test

1. In the MCP host, add a custom remote MCP server with `https://<erp-domain>/mcp`.
2. Start the connection. The MCP host automatically registers its public client, then opens Neverland ERP login.
3. Sign in to Neverland ERP, select only the scopes required, and approve.
4. Scan tools. Verify `get_inventory`, `get_low_stock`, `get_sheet_sync_status`, and—with `billing:read`—the three Billing read tools work.
5. With an Inventory/Admin account and `inventory:write`, ask for a movement. The host must present confirmation because the tool is non-read-only and non-idempotent. For reversal, the tool is additionally marked destructive. Verify approval creates an immutable movement, audit record, and Google Sheet queue item.
6. Verify `create_sales_return` preview shows warehouse/sold before-and-after plus refund amount, then commit and confirm net sales decrease.
7. Verify `create_purchase_return` rejects a quantity larger than current warehouse stock and, after confirmation, reduces warehouse stock.
8. Verify `create_consignment_direct_fulfillment` rejects non-CONSIGNMENT sources and non-DIRECT sales channels. A valid commit must create both movements together and attribute revenue only to the direct channel.
9. With `billing:read`, preview a consignment period and confirm suggested quantity and calculated total match ERP Billing rules. Then grant `billing:write`, call `create_billing_statement`, confirm the returned preview, repeat with its `confirmationToken`, and verify a `BL-YYYYMM-xxx` statement is created.
10. Confirm `void_billing_statement` requires a second explicit approval and that a Viewer cannot execute Billing writes even if `billing:write` was requested.
11. Confirm `create_billing_google_sheet` requires approval and returns the generated / existing Google Sheet tab URL without overwriting an existing `BL-...` tab.
12. Open **設定 → AI Assistants / MCP**, revoke the connection, then confirm both a current access token and refresh-token reconnect fail.

For Codex CLI:

```bash
codex mcp add neverland-erp --url https://<erp-domain>/mcp --oauth-client-registration dcr
codex mcp login neverland-erp
```

The browser returns to a short-lived loopback callback after login and consent. `application_type=native`, PKCE S256, loopback host/path/query matching, ephemeral loopback ports, and refresh-token rotation are supported. The authorization code still stores the exact redirect URI used for that authorization attempt, and the token exchange must send that exact same URI.

## Operational notes

- MCP never exposes passwords, TOTP secrets, backup codes, session tokens, service-account credentials, raw Prisma access, SQL, or filesystem operations.
- Inventory write tools reuse the ERP domain services and retain Serializable transactions, stock/consignment constraints, immutable reversal behavior, outbox queue, and audit logs.
- Billing write tools reuse `createBillingStatement`, `voidBillingStatement`, and `openBillingGoogleSheet`; MCP does not bypass Billing totals, role checks, statement status rules, or Google Sheet duplicate protection.
- High-risk write tools use a server-side two-phase flow in addition to MCP annotations. The first call returns a five-minute, connection-bound, single-use `confirmationToken` and performs no write. After explicit user approval, the client repeats the exact same arguments with that token. Changed arguments, expired/replayed tokens, a different user/connection/client, and domain-state conflicts are rejected.
- Keep `NEXT_PUBLIC_APP_URL` stable. Changing it invalidates the OAuth resource audience and requires re-authorizing clients.

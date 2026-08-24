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

ERP roles are still authoritative. Effective permission is the intersection of the OAuth scope and the role: a Viewer cannot gain write capability by requesting a write scope.

## Inventory write tools

With `inventory:write`, Staff/Admin users can use the following two-phase tools:

- `create_inventory_movement` — general stock ledger events.
- `create_sales_return` — replenishes warehouse inventory and subtracts sold quantity/revenue. Requires the original sales channel and transaction price so net sales reporting remains correct.
- `create_purchase_return` — removes stock from the warehouse for supplier returns without deleting or editing the original receive event.
- `create_consignment_direct_fulfillment` — deducts stock from a CONSIGNMENT source while attributing the sale to a DIRECT channel. Commit creates `CONSIGN_RETURN` and `SHIP` inside one Serializable transaction.

The read tool `list_inventory_movements` recognizes `SALES_RETURN` and `PURCHASE_RETURN`. Sales summary tools calculate returns with a negative sign so quantity and revenue are net values rather than gross sales only.

## ChatGPT / Codex acceptance test

1. In the MCP host, add a custom remote MCP server with `https://<erp-domain>/mcp`.
2. Start the connection. The MCP host automatically registers its public client, then opens Neverland ERP login.
3. Sign in to Neverland ERP, select only the scopes required, and approve.
4. Scan tools. Verify `get_inventory`, `get_low_stock`, and `get_sheet_sync_status` work.
5. With an Inventory/Admin account and `inventory:write`, ask for a movement. The host must present confirmation because the tool is non-read-only and non-idempotent. For reversal, the tool is additionally marked destructive. Verify approval creates an immutable movement, audit record, and Google Sheet queue item.
6. Verify `create_sales_return` preview shows warehouse/sold before-and-after plus refund amount, then commit and confirm net sales decrease.
7. Verify `create_purchase_return` rejects a quantity larger than current warehouse stock and, after confirmation, reduces warehouse stock.
8. Verify `create_consignment_direct_fulfillment` rejects non-CONSIGNMENT sources and non-DIRECT sales channels. A valid commit must create both movements together and attribute revenue only to the direct channel.
9. With a Viewer account, request `inventory:write`; tool execution must fail even if the scope was granted.
10. Open **設定 → AI Assistants / MCP**, revoke the connection, then confirm both a current access token and refresh-token reconnect fail.

For Codex CLI:

```bash
codex mcp add neverland-erp --url https://<erp-domain>/mcp --oauth-client-registration dcr
codex mcp login neverland-erp
```

The browser returns to a short-lived loopback callback after login and consent. `application_type=native`, PKCE S256, loopback host/path/query matching, ephemeral loopback ports, and refresh-token rotation are supported. The authorization code still stores the exact redirect URI used for that authorization attempt, and the token exchange must send that exact same URI.

## Operational notes

- MCP never exposes passwords, TOTP secrets, backup codes, session tokens, service-account credentials, raw Prisma access, SQL, or filesystem operations.
- `create_inventory_movement`, `create_sales_return`, `create_purchase_return`, `create_consignment_direct_fulfillment`, and `reverse_inventory_movement` reuse the ERP domain services. They retain the Serializable transaction, stock/consignment constraints, immutable reversal pattern, outbox queue, and audit log.
- High-risk write tools use a server-side two-phase flow in addition to MCP annotations. The first call returns a five-minute, connection-bound, single-use `confirmationToken` and performs no write. After explicit user approval, the client repeats the exact same arguments with that token. Changed arguments, expired/replayed tokens, a different user/connection/client, and domain-state conflicts are rejected. Movement commit and reversal still re-run the Serializable domain transaction before writing.
- Keep `NEXT_PUBLIC_APP_URL` stable. Changing it invalidates the OAuth resource audience and requires re-authorizing clients.
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

3. The authorization server supports Client ID Metadata Documents (CIMD) and retains Dynamic Client Registration at `/register` for backward compatibility. Web clients must register HTTPS callbacks. Native/CLI clients may register only HTTP loopback callbacks on `127.0.0.1`, `[::1]`, or `localhost`; every callback still requires an exact registered URI match, including port and path.

4. Configure edge rate limiting as a second layer for `/mcp`, `/authorize`, `/token`, and `/revoke`. The application has per-instance guardrails, but edge limits work across replicas.

## Discovery and OAuth

The deployment serves:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-authorization-server
/authorize
/token
/revoke
```

Only Authorization Code + PKCE `S256` is accepted. Implicit and password grants are not exposed. Tokens are audience-bound to `https://<erp-domain>/mcp`; a token cannot be replayed against another endpoint.

Authorization responses include the RFC 9207 `iss` parameter, exactly matching the authorization metadata issuer. MCP `2026-07-28` requests are handled without protocol sessions or sticky routing and must carry `MCP-Protocol-Version`, `Mcp-Method`, and, for `tools/call`, `Mcp-Name`. The same endpoint keeps a stateless 2025-era fallback for clients that have not upgraded yet.

When an MCP client first calls `/mcp` without a token, it receives a `401` and a `WWW-Authenticate` header pointing at the protected-resource metadata. The host then opens the Neverland ERP login page, where the user sees a consent screen. Read scopes are selected by default; the following are unchecked until explicitly approved:

- `inventory:write`
- `movements:reverse`
- `sync:run`

ERP roles are still authoritative. Effective permission is the intersection of the OAuth scope and the role: a Viewer cannot gain write capability by requesting a write scope.

## ChatGPT / Codex acceptance test

1. In the MCP host, add a custom remote MCP server with `https://<erp-domain>/mcp`.
2. Start the connection. The MCP host automatically registers its public client, then opens Neverland ERP login.
3. Sign in to Neverland ERP, select only the scopes required, and approve.
4. Scan tools. Verify `get_inventory`, `get_low_stock`, and `get_sheet_sync_status` work.
5. With an Inventory/Admin account and `inventory:write`, ask for a movement. The host must present confirmation because the tool is non-read-only and non-idempotent. For reversal, the tool is additionally marked destructive. Verify approval creates an immutable movement, audit record, and Google Sheet queue item.
6. With a Viewer account, request `inventory:write`; tool execution must fail even if the scope was granted.
7. Open **設定 → AI Assistants / MCP**, revoke the connection, then confirm both a current access token and refresh-token reconnect fail.

For Codex CLI:

```bash
codex mcp add neverland-erp --url https://<erp-domain>/mcp --oauth-client-registration dcr
codex mcp login neverland-erp
```

The browser returns to a short-lived loopback callback after login and consent. `application_type=native`, PKCE S256, exact redirect matching, and refresh-token rotation remain mandatory.

## Operational notes

- MCP never exposes passwords, TOTP secrets, backup codes, session tokens, service-account credentials, raw Prisma access, SQL, or filesystem operations.
- `create_inventory_movement` and `reverse_inventory_movement` reuse the ERP domain service. They retain the Serializable transaction, stock/consignment constraints, immutable reversal pattern, outbox queue, and audit log.
- High-risk write tools use a server-side two-phase flow in addition to MCP annotations. The first call returns a five-minute, connection-bound, single-use `confirmationToken` and performs no write. After explicit user approval, the client repeats the exact same arguments with that token. Changed arguments, expired/replayed tokens, a different user/connection/client, and domain-state conflicts are rejected. Movement commit and reversal still re-run the Serializable domain transaction before writing.
- Keep `NEXT_PUBLIC_APP_URL` stable. Changing it invalidates the OAuth resource audience and requires re-authorizing clients.

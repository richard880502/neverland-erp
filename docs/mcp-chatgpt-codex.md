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

3. The server supports OAuth Dynamic Client Registration at `/register`. ChatGPT/Codex registers its public client and exact HTTPS callback URI automatically during the first connection; no per-client environment variable is required. The server stores only the public client identifier, display name, and exact redirect URI allowlist.

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

When an MCP client first calls `/mcp` without a token, it receives a `401` and a `WWW-Authenticate` header pointing at the protected-resource metadata. The host then opens the Neverland ERP login page, where the user sees a consent screen. Read scopes are selected by default; the following are unchecked until explicitly approved:

- `inventory:write`
- `movements:reverse`
- `sync:run`

ERP roles are still authoritative. Effective permission is the intersection of the OAuth scope and the role: a Viewer cannot gain write capability by requesting a write scope.

## ChatGPT / Codex draft test

1. In the MCP host, add a custom remote MCP server with `https://<erp-domain>/mcp`.
2. Start the connection. The MCP host automatically registers its public client, then opens Neverland ERP login.
3. Sign in to Neverland ERP, select only the scopes required, and approve.
4. Scan tools. Verify `get_inventory`, `get_low_stock`, and `get_sheet_sync_status` work.
5. With an Inventory/Admin account and `inventory:write`, ask for a movement. Confirm the host presents the non-read-only tool confirmation. Verify it creates an immutable movement, audit record, and Google Sheet queue item.
6. With a Viewer account, request `inventory:write`; tool execution must fail even if the scope was granted.
7. Open **設定 → AI Assistants / MCP**, revoke the connection, then confirm both a current access token and refresh-token reconnect fail.

## Operational notes

- MCP never exposes passwords, TOTP secrets, backup codes, session tokens, service-account credentials, raw Prisma access, SQL, or filesystem operations.
- `create_inventory_movement` and `reverse_inventory_movement` reuse the ERP domain service. They retain the Serializable transaction, stock/consignment constraints, immutable reversal pattern, outbox queue, and audit log.
- Write tool metadata marks movement creation as non-idempotent and reversal as destructive-ish. The MCP host must obtain user confirmation before calling either.
- Keep `NEXT_PUBLIC_APP_URL` stable. Changing it invalidates the OAuth resource audience and requires re-authorizing clients.

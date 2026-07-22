# Connecting the MCP server to Claude (with OAuth)

The API ships with an embedded **OAuth 2.1 authorization server** so Claude's
connectors — on the web **and the mobile apps** — can auto-discover the MCP
server and sign in, without you pasting a static API key into a header (which
Claude's connector UI doesn't support).

## How it works

When Claude connects to `https://<your-api-host>/mcp/sse` it runs the standard
MCP auth handshake:

1. The MCP endpoint returns `401` with
   `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.
2. Claude fetches `/.well-known/oauth-protected-resource` → learns which
   authorization server to use.
3. Claude fetches `/.well-known/oauth-authorization-server` → endpoint list.
4. Claude registers itself automatically (Dynamic Client Registration).
5. Claude opens `/oauth/authorize` — a consent screen where **you paste your
   Free Video Maker API key** to prove who you are.
6. Claude exchanges the code (PKCE) at `/oauth/token` for an access token and
   uses it as a bearer token on every MCP call.

Tokens map 1:1 onto tenants, so per-tenant quotas and video ownership keep
working exactly as with a raw API key. Access tokens last 1 hour and Claude
refreshes them automatically with the long-lived refresh token.

### Endpoints

| Path | Purpose |
|------|---------|
| `/.well-known/oauth-protected-resource` | RFC 9728 resource metadata |
| `/.well-known/oauth-authorization-server` | RFC 8414 AS metadata |
| `/oauth/register` | Dynamic Client Registration (RFC 7591) |
| `/oauth/authorize` | Consent + login (enter your API key) |
| `/oauth/token` | `authorization_code` (PKCE) + `refresh_token` grants |

## Setup

1. Enable auth on the API service and set an admin key (this is the key you'll
   paste on the consent screen), on Render → `free-video-maker-api` →
   Environment:
   ```
   AUTH_ENABLED=true
   ADMIN_API_KEY=<openssl rand -hex 24>
   ```
   (Provision additional per-customer keys via `POST /api/admin/tenants`.)
2. Public origin: Render sets `RENDER_EXTERNAL_URL` automatically, so discovery
   URLs are correct out of the box. Only set `PUBLIC_URL` if you use a custom
   domain.
3. On your phone (or claude.ai): **Settings → Connectors → Add custom
   connector**, paste the **Streamable HTTP** endpoint (note: `/mcp`, not
   `/mcp/sse`):
   ```
   https://<your-api-host>/mcp
   ```
   Tap **Connect** → the consent screen appears → paste your API key →
   authorize. It syncs to the mobile app automatically, and the tools appear.

## Notes

- No new dependencies — the OAuth server is plain Express + Node crypto,
  file-backed under `DATA_DIR_PATH/oauth.json` (keep the persistent disk).
- Raw `x-api-key` / `Authorization: Bearer <api-key>` still works for scripts
  and desktop clients; OAuth is additive.
- Transport: the server speaks the current **Streamable HTTP** transport at
  `/mcp` (what Claude's connectors use to open the session and list tools),
  and still exposes the **legacy SSE** transport at `/mcp/sse` + `/mcp/messages`
  for older clients. Prefer `/mcp`.

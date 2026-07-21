# Ad Generation Service — Backend Guide

This backend wraps the open-source short-video engine with two things needed to
run it as a paid, multi-customer service:

1. **An ad layer** that specializes the engine for Meta, TikTok, YouTube, etc.
2. **Authentication + authorization** on both the REST API and the MCP server,
   with per-customer (tenant) isolation, plans, and monthly quotas.

You build the frontend / sales / onboarding pages; they talk to the API below.

---

## 1. How the ad layer works

A caller submits an **ad brief** (product, hook, benefits, CTA, platform). The
`AdCreator` turns that brief into the scenes + render config the engine already
understands, applying platform conventions:

| Platform | Orientation | Aspect | Max | Recommended |
|---|---|---|---|---|
| `meta` / `facebook` / `instagram` / `instagram_reels` | portrait | 9:16 | 60–90s | 20s |
| `tiktok` | portrait | 9:16 | 60s | 25s |
| `snapchat` | portrait | 9:16 | 60s | 15s |
| `youtube_shorts` | portrait | 9:16 | 60s | 30s |
| `youtube` (in-stream) | landscape | 16:9 | 30s | 15s |

**Formats** (`ugc`, `problem_solution`, `testimonial`, `product_showcase`,
`promo`, `explainer`) control scene structure, default music mood, and how the
hook/CTA are phrased when not supplied.

Scene composition: `hook → one scene per benefit → CTA`. Captions default to
each platform's safe zone; music volume is forced low so the voiceover stays
intelligible. The result is a normal `videoId` polled/downloaded through the
same endpoints as any other video.

---

## 2. Authentication & authorization

- **API keys → tenants.** Every request carries a key
  (`Authorization: Bearer <key>` or `x-api-key`). Each key maps to one tenant.
- **Ownership.** Every rendered video is owned by the tenant that created it.
  Status/download/delete/list are scoped to the owner; admins see everything.
- **Plans & quotas.** `free / starter / growth / scale` with monthly video
  quotas and concurrency limits (`src/auth/types.ts`). Creation endpoints
  return `429` when the monthly quota is hit.
- **Admin key.** `ADMIN_API_KEY` bootstraps an admin tenant that can provision
  customers via `/api/admin/*`.
- **Toggle.** Auth turns on when `AUTH_ENABLED=true` or `ADMIN_API_KEY` is set;
  otherwise the service runs in single-user local mode (a synthetic local admin
  tenant), preserving the original OSS behavior.

> The reference tenant store is a JSON file on the data disk
> (`src/auth/TenantStore.ts`). It's correct for a single node. To scale out,
> replace it with a Postgres/Redis-backed class implementing the same methods —
> nothing else changes.

---

## 3. API reference

### Public
- `GET /health` — liveness.

### Admin (require the admin key)
- `GET /api/admin/plans`
- `GET /api/admin/tenants`
- `POST /api/admin/tenants` `{ name, email?, plan? }` → **returns the raw API key once**
- `GET /api/admin/tenants/:id`
- `PATCH /api/admin/tenants/:id` `{ name?, email?, plan?, disabled? }`
- `POST /api/admin/tenants/:id/rotate-key` → returns a new raw key
- `DELETE /api/admin/tenants/:id`

Your billing webhook (e.g. Stripe) calls `POST /api/admin/tenants` on signup and
`PATCH` on plan change / cancellation.

### Customer (require a tenant key)
- `GET  /api/ad-platforms` — platform specs
- `GET  /api/ad-formats` — narrative formats
- `POST /api/ads/preview` — expand a brief into scenes (no quota spent)
- `POST /api/ads` — create an ad → `{ videoId }` (counts against quota)
- `POST /api/short-video` — generic scene-based video → `{ videoId }`
- `GET  /api/short-video/:id/status` — `processing | ready | failed`
- `GET  /api/short-video/:id` — download the MP4
- `GET  /api/short-videos` — list the tenant's videos
- `DELETE /api/short-video/:id`
- `GET  /api/usage` — current period usage for the tenant
- `GET  /api/voices`, `GET /api/music-tags`

### MCP (require a tenant key)
- `GET  /mcp/sse`, `POST /mcp/messages` — SSE transport, authenticated.
  Each connection is bound to the calling tenant. Tools:
  `create-ad`, `create-short-video`, `get-video-status`, `list-ad-platforms`.

### Example — provision a customer, then create an ad

```bash
# Operator provisions a customer
curl -X POST https://api.example.com/api/admin/tenants \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Co","email":"team@acme.com","plan":"growth"}'
# -> { "tenant": {...}, "apiKey": "svm_live_..." }   (store this now)

# Customer creates a TikTok ad
curl -X POST https://api.example.com/api/ads \
  -H "Authorization: Bearer svm_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "tiktok",
    "format": "ugc",
    "productName": "GlowSerum",
    "productDescription": "A vitamin C serum for brighter skin in 2 weeks",
    "benefits": ["Fades dark spots fast", "Feels weightless", "Cruelty-free"],
    "callToAction": "Grab yours at glowserum.com",
    "brandName": "GlowSerum",
    "targetAudience": "skincare lovers"
  }'
# -> { "videoId": "..." }  then poll GET /api/short-video/:id/status
```

---

## 4. Environment variables

| Key | Purpose |
|---|---|
| `PEXELS_API_KEY` | required — background B-roll |
| `AUTH_ENABLED` | `true` to require API keys |
| `ADMIN_API_KEY` | bootstrap admin key; implies `AUTH_ENABLED` |
| `DATA_DIR_PATH` | where videos + `tenants.json` live (mount a disk) |
| `CONCURRENCY` | Chrome tabs per render (memory sensitive) |
| `WHISPER_MODEL` / `KOKORO_MODEL_PRECISION` | quality vs. memory |
| `PORT` | listen port |

See `docs/SCALING.md` for hardware sizing and how to run this for many
customers.

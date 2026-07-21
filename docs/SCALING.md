# System Requirements & Scaling

This document sizes the backend for a subscription service with many customers.

## The one thing that dictates everything: rendering is heavy and serial

Each video runs, on one CPU-bound process:

1. Kokoro **TTS** (per scene)
2. Whisper **captions** (per scene)
3. **Pexels** B-roll download
4. **Remotion + headless Chrome** rendering every frame

There is **no GPU path**. Out of the box the engine renders **one video at a
time** per process (an in-memory FIFO queue) and stores output on the **local
disk**. That's fine for one box; it is the thing you must change to serve many
customers. Everything below follows from it.

### Per-render cost (rules of thumb)

| Item | Typical |
|---|---|
| RAM per concurrent render | **3–4 GB** (Chrome + models) |
| vCPU per concurrent render | **2** (rendering is CPU-bound) |
| Time for a ~20–30s vertical ad | **~2–5 min** (model size dependent) |
| Throughput per worker (CONCURRENCY=1) | **~15–25 videos/hour** |
| Disk per worker | **~10 GB** (models + temp + video cache) |

---

## Reference architecture for scale

Split the single process into three tiers so you can scale the expensive part
independently:

```
                       ┌────────────────────┐
   customers  ─────►   │  API / control plane│   (stateless, cheap, autoscale)
   onboarding ─────►   │  REST + MCP + admin │
                       └─────────┬──────────┘
                                 │ enqueue job
                                 ▼
                       ┌────────────────────┐
                       │   Job queue         │   Redis + BullMQ  (or SQS)
                       └─────────┬──────────┘
                                 │ pull job
                                 ▼
                       ┌────────────────────┐
                       │  Render workers     │   (the 3–4 GB / 2 vCPU boxes,
                       │  N × CONCURRENCY=1  │    autoscaled on queue depth)
                       └─────────┬──────────┘
                                 │ upload mp4
                                 ▼
             Object storage (S3/R2)   +   Postgres (tenants, usage, ownership)
```

What to change in this codebase to get there (all isolated, interfaces already
exist):

1. **Tenant store → Postgres.** Replace `src/auth/TenantStore.ts` with a
   Postgres/Redis implementation exposing the same methods. Nothing else in the
   auth layer changes. (The JSON file store is single-node only.)
2. **Queue → Redis/BullMQ (or SQS).** Replace the in-memory array in
   `ShortCreator.addToQueue` with a durable queue; run the API and the workers
   as separate deployments off the same queue.
3. **Storage → S3/R2.** Write finished MP4s and serve downloads via presigned
   URLs instead of the local `videosDirPath`. Lets workers be ephemeral.
4. **Autoscale workers on queue depth**, not CPU (a worker pegs 2 vCPU for the
   whole render, so CPU-based autoscaling reacts too late).

Until you do (2)+(3), you scale **vertically only** (one bigger box, higher
`CONCURRENCY`), and you're capped by that box's RAM.

---

## Sizing by customer volume

Assume the average paying customer makes ~5 videos/month and peak load is ~4×
the average hour. Adjust to your funnel.

| Customers | ~Videos/mo | Peak videos/hr | Render workers* | Data stores |
|---|---|---|---|---|
| Pilot (≤50) | ~250 | ~5 | **1** worker (4 GB/2 vCPU) | JSON store OK; local disk |
| Small (~500) | ~2.5k | ~15 | **1–2** workers | Postgres (small) + object storage |
| Growing (~2k) | ~10k | ~50 | **3–4** workers | Postgres + Redis queue + S3 |
| Scale (~10k) | ~50k | ~200 | **10–15** workers, autoscaled | Managed PG + Redis + S3 + CDN |

\* worker = one 2 vCPU / 4 GB box running `CONCURRENCY=1`. A 4 vCPU / 8 GB box
can run `CONCURRENCY=2` ≈ two workers. Keep ~30% headroom for spikes.

### Supporting components (all tiers past pilot)

- **API / control plane:** 1–2 small instances (1 vCPU / 1 GB), stateless,
  behind a load balancer. Handles auth, admin, enqueue, status, download proxy.
- **Postgres:** starts tiny; it only holds tenants, usage, ownership. A managed
  db-1 class instance is plenty into the thousands of customers.
- **Redis:** small managed instance for the job queue + optional rate limiting.
- **Object storage:** S3/Cloudflare R2 for rendered videos; add a CDN in front
  for download traffic. Set a lifecycle policy (e.g. delete after 30–90 days).
- **Bandwidth:** a 9:16 ad is ~3–15 MB; downloads dominate egress, which is why
  object storage + CDN matters once volume grows.

---

## Cost-control levers already wired in

- `WHISPER_MODEL` (`tiny.en` → `medium.en`): smaller = faster + less RAM.
- `KOKORO_MODEL_PRECISION` (`q4` → `fp32`): quantized = less RAM.
- `CONCURRENCY`: renders per worker; raise only with RAM to match (≈3–4 GB each).
- `VIDEO_CACHE_SIZE_IN_BYTES`: Remotion asset cache; larger = faster re-renders,
  more disk.
- **Plans/quotas** (`src/auth/types.ts`): cap per-tenant monthly volume so a
  single customer can't exhaust the render fleet; concurrency limits per plan
  give you fair-use scheduling.

---

## Bottom line recommendation

- **Launch / pilot:** one **4 GB / 2 vCPU** box (or the "tiny" Docker image on a
  Render **Standard**), JSON store, local disk. Handles up to a few hundred
  low-volume customers.
- **Once you have paying volume:** move to the reference architecture — small
  autoscaling API tier + a pool of **4 GB / 2 vCPU render workers** on a Redis
  queue, with Postgres + S3. Scale by adding workers; the API tier barely grows.
- **Never** run the render workers on 512 MB / shared-CPU instances — they OOM
  mid-render. Render is the floor: 2 vCPU / 4 GB per concurrent job, always.

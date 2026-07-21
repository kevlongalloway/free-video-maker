# Free Video Maker — Monorepo

A microservices-style monorepo. Each top-level directory is an independently
deployable project with its own dependencies, build, and Render deploy filter.

```
free-video-maker/
├── api/       # Backend video-generation service (Whisper + Kokoro + Remotion, Express REST + MCP)
├── landing/   # Public marketing / sales site (Astro static site)  — skeleton
├── app/       # Post-signup product frontend (Next.js static site) — skeleton
└── render.yaml  # Render Blueprint for all three services (must stay at repo root)
```

## Projects

| Directory  | What it is                                   | Stack                     | Status   |
|------------|----------------------------------------------|---------------------------|----------|
| `api/`     | Original video-maker backend                 | Node/TS, Express, Remotion | Complete |
| `landing/` | Marketing + pricing/sales page               | Astro + Tailwind CSS      | Skeleton |
| `app/`     | Authenticated dashboard shown after sign-up  | Next.js (App Router, static export) + TS + Tailwind | Skeleton |

See each directory's own `README.md` for how to run and build it.

## Deployment (Render)

All three services are defined in a single [Render Blueprint](https://render.com/docs/blueprint-spec)
at [`render.yaml`](./render.yaml).

Each service uses a `buildFilter` so it **only redeploys when files inside its
own directory change** — updating `landing/` will not rebuild `api/`, and so on.
See ["Adding this to Render"](#adding-this-to-render) below.

### Adding this to Render

1. Push this branch to GitHub.
2. In the Render dashboard: **New + → Blueprint**, connect this repo, pick the branch.
3. Render reads `render.yaml` and provisions all three services.
4. Provide the secrets it prompts for (`PEXELS_API_KEY` for the API; set
   `NEXT_PUBLIC_API_URL` on the app once the API URL is known).

If you already have this repo connected as a Blueprint, Render picks up the new
`render.yaml` on the next push and syncs the new services and build filters
automatically.

# app

The post-signup **frontend web application** for Free Video Maker — the
authenticated product that users see after they sign up. It's the dashboard
where they create and manage videos. (The marketing site lives in `/landing`;
the video-generation backend lives in `/api`.)

## Tech stack

- [Next.js](https://nextjs.org/) (App Router)
- TypeScript
- Tailwind CSS

> This is currently a **skeleton**. The UI is placeholder-only and
> authentication is not wired up yet.

## Getting started

```bash
npm install      # install dependencies
npm run dev      # start the dev server (http://localhost:3000)
npm run build    # production build
npm start        # start the production server
```

## Environment

Copy `.env.example` to `.env.local` and set:

| Variable              | Description                                        |
| --------------------- | -------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | Base URL of the `/api` backend service to call.    |

## Deployment

Deploys on [Render](https://render.com/) as a **Node web service**:

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`

Set `NEXT_PUBLIC_API_URL` in the Render service's environment to point at the
deployed `/api` service.

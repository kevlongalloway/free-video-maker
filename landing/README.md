# Free Video Maker — Landing Site

The public marketing + sales/pricing site for **Free Video Maker**. This is the
skeleton for the landing page (hero, features, pricing, footer). The
post-signup product lives in `/app`; the video-generation backend lives in
`/api`.

## Tech

- [Astro](https://astro.build) (static output — fast, SEO-friendly)
- [Tailwind CSS](https://tailwindcss.com) v3 via `@astrojs/tailwind`

## Getting started

```bash
npm install
npm run dev      # local dev server
npm run build    # production build -> ./dist
npm run preview  # preview the production build
```

## Deployment

Deploys as a **Render static site**.

- Build command: `npm install && npm run build`
- Publish directory: `dist`

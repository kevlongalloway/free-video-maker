/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export so the app can deploy as a Render static site.
  // `next build` writes a fully static site to ./out (no Node server needed).
  output: "export",
  // Static export can't use the Next.js image optimizer.
  images: { unoptimized: true },
  // Emit /route/index.html so paths work without a server rewriting them.
  trailingSlash: true,
};

export default nextConfig;

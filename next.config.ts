import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Embedded Postgres used for zero-config local dev when DATABASE_URL is unset (never loaded in production).
  serverExternalPackages: ["@electric-sql/pglite"],
  async redirects() {
    return [{ source: "/", destination: "/executive", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

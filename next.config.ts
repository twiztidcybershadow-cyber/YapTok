import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  env: {
    // Baked in at build time so /api/version can report it.
    BUILT_AT: new Date().toISOString(),
  },
  // Creator pages live at /@username. A folder cannot start with "@" (that
  // marks a parallel route), so the page sits in app/u/[handle] and this maps it.
  async rewrites() {
    return [
      { source: "/@:handle", destination: "/u/:handle" },
      { source: "/@:handle/:list(followers|following)", destination: "/u/:handle/:list" },
    ];
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

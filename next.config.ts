import type { NextConfig } from "next";

/**
 * Static export: the app is 100% local (data lives in the browser's IndexedDB) – there is no server.
 * When a database arrives, remove `output: "export"` to enable route handlers / middleware.
 */
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;

import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

if (process.env.NEXT_PUBLIC_TYPESAFE_API_KEY) {
  throw new Error("Refusing to build: a public Jev key would ship in the page.");
}

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    return [
      { source: "/api/jev", destination: "http://127.0.0.1:47921/api/jev" },
      { source: "/api/jev/", destination: "http://127.0.0.1:47921/api/jev" },
    ];
  },
};

export default nextConfig;

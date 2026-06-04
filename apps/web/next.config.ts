import type { NextConfig } from "next";

const apiProxyUrl = process.env.RYANOS_INTERNAL_API_URL ?? "http://api:4000";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyUrl}/:path*`
      }
    ];
  }
};

export default nextConfig;

import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/health",
        destination: `${BACKEND_URL}/health`,
      },
      {
        source: "/message/:path*",
        destination: `${BACKEND_URL}/message/:path*`,
      },
      {
        source: "/threads/:path*",
        destination: `${BACKEND_URL}/threads/:path*`,
      },
      {
        source: "/scheduler/:path*",
        destination: `${BACKEND_URL}/scheduler/:path*`,
      },
      {
        source: "/setup/:path*",
        destination: `${BACKEND_URL}/setup/:path*`,
      },
      {
        source: "/config/:path*",
        destination: `${BACKEND_URL}/config/:path*`,
      },
      {
        source: "/secrets/:path*",
        destination: `${BACKEND_URL}/secrets/:path*`,
      },
      {
        source: "/files/:path*",
        destination: `${BACKEND_URL}/files/:path*`,
      },
      {
        source: "/webhooks/:path*",
        destination: `${BACKEND_URL}/webhooks/:path*`,
      },
      {
        source: "/memory/:path*",
        destination: `${BACKEND_URL}/memory/:path*`,
      },
      {
        source: "/tools/:path*",
        destination: `${BACKEND_URL}/tools/:path*`,
      },
      {
        source: "/metrics/:path*",
        destination: `${BACKEND_URL}/metrics/:path*`,
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow GHL media CDN images if needed in future
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.leadconnectorhq.com",
      },
      {
        protocol: "https",
        hostname: "**.gohighlevel.com",
      },
    ],
  },

  // *.tunnelmole.net rather than today's specific subdomain — tunnelmole
  // assigns a new random subdomain every time the tunnel process restarts.
  allowedDevOrigins: ["*.tunnelmole.net"],

  // Required for GHL iframe embedding (Custom Pages)
  async headers() {
    return [
      {
        // Allow /dashboard to be embedded in GHL iframes
        source: "/dashboard",
        headers: [
          {
            key: "X-Frame-Options",
            value: "ALLOWALL",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

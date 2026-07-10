import type { NextConfig } from "next";
// @ts-ignore
import withPWA from 'next-pwa';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  }
};

const pwaConfig = withPWA({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/[a-z]\.tile\.openstreetmap\.org/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'osm-tiles',
        expiration: {
          maxEntries: 500,
          maxAgeSeconds: 86400, // 24 hours
        },
      },
    },
  ],
});

export default process.env.NODE_ENV === 'development'
  ? nextConfig
  : pwaConfig(nextConfig);

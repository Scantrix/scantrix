/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dashboard runs standalone — no external image domains needed

  // Next 16 Turbopack needs system TLS certs to reach Google Fonts
  experimental: {
    turbopackUseSystemTlsCerts: true,
  },
};

module.exports = nextConfig;

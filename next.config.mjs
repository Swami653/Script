/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Server Actions обрабатывают массовый импорт учеников — увеличиваем лимит тела запроса.
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;

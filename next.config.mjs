/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prisma не должен проходить через бандлер, а её движок обязан попасть в функцию
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.prisma/client/**"],
  },
  experimental: {
    // Server Actions обрабатывают массовый импорт учеников — увеличиваем лимит тела запроса.
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;

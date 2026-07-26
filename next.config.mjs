/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prisma не должен проходить через бандлер, а её движок обязан попасть в функцию
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.prisma/client/**"],
  },
  // Защитные заголовки для всех ответов.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Запрет встраивания в чужие iframe — защита от кликджекинга.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // Браузер не «домысливает» тип содержимого.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Реферер не утекает на сторонние сайты.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Отключаем ненужные приложению возможности.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
  experimental: {
    // Server Actions обрабатывают массовый импорт учеников — увеличиваем лимит тела запроса.
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;

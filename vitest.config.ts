import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Конфиг vitest для чистых модулей (signals, grades): среда node,
 * alias @/ как в tsconfig. Компоненты и prisma здесь не тестируются.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

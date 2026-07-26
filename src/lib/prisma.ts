import { PrismaClient } from "@prisma/client";

import { DEMO_MODE, ensureDemoDatabase } from "@/lib/demo-bootstrap";

/**
 * Единственный экземпляр Prisma Client.
 * В dev-режиме Next.js перезагружает модули при каждом изменении файла,
 * поэтому клиент кэшируется в globalThis, чтобы не плодить подключения к SQLite.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  if (!DEMO_MODE) return base;

  /**
   * Демо-стенд: база лежит в /tmp и может не существовать на холодном старте.
   * Расширение гарантирует, что схема и данные созданы до первого запроса —
   * при этом сам bootstrap работает через `base`, без рекурсии.
   */
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          await ensureDemoDatabase(base);
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

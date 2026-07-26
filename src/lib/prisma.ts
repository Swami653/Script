import { PrismaClient } from "@prisma/client";

/**
 * Единственный экземпляр Prisma Client.
 *
 * В dev-режиме Next.js перезагружает модули при каждом изменении файла,
 * поэтому клиент кэшируется в globalThis, чтобы не плодить подключения.
 *
 * На serverless (Vercel) используется пулированное соединение Neon:
 * в DATABASE_URL добавлены `pgbouncer=true&connection_limit=1`, иначе каждый
 * экземпляр функции быстро исчерпает лимит соединений PostgreSQL.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

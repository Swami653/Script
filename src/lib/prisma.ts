import { PrismaClient } from "@prisma/client";

/**
 * Единственный экземпляр Prisma Client.
 * В dev-режиме Next.js перезагружает модули при каждом изменении файла,
 * поэтому клиент кэшируется в globalThis, чтобы не плодить подключения к SQLite.
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

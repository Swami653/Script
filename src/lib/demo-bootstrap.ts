import type { PrismaClient } from "@prisma/client";

import { seedDemoData } from "@/lib/demo-data";

/**
 * ДЕМО-РЕЖИМ (DEMO_MODE=true) — только для стенда на Vercel.
 *
 * На serverless-платформе файловая система доступна на запись лишь в /tmp,
 * поэтому базы данных там при старте нет. Этот модуль создаёт схему и заливает
 * демо-данные при первом обращении экземпляра функции.
 *
 * ВАЖНО: данные живут только пока жив экземпляр. Это витрина, а не продакшн.
 * Для настоящего развёртывания переключите datasource на PostgreSQL
 * и выключите DEMO_MODE (см. README, раздел «Развёртывание»).
 */

export const DEMO_MODE = process.env.DEMO_MODE === "true";

/** Схема из prisma/schema.prisma (`prisma migrate diff --from-empty`). */
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STUDENT',
    "className" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "Subject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "Lesson" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "quarter" INTEGER NOT NULL,
    "topic" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT,
    CONSTRAINT "Lesson_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Lesson_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Grade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "value" INTEGER NOT NULL,
    "subjectId" TEXT NOT NULL,
    "quarter" INTEGER NOT NULL,
    "studentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "teacherId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Grade_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Grade_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Grade_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Grade_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")`,
  `CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role")`,
  `CREATE INDEX IF NOT EXISTS "User_className_idx" ON "User"("className")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Subject_name_key" ON "Subject"("name")`,
  `CREATE INDEX IF NOT EXISTS "Lesson_subjectId_quarter_idx" ON "Lesson"("subjectId", "quarter")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Lesson_subjectId_date_key" ON "Lesson"("subjectId", "date")`,
  `CREATE INDEX IF NOT EXISTS "Grade_studentId_subjectId_quarter_idx" ON "Grade"("studentId", "subjectId", "quarter")`,
  `CREATE INDEX IF NOT EXISTS "Grade_subjectId_quarter_idx" ON "Grade"("subjectId", "quarter")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Grade_studentId_lessonId_key" ON "Grade"("studentId", "lessonId")`,
];

/** Одна попытка на экземпляр функции: параллельные запросы ждут один и тот же промис. */
let bootstrapPromise: Promise<void> | null = null;

async function bootstrap(prisma: PrismaClient): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await prisma.$executeRawUnsafe(statement);
  }

  const users = await prisma.user.count();
  if (users > 0) return;

  const summary = await seedDemoData(prisma);
  console.log(
    `[demo] база создана: учеников ${summary.students}, предметов ${summary.subjects}, ` +
      `уроков ${summary.lessons}, оценок ${summary.grades}`,
  );
}

/** Гарантирует, что схема и демо-данные на месте. Вызывается перед любым запросом. */
export function ensureDemoDatabase(prisma: PrismaClient): Promise<void> {
  if (!DEMO_MODE) return Promise.resolve();
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap(prisma).catch((error) => {
      // Сбрасываем промис, чтобы следующий запрос попробовал снова.
      bootstrapPromise = null;
      throw error;
    });
  }
  return bootstrapPromise;
}

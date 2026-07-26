-- Фаза 2: журнал изменений (аудит) и корзина уроков (мягкое удаление).
--
-- Миграция написана вручную (из среды разработки нет TCP-доступа к базе)
-- и применяется на Vercel скриптом vercel-build через `prisma migrate deploy`.

-- ── AuditLog: журнал изменений ───────────────────────────────────────────────
-- Хранит СНИМКИ имён (actorName, targetName, subjectName) вместо связей:
-- запись должна пережить удаление пользователя, урока и предмета.
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetName" TEXT,
    "subjectName" TEXT,
    "details" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- ── Lesson: корзина (мягкое удаление) ────────────────────────────────────────
ALTER TABLE "Lesson" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Уникальность «один урок на дату по предмету» теперь действует только для
-- живых уроков: урок в корзине не должен блокировать создание нового на ту же
-- дату. Prisma частичные индексы описывать не умеет, поэтому уникальность
-- живёт здесь, а в schema.prisma остаётся обычный @@index([subjectId, date]).
DROP INDEX "Lesson_subjectId_date_key";
CREATE INDEX "Lesson_subjectId_date_idx" ON "Lesson"("subjectId", "date");
CREATE UNIQUE INDEX "Lesson_subjectId_date_live_key"
    ON "Lesson"("subjectId", "date")
    WHERE "deletedAt" IS NULL;

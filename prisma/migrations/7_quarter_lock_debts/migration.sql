-- Фаза 4: замок четверти со снимком итогов (ведомостью) и долги/пересдачи.
--
--  * QuarterLock    — замок: строка существует = четверть по предмету закрыта.
--                     Переоткрытие (только ADMIN) удаляет строку; снимок уходит
--                     каскадом — инвариант «снимок существует ⇔ четверть закрыта».
--  * QuarterResult  — снимок-ведомость на момент закрытия. studentId/subjectId
--                     намеренно БЕЗ внешних ключей, имена — снимками (паттерн
--                     AuditLog): официальная ведомость переживает удаление ученика.
--  * Debt           — долг ученика за конкретный урок-работу. subjectId/year/quarter
--                     денормализованы СТРОГО из урока (инвариант Grade/Absence).
--                     Статус «закрыт оценкой» НЕ хранится — выводится (EXISTS Grade);
--                     clearedAt — терминальное прощение учителем (надгробие).
--
-- CHECK-ограничения — второй рубеж за gradeValueSchema/quarterSchema, не замена
-- схем. Prisma их не описывает: при будущем prisma migrate dev диагностика дрейфа
-- покажет расхождение — принятая цена (прецедент Lesson_subjectId_date_live_key).
--
-- Миграция написана вручную (из среды разработки нет TCP-доступа к базе)
-- и применяется на Vercel скриптом vercel-build через `prisma migrate deploy`.

-- ── QuarterLock: замок четверти по предмету ─────────────────────────────────
CREATE TABLE "QuarterLock" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT NOT NULL,
    "closedByName" TEXT NOT NULL,

    CONSTRAINT "QuarterLock_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QuarterLock_quarter_range" CHECK ("quarter" BETWEEN 1 AND 4)
);

CREATE UNIQUE INDEX "QuarterLock_subjectId_year_quarter_key"
    ON "QuarterLock"("subjectId", "year", "quarter");
CREATE INDEX "QuarterLock_year_quarter_idx" ON "QuarterLock"("year", "quarter");

ALTER TABLE "QuarterLock" ADD CONSTRAINT "QuarterLock_subjectId_fkey"
    FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- closedById намеренно без FK (снимок, как в AuditLog): замок переживает удаление учителя.

-- ── QuarterResult: снимок-ведомость закрытой четверти ───────────────────────
CREATE TABLE "QuarterResult" (
    "id" TEXT NOT NULL,
    "lockId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "className" TEXT,
    "subjectId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "average" DOUBLE PRECISION,
    "finalGrade" INTEGER,
    "gradeCount" INTEGER NOT NULL,
    "absenceCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuarterResult_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QuarterResult_finalGrade_range"
        CHECK ("finalGrade" IS NULL OR "finalGrade" BETWEEN 1 AND 10),
    CONSTRAINT "QuarterResult_quarter_range" CHECK ("quarter" BETWEEN 1 AND 4)
);

CREATE UNIQUE INDEX "QuarterResult_lockId_studentId_key"
    ON "QuarterResult"("lockId", "studentId");
CREATE INDEX "QuarterResult_studentId_year_idx" ON "QuarterResult"("studentId", "year");

ALTER TABLE "QuarterResult" ADD CONSTRAINT "QuarterResult_lockId_fkey"
    FOREIGN KEY ("lockId") REFERENCES "QuarterLock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- studentId/subjectId без FK: ведомость — документ (см. шапку миграции).

-- ── Debt: долги и пересдачи ──────────────────────────────────────────────────
CREATE TABLE "Debt" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'auto',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "clearedAt" TIMESTAMP(3),
    "clearedById" TEXT,

    CONSTRAINT "Debt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Debt_origin_values" CHECK ("origin" IN ('auto', 'manual')),
    CONSTRAINT "Debt_quarter_range" CHECK ("quarter" BETWEEN 1 AND 4)
);

CREATE UNIQUE INDEX "Debt_studentId_lessonId_key" ON "Debt"("studentId", "lessonId");
CREATE INDEX "Debt_subjectId_year_quarter_idx" ON "Debt"("subjectId", "year", "quarter");
CREATE INDEX "Debt_studentId_year_idx" ON "Debt"("studentId", "year");

ALTER TABLE "Debt" ADD CONSTRAINT "Debt_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_lessonId_fkey"
    FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- FK на Subject нет намеренно (прецедент Absence): каскад чистки идёт цепочкой
-- Debt -> Lesson -> Subject; subjectId — денормализованный скаляр для выборок.

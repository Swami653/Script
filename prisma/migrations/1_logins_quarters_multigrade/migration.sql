-- Вход по логину, границы четвертей и две оценки за один урок.
--
-- Миграция написана вручную и сохраняет данные: существующие пользователи
-- получают логин из локальной части почты, а все текущие оценки — позицию 0.

-- ── User: логин вместо обязательной почты ────────────────────────────────────
ALTER TABLE "User" ADD COLUMN "username" TEXT;
UPDATE "User" SET "username" = split_part("email", '@', 1) WHERE "username" IS NULL;
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "User" ADD COLUMN "tempPassword" TEXT;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- ── Grade: несколько оценок за один урок ─────────────────────────────────────
ALTER TABLE "Grade" ADD COLUMN "slot" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "Grade_studentId_lessonId_key";
CREATE UNIQUE INDEX "Grade_studentId_lessonId_slot_key" ON "Grade"("studentId", "lessonId", "slot");

-- ── Учебный год у уроков и оценок ────────────────────────────────────────────
-- Год выводится из даты: сентябрь и позже — начало нового учебного года.
ALTER TABLE "Lesson" ADD COLUMN "year" INTEGER;
UPDATE "Lesson" SET "year" = CASE
    WHEN EXTRACT(MONTH FROM "date") >= 9 THEN EXTRACT(YEAR FROM "date")
    ELSE EXTRACT(YEAR FROM "date") - 1
  END;
ALTER TABLE "Lesson" ALTER COLUMN "year" SET NOT NULL;

ALTER TABLE "Grade" ADD COLUMN "year" INTEGER;
UPDATE "Grade" SET "year" = (SELECT "year" FROM "Lesson" WHERE "Lesson"."id" = "Grade"."lessonId");
ALTER TABLE "Grade" ALTER COLUMN "year" SET NOT NULL;

DROP INDEX "Lesson_subjectId_quarter_idx";
CREATE INDEX "Lesson_subjectId_year_quarter_idx" ON "Lesson"("subjectId", "year", "quarter");

DROP INDEX "Grade_studentId_subjectId_quarter_idx";
DROP INDEX "Grade_subjectId_quarter_idx";
CREATE INDEX "Grade_studentId_subjectId_year_quarter_idx" ON "Grade"("studentId", "subjectId", "year", "quarter");
CREATE INDEX "Grade_subjectId_year_quarter_idx" ON "Grade"("subjectId", "year", "quarter");

-- ── Настройки приложения (активный учебный год) ──────────────────────────────
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- ── QuarterPeriod: границы четвертей учебного года ───────────────────────────
CREATE TABLE "QuarterPeriod" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuarterPeriod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuarterPeriod_year_quarter_key" ON "QuarterPeriod"("year", "quarter");
CREATE INDEX "QuarterPeriod_year_idx" ON "QuarterPeriod"("year");

ALTER TABLE "QuarterPeriod"
    ADD CONSTRAINT "QuarterPeriod_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

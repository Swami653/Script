-- 8_gradeless: безотметочное обучение в 1–2 классах (ведущее число User.className 1..2,
-- предикат isGradelessClassName в src/lib/gradeless.ts; в БД признак НЕ хранится).
--
--  * LessonStamp  — печать-поощрение за урок («Молодец», «Старание», …).
--                   До MAX_STAMPS_PER_LESSON (2) печатей за урок, каждый вид — один раз.
--  * MasteryMark  — уровень освоения за урок (high/medium/low) ВМЕСТО оценки.
--                   Один на клетку: слотов «10/9» у качественной отметки нет.
--  * QuarterNote  — словесная характеристика за четверть по предмету.
--                   К уроку не привязана; год/четверть — первичное измерение.
--
-- НИ ОДНА из трёх таблиц не является оценкой и НИКОГДА не входит в средние баллы.
-- subjectId/year/quarter у поурочных таблиц денормализованы СТРОГО из урока
-- (инвариант Grade/Absence); subjectId — скаляр БЕЗ FK (прецедент Absence/Debt:
-- каскад чистки идёт цепочкой Таблица -> Lesson -> Subject).
-- CHECK-и — второй рубеж за zod-схемами, не замена (прецедент миграции 7).
--
-- Плюс два столбца снимка QuarterResult: ведомость закрытой четверти обязана
-- зафиксировать «безотметочный» статус и текст характеристики как документ.
--
-- Миграция написана вручную (нет TCP-доступа к базе) и применяется на Vercel
-- скриптом vercel-build через `prisma migrate deploy`.

-- ── LessonStamp: печать-поощрение за урок ───────────────────────────────────
CREATE TABLE "LessonStamp" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "teacherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonStamp_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LessonStamp_quarter_range" CHECK ("quarter" BETWEEN 1 AND 4)
);
-- kind без CHECK: словарь расширяемый, источник правды — STAMP_KINDS (прецедент Grade.kind).

CREATE UNIQUE INDEX "LessonStamp_studentId_lessonId_kind_key"
    ON "LessonStamp"("studentId", "lessonId", "kind");
CREATE INDEX "LessonStamp_studentId_year_idx" ON "LessonStamp"("studentId", "year");
CREATE INDEX "LessonStamp_studentId_subjectId_year_quarter_idx"
    ON "LessonStamp"("studentId", "subjectId", "year", "quarter");
CREATE INDEX "LessonStamp_subjectId_year_quarter_idx"
    ON "LessonStamp"("subjectId", "year", "quarter");

ALTER TABLE "LessonStamp" ADD CONSTRAINT "LessonStamp_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonStamp" ADD CONSTRAINT "LessonStamp_lessonId_fkey"
    FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonStamp" ADD CONSTRAINT "LessonStamp_teacherId_fkey"
    FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── MasteryMark: уровень освоения за урок ───────────────────────────────────
CREATE TABLE "MasteryMark" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "comment" TEXT,
    "studentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "teacherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasteryMark_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MasteryMark_level_values" CHECK ("level" IN ('high', 'medium', 'low')),
    CONSTRAINT "MasteryMark_quarter_range" CHECK ("quarter" BETWEEN 1 AND 4)
);

CREATE UNIQUE INDEX "MasteryMark_studentId_lessonId_key"
    ON "MasteryMark"("studentId", "lessonId");
CREATE INDEX "MasteryMark_studentId_subjectId_year_quarter_idx"
    ON "MasteryMark"("studentId", "subjectId", "year", "quarter");
CREATE INDEX "MasteryMark_subjectId_year_quarter_idx"
    ON "MasteryMark"("subjectId", "year", "quarter");

ALTER TABLE "MasteryMark" ADD CONSTRAINT "MasteryMark_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MasteryMark" ADD CONSTRAINT "MasteryMark_lessonId_fkey"
    FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MasteryMark" ADD CONSTRAINT "MasteryMark_teacherId_fkey"
    FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── QuarterNote: словесная характеристика за четверть по предмету ───────────
CREATE TABLE "QuarterNote" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "teacherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuarterNote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QuarterNote_quarter_range" CHECK ("quarter" BETWEEN 1 AND 4)
);

CREATE UNIQUE INDEX "QuarterNote_studentId_subjectId_year_quarter_key"
    ON "QuarterNote"("studentId", "subjectId", "year", "quarter");
CREATE INDEX "QuarterNote_studentId_year_idx" ON "QuarterNote"("studentId", "year");
CREATE INDEX "QuarterNote_subjectId_year_quarter_idx"
    ON "QuarterNote"("subjectId", "year", "quarter");

-- У QuarterNote нет урока, поэтому FK на Subject нужен (каскад чистки предмета).
ALTER TABLE "QuarterNote" ADD CONSTRAINT "QuarterNote_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuarterNote" ADD CONSTRAINT "QuarterNote_subjectId_fkey"
    FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuarterNote" ADD CONSTRAINT "QuarterNote_teacherId_fkey"
    FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── QuarterResult: снимок ведомости узнаёт о безотметочных ──────────────────
-- gradeless=true — строка безотметочного ученика («б/о», не «н/а»);
-- note — снимок характеристики на момент закрытия (документ, без связи с QuarterNote).
-- Таблица новая и мала — NOT NULL DEFAULT дёшев; старый код в окне деплоя
-- пишет строки без этих полей и получает default false / NULL — корректно.
ALTER TABLE "QuarterResult" ADD COLUMN "gradeless" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QuarterResult" ADD COLUMN "note" TEXT;

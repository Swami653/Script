-- 9a_topic_confusion: отметка ученика «не разобрался в теме» (TopicConfusion).
--
-- ПОЧЕМУ КАТАЛОГ НАЗВАН «9a_», А НЕ «10_»: prisma migrate deploy применяет
-- каталоги миграций в ЛЕКСИКОГРАФИЧЕСКОМ порядке имён, а не в числовом.
-- Каталог «10_...» встал бы сразу после «0_init» и ПЕРЕД «1_logins_...»:
-- на боевой базе это незаметно (миграции 0–9 уже применены и записаны в
-- _prisma_migrations по именам), но развернуть проект С НУЛЯ стало бы
-- невозможно — «10_» выполнился бы раньше миграций, создающих его
-- предпосылки. «9a_» лексикографически сортируется после «9_...» и до
-- будущих «9b_»/«9c_». Переименовывать УЖЕ ПРИМЕНЁННЫЕ каталоги нельзя:
-- Prisma помнит применённые миграции по имени папки, и смена имени уронит
-- migrate deploy на проде ошибкой несоответствия истории.
--
-- Модель: строка = живая просьба конкретного ученика «объясните тему этого
-- урока ещё раз». Снятие отметки — удаление строки (надгробий нет: если
-- ребёнок передумал, следа остаться не должно — это приватный сигнал,
-- а не документ и не оценка). В средние баллы, ведомости и CSV не входит.
--
-- Каскады: удаление ученика уносит его отметки (сигнал личный и вне ученика
-- смысла не имеет); удаление урока — отметки его столбца. subjectId —
-- денормализованный скаляр БЕЗ FK (прецедент Absence/Debt/LessonStamp):
-- каскад чистки предмета идёт цепочкой Subject -> Lesson -> TopicConfusion.
-- ИНВАРИАНТ: subjectId/year/quarter всегда равны полям урока и заполняются
-- на сервере только из lesson (src/lib/actions/confusion.ts).

CREATE TABLE "TopicConfusion" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TopicConfusion_pkey" PRIMARY KEY ("id"),
    -- Второй рубеж за zod и денормализацией из урока (стиль миграций 7–9).
    CONSTRAINT "TopicConfusion_quarter_range" CHECK ("quarter" BETWEEN 1 AND 4)
);

-- Одна отметка на пару «ученик × урок»: повторное нажатие снимает, а не дублирует.
CREATE UNIQUE INDEX "TopicConfusion_studentId_lessonId_key"
    ON "TopicConfusion"("studentId", "lessonId");
-- Счётчики столбцов журнала: все отметки предмета за четверть.
CREATE INDEX "TopicConfusion_subjectId_year_quarter_idx"
    ON "TopicConfusion"("subjectId", "year", "quarter");
-- Разбор ученика по предмету: его отметки за год.
CREATE INDEX "TopicConfusion_studentId_subjectId_year_idx"
    ON "TopicConfusion"("studentId", "subjectId", "year");

ALTER TABLE "TopicConfusion" ADD CONSTRAINT "TopicConfusion_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicConfusion" ADD CONSTRAINT "TopicConfusion_lessonId_fkey"
    FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

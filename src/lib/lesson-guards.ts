import { DomainError, QuarterClosedError } from "@/lib/action-result";
import { prisma } from "@/lib/prisma";

/**
 * ЕДИНАЯ ТОЧКА ДОСТУПА К УРОКУ ДЛЯ ЗАПИСИ (аналог requireRole для прав).
 *
 * Любое действие, которое меняет оценки или отметки «Н», обязано получать урок
 * ТОЛЬКО через requireWritableLesson: гвард сам отказывает, если урока нет (404),
 * урок в корзине (409) или его четверть закрыта замком QuarterLock (423).
 * Сырой prisma.lesson.findUnique в src/lib/actions/* для этих целей — ошибка
 * ревью: второй путь к уроку означал бы «проверку, которую надо не забыть».
 *
 * Для действий, у которых урока ещё нет (создание) или он в корзине
 * (удаление/восстановление), есть assertQuarterOpen по тройке
 * (subjectId, year, quarter) — год и четверть при этом вычисляет СЕРВЕР.
 *
 * Состояние замка НЕ кэшируется между запросами: каждый вызов — свежий запрос
 * к базе, как и роль пользователя в auth-guards.
 */

/** Поля урока для записи оценки/«Н» и строки аудита. НЕ экспортируется. */
const LESSON_FOR_GRADE = {
  id: true,
  subjectId: true,
  quarter: true,
  year: true,
  date: true,
  deletedAt: true,
  subject: { select: { name: true } },
} as const;

export type WritableLesson = {
  id: string;
  subjectId: string;
  quarter: number;
  year: number;
  date: Date;
  subject: { name: string };
};

/** Есть ли замок. Один EXISTS по unique(subjectId, year, quarter). */
export async function isQuarterLocked(
  subjectId: string,
  year: number,
  quarter: number,
): Promise<boolean> {
  const lock = await prisma.quarterLock.findUnique({
    where: { subjectId_year_quarter: { subjectId, year, quarter } },
    select: { id: true },
  });
  return lock !== null;
}

/** Бросает QuarterClosedError (423), если четверть предмета закрыта. */
export async function assertQuarterOpen(
  subjectId: string,
  year: number,
  quarter: number,
): Promise<void> {
  if (await isQuarterLocked(subjectId, year, quarter)) {
    throw new QuarterClosedError(quarter, year);
  }
}

/**
 * Живой урок: 404 «Урок не найден» / 409 «Урок в корзине». Замок НЕ проверяет —
 * для действий, которым разрешено работать и в закрытой четверти (markDebtAction).
 */
export async function requireLiveLesson(lessonId: string): Promise<WritableLesson> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: LESSON_FOR_GRADE,
  });
  if (!lesson) throw new DomainError("Урок не найден", 404);
  if (lesson.deletedAt) {
    throw new DomainError("Урок в корзине — сначала восстановите его", 409);
  }
  return lesson;
}

/** requireLiveLesson + assertQuarterOpen — единственная дверь для действий с оценками и «Н». */
export async function requireWritableLesson(lessonId: string): Promise<WritableLesson> {
  const lesson = await requireLiveLesson(lessonId);
  await assertQuarterOpen(lesson.subjectId, lesson.year, lesson.quarter);
  return lesson;
}

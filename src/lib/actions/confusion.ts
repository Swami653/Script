"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/auth-guards";
import { requireLiveLesson } from "@/lib/lesson-guards";
import { prisma } from "@/lib/prisma";
import { todayUtcMidnight } from "@/lib/utils";

/**
 * Server Actions отметки «не разобрался в теме» (TopicConfusion).
 *
 * Единственное действие в проекте, где ПИШЕТ УЧЕНИК: это его просьба
 * «объясните ещё раз», а не запись журнала. Канон раздела 6 CLAUDE.md
 * соблюдён: requireRole первой строкой, zod на все поля, actionError в catch.
 *
 * СВОЙ УРОК: studentId клиент НЕ присылает вовсе — он берётся из сессии
 * (requireRole(["STUDENT"]) возвращает свежую строку БД). Отметить или снять
 * отметку за другого ученика невозможно по построению: пары (studentId,
 * lessonId) с чужим studentId в этих действиях просто не собрать.
 *
 * ЗАМОК ЧЕТВЕРТИ НЕ ПРОВЕРЯЕТСЯ — осознанное решение, а не пропуск:
 *  1) по §1.4 CLAUDE.md замок защищает ЧИСЛА и СОСТАВ столбцов, а отметка —
 *     заметка ученика: в средние, ведомость и CSV она не входит (тот же
 *     разряд, что тема и домашка, которые правятся и под замком);
 *  2) понимание приходит и с опозданием: осознать «я не понял четвертную
 *     тему» ученик может уже после закрытия, и учителю эта просьба нужна
 *     до следующей контрольной, а не после переоткрытия;
 *  3) ответ 423 «переоткрыть может администратор» семилетке бессмыслен и
 *     стыден — ровно то, чего формулировка фичи избегает.
 * Поэтому дверь — requireLiveLesson (404 нет урока / 409 корзина), как у
 * долгов (см. src/lib/actions/debts.ts, решение #18).
 *
 * АУДИТ НЕ ПИШЕТСЯ — тоже осознанно:
 *  1) журнал изменений — про действия ПЕРСОНАЛА над данными журнала
 *     (прецеденты: авто-долги в аудит не пишутся; GradeAck «сам является
 *     журналом»); отметки учеников массовые и затопили бы его шумом;
 *  2) приватность: сигнал ребёнка не должен всплывать в админской ленте —
 *     таблица TopicConfusion с createdAt и есть весь необходимый учёт.
 *
 * Отметка НЕ конфликтует с клеткой: она не оценка и не «Н», правило
 * «клетка содержит одно из» на неё не распространяется. Отсутствовавшему
 * («Н») тема как раз может быть непонятна — блокировать нечего.
 *
 * В Telegram-outbox события НЕ ставятся: родитель отметки не видит вовсе
 * (решение приватности фичи, см. getStudentSubjectDetail в queries.ts).
 */

const confusionSchema = z.object({
  lessonId: z.string().min(1, "Не указан урок"),
});

/**
 * Отметить «не разобрался в теме». Идемпотентна (upsert): повторный вызов не
 * дублирует строку — снятие сделано ОТДЕЛЬНЫМ действием, а не «переключателем»,
 * чтобы два запоздавших запроса не гонялись друг с другом (прецедент
 * setStampAction/removeStampAction).
 */
export async function markTopicConfusionAction(input: {
  lessonId: string;
}): Promise<ActionResult<null>> {
  try {
    // Только ученик и только за себя: id берётся из сессии строкой ниже.
    const student = await requireRole(["STUDENT"]);
    const parsed = confusionSchema.parse({ lessonId: input.lessonId });

    // 404 нет урока / 409 корзина; замок НЕ проверяется (см. шапку файла).
    const lesson = await requireLiveLesson(parsed.lessonId);

    // Только ПРОШЕДШИЙ урок (сегодняшний уже прошёл — отметить можно сразу
    // после звонка): непонятой темы завтрашнего урока не существует.
    if (lesson.date > todayUtcMidnight()) {
      return actionFail("Этот урок ещё не прошёл — отметить тему можно после урока", 409);
    }
    // Без темы просьба беспредметна: кнопка в интерфейсе не рисуется, а прямой
    // запрос получает понятный отказ.
    if (!lesson.topic?.trim()) {
      return actionFail("У этого урока не записана тема", 409);
    }

    await prisma.topicConfusion.upsert({
      where: {
        studentId_lessonId: { studentId: student.id, lessonId: lesson.id },
      },
      create: {
        studentId: student.id,
        lessonId: lesson.id,
        // Денормализованные поля — ТОЛЬКО из урока (инвариант Grade/Absence).
        subjectId: lesson.subjectId,
        year: lesson.year,
        quarter: lesson.quarter,
      },
      update: {},
    });

    revalidatePath("/student");
    revalidatePath("/journal");
    return actionOk(null, "Учитель увидит и объяснит ещё раз");
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Снять свою отметку («уже разобрался»). Идемпотентна: deleteMany по паре из
 * сессии, повтор — не ошибка. Урок НЕ загружается намеренно: снятие
 * собственной заметки должно работать всегда (в т.ч. когда урок уехал в
 * корзину или потерял тему) — прецедент политики "any" для удалений в §1.5.
 * Навредить запрос не может: он удаляет только строку СВОЕГО studentId.
 */
export async function clearTopicConfusionAction(input: {
  lessonId: string;
}): Promise<ActionResult<null>> {
  try {
    const student = await requireRole(["STUDENT"]);
    const parsed = confusionSchema.parse({ lessonId: input.lessonId });

    await prisma.topicConfusion.deleteMany({
      where: { studentId: student.id, lessonId: parsed.lessonId },
    });

    revalidatePath("/student");
    revalidatePath("/journal");
    return actionOk(null, "Отметка снята");
  } catch (error) {
    return actionError(error);
  }
}

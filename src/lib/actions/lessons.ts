"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { lessonRef, logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth-guards";
import { syncControlDebts } from "@/lib/debts";
import { quarterSchema } from "@/lib/grades";
import { assertQuarterOpen } from "@/lib/lesson-guards";
import { prisma } from "@/lib/prisma";
import { academicYearOf, MAX_GRID_LESSONS, quarterForDate } from "@/lib/quarters";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";
import { addUtcDays, diffUtcDays, parseDateInputValue, WEEKDAYS_SHORT } from "@/lib/utils";

/** Урок = столбец журнала (предмет + дата + четверть). Управляют учитель и администратор. */

const createLessonSchema = z.object({
  subjectId: z.string().min(1, "Не выбран предмет"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата должна быть в формате ГГГГ-ММ-ДД"),
  /** Используется, только если дата не попадает ни в одну заданную четверть. */
  quarter: quarterSchema.optional(),
  topic: z.string().trim().max(120, "Тема урока — не длиннее 120 символов").optional(),
});

export async function createLessonAction(input: {
  subjectId: string;
  date: string;
  quarter?: number;
  topic?: string;
}): Promise<ActionResult<{ id: string; quarter: number; year: number }>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const parsed = createLessonSchema.parse(input);

    const subject = await prisma.subject.findUnique({
      where: { id: parsed.subjectId },
      select: { id: true },
    });
    if (!subject) return actionFail("Предмет не найден", 404);

    const date = parseDateInputValue(parsed.date);

    /**
     * Четверть и учебный год определяет расписание, заданное учителем,
     * а не то, что прислал клиент: так урок не может «уехать» в чужой период.
     * Если границы ещё не заданы, берём четверть из формы, год — по дате.
     */
    const periods = await prisma.quarterPeriod.findMany({
      select: { quarter: true, startDate: true, endDate: true, year: true },
    });

    const matched = periods.find(
      (period) => date >= period.startDate && date <= period.endDate,
    );

    const quarter = matched?.quarter ?? quarterForDate(periods, date) ?? parsed.quarter;
    if (!quarter) {
      return actionFail(
        "Дата не попадает ни в одну заданную четверть. Укажите четверть вручную " +
          "или задайте её границы в разделе «Учебный год».",
        400,
      );
    }
    const year = matched?.year ?? academicYearOf(date);

    // Урок задним числом в закрытую четверть создать нельзя (423). Проверка —
    // по вычисленным СЕРВЕРОМ году и четверти, а не по присланным клиентом.
    await assertQuarterOpen(parsed.subjectId, year, quarter);

    // «Один урок на дату» действует только среди живых уроков — уникальность
    // обеспечивает частичный индекс в БД (см. migrations/4_phase2).
    const duplicate = await prisma.lesson.findFirst({
      where: { subjectId: parsed.subjectId, date, deletedAt: null },
      select: { id: true, quarter: true },
    });
    if (duplicate) {
      return actionFail(`Урок на эту дату уже существует (${duplicate.quarter} четверть)`, 409);
    }

    // Урок на эту дату лежит в корзине — подсказываем восстановить его,
    // а не заводить второй такой же столбец с потерей старых оценок.
    const trashed = await prisma.lesson.findFirst({
      where: { subjectId: parsed.subjectId, date, NOT: { deletedAt: null } },
      select: { id: true },
    });
    if (trashed) {
      return actionFail(
        "Урок на эту дату лежит в корзине. Восстановите его в разделе «Корзина» — " +
          "оценки вернутся в журнал — или удалите там навсегда.",
        409,
      );
    }

    const lesson = await prisma.lesson.create({
      data: {
        subjectId: parsed.subjectId,
        quarter,
        year,
        date,
        topic: parsed.topic?.trim() || null,
        teacherId: teacher.id,
      },
      select: { id: true, quarter: true, year: true },
    });

    revalidatePath("/journal");
    return actionOk(lesson, `Урок добавлен в ${lesson.quarter} четверть`);
  } catch (error) {
    return actionError(error);
  }
}

const updateLessonSchema = z.object({
  lessonId: z.string().min(1),
  topic: z.string().trim().max(120, "Тема урока — не длиннее 120 символов").optional(),
});

export async function updateLessonAction(input: {
  lessonId: string;
  topic?: string;
}): Promise<ActionResult<null>> {
  try {
    await requireRole(GRADE_EDITOR_ROLES);
    const parsed = updateLessonSchema.parse(input);

    const lesson = await prisma.lesson.findUnique({
      where: { id: parsed.lessonId },
      select: { id: true, deletedAt: true },
    });
    if (!lesson) return actionFail("Урок не найден", 404);
    if (lesson.deletedAt) return actionFail("Урок в корзине — сначала восстановите его", 409);

    await prisma.lesson.update({
      where: { id: parsed.lessonId },
      data: { topic: parsed.topic?.trim() || null },
    });

    revalidatePath("/journal");
    return actionOk(null, "Тема урока обновлена");
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Удаление урока — МЯГКОЕ: урок помечается deletedAt и попадает в корзину
 * (/journal/trash), а оценки и отметки «Н» остаются при нём и вернутся
 * при восстановлении. Физическое удаление — destroyLessonAction.
 */
export async function deleteLessonAction(input: {
  lessonId: string;
}): Promise<ActionResult<null>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const lessonId = z.string().min(1).parse(input.lessonId);

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        date: true,
        topic: true,
        deletedAt: true,
        subjectId: true,
        year: true,
        quarter: true,
        subject: { select: { name: true } },
      },
    });
    if (!lesson) return actionFail("Урок не найден", 404);
    if (lesson.deletedAt) return actionFail("Урок уже в корзине", 400);

    // Урок в корзине выпадает из средних — из закрытой четверти столбец не изъять.
    await assertQuarterOpen(lesson.subjectId, lesson.year, lesson.quarter);

    await prisma.lesson.update({
      where: { id: lessonId },
      data: { deletedAt: new Date() },
    });

    await logAudit({
      actor: teacher,
      action: "lesson.delete",
      subjectName: lesson.subject.name,
      details:
        `${lessonRef(lesson.subject.name, lesson.date)}` +
        `${lesson.topic ? ` («${lesson.topic}»)` : ""} перемещён в корзину`,
    });

    revalidatePath("/journal");
    revalidatePath("/journal/trash");
    revalidatePath("/student");
    return actionOk(null, "Урок перемещён в корзину");
  } catch (error) {
    return actionError(error);
  }
}

/** Восстановить урок из корзины: оценки и «Н» снова видны в журнале. */
export async function restoreLessonAction(input: {
  lessonId: string;
}): Promise<ActionResult<null>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const lessonId = z.string().min(1).parse(input.lessonId);

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        date: true,
        topic: true,
        deletedAt: true,
        subjectId: true,
        year: true,
        quarter: true,
        subject: { select: { name: true } },
      },
    });
    if (!lesson) return actionFail("Урок не найден", 404);
    if (!lesson.deletedAt) return actionFail("Урок не в корзине", 400);

    // Восстановление вносит в средние целый столбец — единственный обход шести
    // грейд-действий. В закрытую четверть оно запрещено так же, как и они (423).
    await assertQuarterOpen(lesson.subjectId, lesson.year, lesson.quarter);

    // Пока урок лежал в корзине, на его дату могли завести новый —
    // два живых урока на одну дату не допускаются (частичный индекс в БД).
    const conflict = await prisma.lesson.findFirst({
      where: { subjectId: lesson.subjectId, date: lesson.date, deletedAt: null },
      select: { id: true },
    });
    if (conflict) {
      return actionFail(
        "Восстановить нельзя: на эту дату уже есть другой урок по этому предмету. " +
          "Сначала удалите его — или оставьте урок в корзине.",
        409,
      );
    }

    await prisma.lesson.update({
      where: { id: lessonId },
      data: { deletedAt: null },
    });

    await logAudit({
      actor: teacher,
      action: "lesson.restore",
      subjectName: lesson.subject.name,
      details:
        `${lessonRef(lesson.subject.name, lesson.date)}` +
        `${lesson.topic ? ` («${lesson.topic}»)` : ""} восстановлен из корзины`,
    });

    revalidatePath("/journal");
    revalidatePath("/journal/trash");
    revalidatePath("/student");
    return actionOk(null, "Урок восстановлен");
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Удалить урок НАВСЕГДА — только из корзины. Физическое удаление каскадом
 * забирает оценки и отметки «Н» этого столбца (onDelete: Cascade).
 */
export async function destroyLessonAction(input: {
  lessonId: string;
}): Promise<ActionResult<null>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const lessonId = z.string().min(1).parse(input.lessonId);

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        date: true,
        topic: true,
        deletedAt: true,
        subject: { select: { name: true } },
        _count: { select: { grades: true, absences: true } },
      },
    });
    if (!lesson) return actionFail("Урок не найден", 404);
    if (!lesson.deletedAt) {
      return actionFail("Навсегда удалить можно только урок из корзины", 400);
    }

    await prisma.lesson.delete({ where: { id: lessonId } });

    await logAudit({
      actor: teacher,
      action: "lesson.destroy",
      subjectName: lesson.subject.name,
      details:
        `${lessonRef(lesson.subject.name, lesson.date)} удалён навсегда ` +
        `(оценок: ${lesson._count.grades}, отметок «Н»: ${lesson._count.absences})`,
    });

    revalidatePath("/journal");
    revalidatePath("/journal/trash");
    revalidatePath("/student");
    return actionOk(null, "Урок удалён навсегда вместе с оценками");
  } catch (error) {
    return actionError(error);
  }
}

const lessonGridSchema = z.object({
  subjectId: z.string().min(1, "Не выбран предмет"),
  year: z.number().int().min(2000).max(2100),
  quarter: quarterSchema,
  weekdays: z
    .array(z.number().int().min(1, "День недели — от 1 (пн)").max(6, "Воскресенья в сетке нет"))
    .min(1, "Выберите хотя бы один день недели")
    .max(6),
});

/**
 * «Сетка на четверть»: создать уроки предмета на все выбранные дни недели
 * в границах четверти. Дни недели — 1..6 (пн..сб), численно равны getUTCDay()
 * для пн–сб; воскресенье (0) не допускается схемой.
 *
 * Год и четверть создаваемых уроков берутся ТОЛЬКО из QuarterPeriod —
 * клиентские year/quarter служат лишь ключом выбора периода (та же модель
 * доверия, что у createLessonAction). Занятые даты пропускаются: живой урок —
 * skippedExisting, урок в корзине — skippedTrashed (политика «восстановите
 * из корзины», а не второй столбец на ту же дату).
 */
export async function createLessonGridAction(input: {
  subjectId: string;
  year: number;
  quarter: number;
  weekdays: number[];
}): Promise<ActionResult<{ created: number; skippedExisting: number; skippedTrashed: number }>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const parsed = lessonGridSchema.parse(input);
    // Повторы дней недели схлопываются: [1, 1, 3] — это «пн и ср».
    const weekdaySet = new Set(parsed.weekdays);

    const subject = await prisma.subject.findUnique({
      where: { id: parsed.subjectId },
      select: { id: true, name: true },
    });
    if (!subject) return actionFail("Предмет не найден", 404);

    const period = await prisma.quarterPeriod.findUnique({
      where: { year_quarter: { year: parsed.year, quarter: parsed.quarter } },
    });
    if (!period) {
      return actionFail(
        `Границы ${parsed.quarter} четверти на ${parsed.year}/${parsed.year + 1} не заданы — ` +
          "задайте их в разделе «Учебный год»",
        400,
      );
    }

    // Сетка в закрытую четверть запрещена: год и четверть берутся из периода.
    await assertQuarterOpen(parsed.subjectId, period.year, period.quarter);

    /**
     * Предохранитель до материализации дат: число кандидатов считается
     * арифметически, чтобы опечатка в границах (год вместо месяца) не
     * заставила перебирать тысячи дней впустую.
     */
    const totalDays = diffUtcDays(period.endDate, period.startDate) + 1;
    const startWeekday = period.startDate.getUTCDay();
    let candidateCount = 0;
    for (const weekday of weekdaySet) {
      const offset = (weekday - startWeekday + 7) % 7;
      if (offset < totalDays) candidateCount += 1 + Math.floor((totalDays - 1 - offset) / 7);
    }
    if (candidateCount > MAX_GRID_LESSONS) {
      return actionFail(
        `Слишком много дат (${candidateCount}) — проверьте границы четверти или сузьте дни недели`,
        400,
      );
    }

    // Даты-кандидаты: полуночи UTC в границах периода нужных дней недели.
    const candidates: Date[] = [];
    for (let offset = 0; offset < totalDays; offset += 1) {
      const date = addUtcDays(period.startDate, offset);
      if (weekdaySet.has(date.getUTCDay())) candidates.push(date);
    }

    /**
     * Занятые даты — ЕДИНСТВЕННОЕ намеренное исключение из правила
     * «фильтровать deletedAt»: корзинные уроки нужны, чтобы не создать второй
     * столбец на их дату (строки наружу не отдаются — только счётчик).
     */
    const existing = await prisma.lesson.findMany({
      where: {
        subjectId: parsed.subjectId,
        date: { gte: period.startDate, lte: period.endDate },
      },
      select: { date: true, deletedAt: true },
    });
    const liveDates = new Set<number>();
    const trashedDates = new Set<number>();
    for (const lesson of existing) {
      if (lesson.deletedAt) trashedDates.add(lesson.date.getTime());
      else liveDates.add(lesson.date.getTime());
    }

    let skippedExisting = 0;
    let skippedTrashed = 0;
    const freshDates: Date[] = [];
    for (const date of candidates) {
      const time = date.getTime();
      if (liveDates.has(time)) skippedExisting += 1;
      else if (trashedDates.has(time)) skippedTrashed += 1;
      else freshDates.push(date);
    }

    /**
     * createMany атомарен сам по себе — транзакция не нужна. skipDuplicates
     * обязателен: Postgres `ON CONFLICT DO NOTHING` без цели конфликта гасит
     * и нарушение частичного индекса Lesson_subjectId_date_live_key, поэтому
     * гонка с параллельным созданием урока не роняет пачку ошибкой P2002.
     */
    let created = 0;
    if (freshDates.length > 0) {
      const result = await prisma.lesson.createMany({
        data: freshDates.map((date) => ({
          subjectId: parsed.subjectId,
          date,
          // Год и четверть — только из периода, не из пользовательского ввода.
          year: period.year,
          quarter: period.quarter,
          teacherId: teacher.id,
        })),
        skipDuplicates: true,
      });
      created = result.count;
    }

    const dayLabels = [...weekdaySet]
      .sort((a, b) => a - b)
      .map((weekday) => WEEKDAYS_SHORT[weekday])
      .join(", ");
    const skippedParts: string[] = [];
    if (skippedExisting > 0) skippedParts.push(`${skippedExisting} уже есть`);
    if (skippedTrashed > 0) skippedParts.push(`${skippedTrashed} в корзине`);

    await logAudit({
      actor: teacher,
      action: "lessons.grid",
      subjectName: subject.name,
      details:
        `${subject.name}: сетка уроков на ${period.quarter} четверть (${dayLabels}) — ` +
        `создано ${created}` +
        (skippedParts.length > 0 ? `, пропущено: ${skippedParts.join(", ")}` : ""),
    });

    revalidatePath("/journal");
    revalidatePath("/student");
    return actionOk({ created, skippedExisting, skippedTrashed }, `Создано уроков: ${created}`);
  } catch (error) {
    return actionError(error);
  }
}

const homeworkSchema = z.object({
  lessonId: z.string().min(1, "Не указан урок"),
  homework: z.string().trim().max(500, "Домашнее задание — не длиннее 500 символов").optional(),
});

/** Срез длинного текста для строки аудита: итог не длиннее max символов. */
function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Записать (или снять) домашнее задание урока. Семантика: «задано К уроку
 * этой даты» — ученик готовится к этой дате. Пустая строка снимает задание.
 */
export async function setLessonHomeworkAction(input: {
  lessonId: string;
  homework?: string;
}): Promise<ActionResult<{ homework: string | null }>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const parsed = homeworkSchema.parse(input);

    const lesson = await prisma.lesson.findUnique({
      where: { id: parsed.lessonId },
      select: { id: true, date: true, deletedAt: true, subject: { select: { name: true } } },
    });
    if (!lesson) return actionFail("Урок не найден", 404);
    if (lesson.deletedAt) return actionFail("Урок в корзине — сначала восстановите его", 409);

    const homework = parsed.homework?.trim() || null;
    await prisma.lesson.update({ where: { id: lesson.id }, data: { homework } });

    await logAudit({
      actor: teacher,
      action: "lesson.homework",
      subjectName: lesson.subject.name,
      details:
        `${lessonRef(lesson.subject.name, lesson.date)}: ` +
        (homework
          ? `домашнее задание обновлено: «${clipText(homework, 80)}»`
          : "домашнее задание снято"),
    });

    revalidatePath("/journal");
    revalidatePath("/student");
    return actionOk(
      { homework },
      homework ? "Домашнее задание сохранено" : "Домашнее задание снято",
    );
  } catch (error) {
    return actionError(error);
  }
}

const lessonPlanSchema = z.object({
  lessonId: z.string().min(1, "Не указан урок"),
  /**
   * Литеральная схема — единственный вход в общий TEXT-столбец: клиент не
   * может записать произвольную строку. Расширение словаря (диктант, зачёт) —
   * правка этой схемы, а не миграция.
   */
  plannedKind: z.union([z.literal("control"), z.null()]),
});

/**
 * Пометить урок «планируется контрольная» (или снять пометку). Это план,
 * а не оценка: на средний балл не влияет и с Grade.kind не связан. Прошлые
 * даты не запрещаются — блок «Впереди» у ученика сам фильтрует по дате.
 */
export async function setLessonPlanAction(input: {
  lessonId: string;
  plannedKind: "control" | null;
}): Promise<ActionResult<{ plannedKind: string | null }>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const parsed = lessonPlanSchema.parse(input);

    const lesson = await prisma.lesson.findUnique({
      where: { id: parsed.lessonId },
      select: {
        id: true,
        date: true,
        deletedAt: true,
        subjectId: true,
        year: true,
        quarter: true,
        subject: { select: { name: true } },
      },
    });
    if (!lesson) return actionFail("Урок не найден", 404);
    if (lesson.deletedAt) return actionFail("Урок в корзине — сначала восстановите его", 409);

    // Пометка КР ретроактивно рождает/растворяет авто-долги и меняет списки
    // мастера — в закрытой четверти запрещена (в отличие от темы и домашки).
    await assertQuarterOpen(lesson.subjectId, lesson.year, lesson.quarter);

    await prisma.lesson.update({
      where: { id: lesson.id },
      data: { plannedKind: parsed.plannedKind },
    });

    await logAudit({
      actor: teacher,
      action: "lesson.plan",
      subjectName: lesson.subject.name,
      details:
        `${lessonRef(lesson.subject.name, lesson.date)}: ` +
        `пометка «контрольная» ${parsed.plannedKind ? "установлена" : "снята"}`,
    });

    // Пометка КР ретроактивно рождает авто-долги за уже стоящие «Н» (и
    // растворяет открытые при снятии) — инвариантом владеет редьюсер.
    await syncControlDebts(lesson.id);

    revalidatePath("/journal");
    revalidatePath("/student");
    return actionOk(
      { plannedKind: parsed.plannedKind },
      parsed.plannedKind ? "Пометка «контрольная» установлена" : "Пометка «контрольная» снята",
    );
  } catch (error) {
    return actionError(error);
  }
}

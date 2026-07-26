"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { lessonRef, logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth-guards";
import { quarterSchema } from "@/lib/grades";
import { prisma } from "@/lib/prisma";
import { academicYearOf, quarterForDate } from "@/lib/quarters";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";
import { parseDateInputValue } from "@/lib/utils";

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
        subject: { select: { name: true } },
      },
    });
    if (!lesson) return actionFail("Урок не найден", 404);
    if (lesson.deletedAt) return actionFail("Урок уже в корзине", 400);

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
        subject: { select: { name: true } },
      },
    });
    if (!lesson) return actionFail("Урок не найден", 404);
    if (!lesson.deletedAt) return actionFail("Урок не в корзине", 400);

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

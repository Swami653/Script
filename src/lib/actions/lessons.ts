"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/auth-guards";
import { quarterSchema } from "@/lib/grades";
import { prisma } from "@/lib/prisma";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";
import { parseDateInputValue } from "@/lib/utils";

/** Урок = столбец журнала (предмет + дата + четверть). Управляют учитель и администратор. */

const createLessonSchema = z.object({
  subjectId: z.string().min(1, "Не выбран предмет"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата должна быть в формате ГГГГ-ММ-ДД"),
  quarter: quarterSchema,
  topic: z.string().trim().max(120, "Тема урока — не длиннее 120 символов").optional(),
});

export async function createLessonAction(input: {
  subjectId: string;
  date: string;
  quarter: number;
  topic?: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const parsed = createLessonSchema.parse(input);

    const subject = await prisma.subject.findUnique({
      where: { id: parsed.subjectId },
      select: { id: true },
    });
    if (!subject) return actionFail("Предмет не найден", 404);

    const date = parseDateInputValue(parsed.date);

    const duplicate = await prisma.lesson.findUnique({
      where: { subjectId_date: { subjectId: parsed.subjectId, date } },
      select: { id: true, quarter: true },
    });
    if (duplicate) {
      return actionFail(
        `Урок на эту дату уже существует (${duplicate.quarter} четверть)`,
        409,
      );
    }

    const lesson = await prisma.lesson.create({
      data: {
        subjectId: parsed.subjectId,
        quarter: parsed.quarter,
        date,
        topic: parsed.topic?.trim() || null,
        teacherId: teacher.id,
      },
      select: { id: true },
    });

    revalidatePath("/journal");
    return actionOk(lesson, "Урок добавлен");
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
      select: { id: true },
    });
    if (!lesson) return actionFail("Урок не найден", 404);

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

/** Удаление урока удаляет и все оценки этого столбца (onDelete: Cascade). */
export async function deleteLessonAction(input: {
  lessonId: string;
}): Promise<ActionResult<null>> {
  try {
    await requireRole(GRADE_EDITOR_ROLES);
    const lessonId = z.string().min(1).parse(input.lessonId);

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true },
    });
    if (!lesson) return actionFail("Урок не найден", 404);

    await prisma.lesson.delete({ where: { id: lessonId } });

    revalidatePath("/journal");
    revalidatePath("/student");
    return actionOk(null, "Урок и его оценки удалены");
  } catch (error) {
    return actionError(error);
  }
}

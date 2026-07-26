"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/auth-guards";
import { gradeValueSchema } from "@/lib/grades";
import { prisma } from "@/lib/prisma";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";

/**
 * Server Actions для работы с оценками.
 *
 * ГЛАВНОЕ ПРАВИЛО: первая строка каждого действия — requireRole(GRADE_EDITOR_ROLES).
 * Ученик, отправивший запрос напрямую (curl, DevTools, поддельная форма),
 * получит ActionResult со статусом 403 и не изменит ни одной строки в БД.
 */

const setGradeSchema = z.object({
  studentId: z.string().min(1, "Не указан ученик"),
  lessonId: z.string().min(1, "Не указан урок"),
  value: gradeValueSchema,
});

const deleteGradeSchema = z.object({
  studentId: z.string().min(1, "Не указан ученик"),
  lessonId: z.string().min(1, "Не указан урок"),
});

/**
 * Приводит значение из формы к числу, НЕ ослабляя валидацию:
 * "8" -> 8, а "7.5", "abc", "" остаются как есть и будут отклонены схемой.
 */
function normalizeGradeInput(value: unknown): unknown {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return value;
}

export type SavedGrade = { id: string; value: number; studentId: string; lessonId: string };

/** Выставить или изменить оценку (одна оценка = один ученик × один урок). */
export async function setGradeAction(input: {
  studentId: string;
  lessonId: string;
  value: unknown;
}): Promise<ActionResult<SavedGrade>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);

    const parsed = setGradeSchema.parse({
      studentId: input.studentId,
      lessonId: input.lessonId,
      value: normalizeGradeInput(input.value),
    });

    const [lesson, student] = await Promise.all([
      prisma.lesson.findUnique({
        where: { id: parsed.lessonId },
        select: { id: true, subjectId: true, quarter: true },
      }),
      prisma.user.findUnique({
        where: { id: parsed.studentId },
        select: { id: true, role: true },
      }),
    ]);

    if (!lesson) return actionFail("Урок не найден", 404);
    if (!student) return actionFail("Ученик не найден", 404);
    if (student.role !== "STUDENT") {
      return actionFail("Оценку можно выставить только ученику", 400);
    }

    const grade = await prisma.grade.upsert({
      where: {
        studentId_lessonId: { studentId: parsed.studentId, lessonId: parsed.lessonId },
      },
      create: {
        value: parsed.value,
        studentId: parsed.studentId,
        lessonId: parsed.lessonId,
        // Денормализованные поля берём ТОЛЬКО из урока — инвариант схемы.
        subjectId: lesson.subjectId,
        quarter: lesson.quarter,
        teacherId: teacher.id,
      },
      update: {
        value: parsed.value,
        subjectId: lesson.subjectId,
        quarter: lesson.quarter,
        teacherId: teacher.id,
      },
      select: { id: true, value: true, studentId: true, lessonId: true },
    });

    revalidatePath("/journal");
    revalidatePath("/student");

    return actionOk(grade, `Оценка ${grade.value} сохранена`);
  } catch (error) {
    return actionError(error);
  }
}

/** Удалить оценку из ячейки журнала. */
export async function deleteGradeAction(input: {
  studentId: string;
  lessonId: string;
}): Promise<ActionResult<null>> {
  try {
    await requireRole(GRADE_EDITOR_ROLES);

    const parsed = deleteGradeSchema.parse(input);

    const existing = await prisma.grade.findUnique({
      where: {
        studentId_lessonId: { studentId: parsed.studentId, lessonId: parsed.lessonId },
      },
      select: { id: true },
    });

    if (!existing) return actionOk(null, "Оценки не было");

    await prisma.grade.delete({ where: { id: existing.id } });

    revalidatePath("/journal");
    revalidatePath("/student");

    return actionOk(null, "Оценка удалена");
  } catch (error) {
    return actionError(error);
  }
}

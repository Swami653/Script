"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/auth-guards";
import { gradeSlotSchema, gradeValueSchema } from "@/lib/grades";
import { prisma } from "@/lib/prisma";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";

/**
 * Server Actions для работы с оценками.
 *
 * ГЛАВНОЕ ПРАВИЛО: первая строка каждого действия — requireRole(GRADE_EDITOR_ROLES).
 * Ученик, отправивший запрос напрямую (curl, DevTools, поддельная форма),
 * получит ActionResult со статусом 403 и не изменит ни одной строки в БД.
 *
 * За один урок ученику можно поставить до MAX_GRADES_PER_LESSON оценок
 * («10/9» за контрольную) — это отдельные целые оценки, каждая из которых
 * самостоятельно участвует в среднем балле.
 */

const setGradeSchema = z.object({
  studentId: z.string().min(1, "Не указан ученик"),
  lessonId: z.string().min(1, "Не указан урок"),
  slot: gradeSlotSchema,
  value: gradeValueSchema,
});

const cellSchema = z.object({
  studentId: z.string().min(1, "Не указан ученик"),
  lessonId: z.string().min(1, "Не указан урок"),
  slot: gradeSlotSchema,
});

/**
 * Приводит значение из формы к числу, НЕ ослабляя валидацию:
 * "8" -> 8, а "7.5", "abc", "" остаются как есть и будут отклонены схемой.
 */
function normalizeNumberInput(value: unknown): unknown {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return value;
}

export type SavedGrade = {
  id: string;
  value: number;
  slot: number;
  studentId: string;
  lessonId: string;
};

/** Выставить или изменить оценку в конкретной позиции клетки. */
export async function setGradeAction(input: {
  studentId: string;
  lessonId: string;
  value: unknown;
  slot?: unknown;
}): Promise<ActionResult<SavedGrade>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);

    const parsed = setGradeSchema.parse({
      studentId: input.studentId,
      lessonId: input.lessonId,
      value: normalizeNumberInput(input.value),
      slot: normalizeNumberInput(input.slot ?? 0),
    });

    const [lesson, student] = await Promise.all([
      prisma.lesson.findUnique({
        where: { id: parsed.lessonId },
        select: { id: true, subjectId: true, quarter: true, year: true },
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

    // Вторую оценку нельзя поставить «через дырку»: сначала первая, потом вторая.
    if (parsed.slot > 0) {
      const previous = await prisma.grade.findUnique({
        where: {
          studentId_lessonId_slot: {
            studentId: parsed.studentId,
            lessonId: parsed.lessonId,
            slot: parsed.slot - 1,
          },
        },
        select: { id: true },
      });
      if (!previous) {
        return actionFail("Сначала поставьте первую оценку за этот урок", 400);
      }
    }

    const grade = await prisma.grade.upsert({
      where: {
        studentId_lessonId_slot: {
          studentId: parsed.studentId,
          lessonId: parsed.lessonId,
          slot: parsed.slot,
        },
      },
      create: {
        value: parsed.value,
        slot: parsed.slot,
        studentId: parsed.studentId,
        lessonId: parsed.lessonId,
        // Денормализованные поля берём ТОЛЬКО из урока — инвариант схемы.
        subjectId: lesson.subjectId,
        quarter: lesson.quarter,
        year: lesson.year,
        teacherId: teacher.id,
      },
      update: {
        value: parsed.value,
        subjectId: lesson.subjectId,
        quarter: lesson.quarter,
        year: lesson.year,
        teacherId: teacher.id,
      },
      select: { id: true, value: true, slot: true, studentId: true, lessonId: true },
    });

    revalidatePath("/journal");
    revalidatePath("/student");

    return actionOk(grade, `Оценка ${grade.value} сохранена`);
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Удалить оценку из позиции клетки. Если удаляется первая из двух,
 * вторая занимает её место — в клетке не остаётся «дырок».
 */
export async function deleteGradeAction(input: {
  studentId: string;
  lessonId: string;
  slot?: unknown;
}): Promise<ActionResult<null>> {
  try {
    await requireRole(GRADE_EDITOR_ROLES);

    const parsed = cellSchema.parse({
      studentId: input.studentId,
      lessonId: input.lessonId,
      slot: normalizeNumberInput(input.slot ?? 0),
    });

    const cellGrades = await prisma.grade.findMany({
      where: { studentId: parsed.studentId, lessonId: parsed.lessonId },
      orderBy: { slot: "asc" },
      select: { id: true, slot: true, value: true },
    });

    const target = cellGrades.find((grade) => grade.slot === parsed.slot);
    if (!target) return actionOk(null, "Оценки не было");

    await prisma.$transaction(async (tx) => {
      await tx.grade.delete({ where: { id: target.id } });

      // Сдвигаем оставшиеся оценки, чтобы позиции шли подряд: 0, 1, …
      const rest = cellGrades.filter((grade) => grade.slot > parsed.slot);
      for (const grade of rest) {
        await tx.grade.update({ where: { id: grade.id }, data: { slot: grade.slot - 1 } });
      }
    });

    revalidatePath("/journal");
    revalidatePath("/student");

    return actionOk(null, "Оценка удалена");
  } catch (error) {
    return actionError(error);
  }
}

/** Удалить все оценки ученика за урок (обе половинки «10/9»). */
export async function clearCellAction(input: {
  studentId: string;
  lessonId: string;
}): Promise<ActionResult<null>> {
  try {
    await requireRole(GRADE_EDITOR_ROLES);
    const studentId = z.string().min(1).parse(input.studentId);
    const lessonId = z.string().min(1).parse(input.lessonId);

    const { count } = await prisma.grade.deleteMany({ where: { studentId, lessonId } });

    revalidatePath("/journal");
    revalidatePath("/student");

    return actionOk(null, count > 0 ? "Оценки удалены" : "Оценок не было");
  } catch (error) {
    return actionError(error);
  }
}

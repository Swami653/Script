"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { lessonRef, logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth-guards";
import {
  asGradeKind,
  GRADE_KINDS,
  gradeKindSchema,
  gradeSlotSchema,
  gradeValueSchema,
  weightForKind,
} from "@/lib/grades";
import { prisma } from "@/lib/prisma";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";
import { pluralize } from "@/lib/utils";

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
 *
 * Каждое успешное изменение записывается в журнал изменений (logAudit)
 * СРАЗУ ПОСЛЕ изменения данных; ошибка аудита действие не роняет.
 */

const setGradeSchema = z.object({
  studentId: z.string().min(1, "Не указан ученик"),
  lessonId: z.string().min(1, "Не указан урок"),
  slot: gradeSlotSchema,
  value: gradeValueSchema,
  kind: gradeKindSchema.default("regular"),
  comment: z.string().trim().max(300, "Комментарий — не длиннее 300 символов").optional(),
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

/** Поля урока, которые нужны и для записи оценки, и для строки аудита. */
const LESSON_FOR_GRADE = {
  id: true,
  subjectId: true,
  quarter: true,
  year: true,
  date: true,
  deletedAt: true,
  subject: { select: { name: true } },
} as const;

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
  kind?: unknown;
  comment?: unknown;
}): Promise<ActionResult<SavedGrade>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);

    const parsed = setGradeSchema.parse({
      studentId: input.studentId,
      lessonId: input.lessonId,
      value: normalizeNumberInput(input.value),
      slot: normalizeNumberInput(input.slot ?? 0),
      kind: typeof input.kind === "string" ? input.kind : "regular",
      comment: typeof input.comment === "string" ? input.comment : undefined,
    });

    // Вес определяет ТИП работы на сервере, а не клиент. Сейчас все типы весят
    // одинаково (1), но вес по-прежнему денормализуется в Grade.weight на момент
    // выставления — механизм оставлен на случай возврата разных весов.
    const kind = asGradeKind(parsed.kind);
    const weight = weightForKind(kind);
    const comment = parsed.comment?.trim() || null;

    const [lesson, student, cellGrades] = await Promise.all([
      prisma.lesson.findUnique({
        where: { id: parsed.lessonId },
        select: LESSON_FOR_GRADE,
      }),
      prisma.user.findUnique({
        where: { id: parsed.studentId },
        select: { id: true, role: true, name: true },
      }),
      prisma.grade.findMany({
        where: { studentId: parsed.studentId, lessonId: parsed.lessonId },
        select: { slot: true, value: true },
      }),
    ]);

    if (!lesson) return actionFail("Урок не найден", 404);
    if (lesson.deletedAt) return actionFail("Урок в корзине — сначала восстановите его", 409);
    if (!student) return actionFail("Ученик не найден", 404);
    if (student.role !== "STUDENT") {
      return actionFail("Оценку можно выставить только ученику", 400);
    }

    // Вторую оценку нельзя поставить «через дырку»: сначала первая, потом вторая.
    if (parsed.slot > 0 && !cellGrades.some((grade) => grade.slot === parsed.slot - 1)) {
      return actionFail("Сначала поставьте первую оценку за этот урок", 400);
    }

    // Прежнее значение позиции — для строки «было 6» в журнале изменений.
    const previousValue = cellGrades.find((grade) => grade.slot === parsed.slot)?.value ?? null;

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
        kind,
        weight,
        comment,
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
        kind,
        weight,
        comment,
        subjectId: lesson.subjectId,
        quarter: lesson.quarter,
        year: lesson.year,
        teacherId: teacher.id,
      },
      select: { id: true, value: true, slot: true, studentId: true, lessonId: true },
    });

    // Оценка и «Н» взаимоисключающи: выставили оценку — отметка отсутствия снимается.
    await prisma.absence.deleteMany({
      where: { studentId: parsed.studentId, lessonId: parsed.lessonId },
    });

    await logAudit({
      actor: teacher,
      action: "grade.set",
      targetName: student.name,
      subjectName: lesson.subject.name,
      details:
        `${lessonRef(lesson.subject.name, lesson.date)}: ` +
        `оценка ${parsed.value} (${GRADE_KINDS[kind].label.toLowerCase()})` +
        (parsed.slot > 0 ? `, слот ${parsed.slot}` : "") +
        (previousValue !== null && previousValue !== parsed.value ? `, было ${previousValue}` : ""),
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
    const teacher = await requireRole(GRADE_EDITOR_ROLES);

    const parsed = cellSchema.parse({
      studentId: input.studentId,
      lessonId: input.lessonId,
      slot: normalizeNumberInput(input.slot ?? 0),
    });

    const [lesson, student, cellGrades] = await Promise.all([
      prisma.lesson.findUnique({ where: { id: parsed.lessonId }, select: LESSON_FOR_GRADE }),
      prisma.user.findUnique({ where: { id: parsed.studentId }, select: { name: true } }),
      prisma.grade.findMany({
        where: { studentId: parsed.studentId, lessonId: parsed.lessonId },
        orderBy: { slot: "asc" },
        select: { id: true, slot: true, value: true },
      }),
    ]);
    if (!lesson || !student) return actionFail("Урок или ученик не найдены", 404);
    if (lesson.deletedAt) return actionFail("Урок в корзине — сначала восстановите его", 409);

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

    await logAudit({
      actor: teacher,
      action: "grade.delete",
      targetName: student.name,
      subjectName: lesson.subject.name,
      details:
        `${lessonRef(lesson.subject.name, lesson.date)}: удалена оценка ${target.value}` +
        (parsed.slot > 0 ? `, слот ${parsed.slot}` : ""),
    });

    revalidatePath("/journal");
    revalidatePath("/student");

    return actionOk(null, "Оценка удалена");
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Отметить отсутствие ученика на уроке («Н»). Если в клетке были оценки —
 * они удаляются: ученик либо был, либо нет.
 */
export async function setAbsenceAction(input: {
  studentId: string;
  lessonId: string;
}): Promise<ActionResult<null>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const studentId = z.string().min(1).parse(input.studentId);
    const lessonId = z.string().min(1).parse(input.lessonId);

    const [lesson, student] = await Promise.all([
      prisma.lesson.findUnique({ where: { id: lessonId }, select: LESSON_FOR_GRADE }),
      prisma.user.findUnique({ where: { id: studentId }, select: { id: true, role: true, name: true } }),
    ]);
    if (!lesson) return actionFail("Урок не найден", 404);
    if (lesson.deletedAt) return actionFail("Урок в корзине — сначала восстановите его", 409);
    if (!student || student.role !== "STUDENT") return actionFail("Ученик не найден", 404);

    const [removedGrades] = await prisma.$transaction([
      prisma.grade.deleteMany({ where: { studentId, lessonId } }),
      prisma.absence.upsert({
        where: { studentId_lessonId: { studentId, lessonId } },
        create: {
          studentId,
          lessonId,
          subjectId: lesson.subjectId,
          quarter: lesson.quarter,
          year: lesson.year,
          teacherId: teacher.id,
        },
        update: { teacherId: teacher.id },
      }),
    ]);

    await logAudit({
      actor: teacher,
      action: "absence.set",
      targetName: student.name,
      subjectName: lesson.subject.name,
      details:
        `${lessonRef(lesson.subject.name, lesson.date)}: отмечено отсутствие («Н»)` +
        (removedGrades.count > 0 ? `, снято оценок: ${removedGrades.count}` : ""),
    });

    revalidatePath("/journal");
    revalidatePath("/student");
    return actionOk(null, "Отмечено отсутствие");
  } catch (error) {
    return actionError(error);
  }
}

/** Снять отметку отсутствия. */
export async function clearAbsenceAction(input: {
  studentId: string;
  lessonId: string;
}): Promise<ActionResult<null>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const studentId = z.string().min(1).parse(input.studentId);
    const lessonId = z.string().min(1).parse(input.lessonId);

    const [lesson, student] = await Promise.all([
      prisma.lesson.findUnique({ where: { id: lessonId }, select: LESSON_FOR_GRADE }),
      prisma.user.findUnique({ where: { id: studentId }, select: { name: true } }),
    ]);
    if (!lesson || !student) return actionFail("Урок или ученик не найдены", 404);
    if (lesson.deletedAt) return actionFail("Урок в корзине — сначала восстановите его", 409);

    const { count } = await prisma.absence.deleteMany({ where: { studentId, lessonId } });

    if (count > 0) {
      await logAudit({
        actor: teacher,
        action: "absence.clear",
        targetName: student.name,
        subjectName: lesson.subject.name,
        details: `${lessonRef(lesson.subject.name, lesson.date)}: снята отметка «Н»`,
      });
    }

    revalidatePath("/journal");
    revalidatePath("/student");
    return actionOk(null, "Отметка снята");
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
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const studentId = z.string().min(1).parse(input.studentId);
    const lessonId = z.string().min(1).parse(input.lessonId);

    const [lesson, student] = await Promise.all([
      prisma.lesson.findUnique({ where: { id: lessonId }, select: LESSON_FOR_GRADE }),
      prisma.user.findUnique({ where: { id: studentId }, select: { name: true } }),
    ]);
    if (!lesson || !student) return actionFail("Урок или ученик не найдены", 404);
    if (lesson.deletedAt) return actionFail("Урок в корзине — сначала восстановите его", 409);

    const { count } = await prisma.grade.deleteMany({ where: { studentId, lessonId } });

    if (count > 0) {
      await logAudit({
        actor: teacher,
        action: "cell.clear",
        targetName: student.name,
        subjectName: lesson.subject.name,
        details:
          `${lessonRef(lesson.subject.name, lesson.date)}: клетка очищена, ` +
          `удалено ${count} ${pluralize(count, "оценка", "оценки", "оценок")}`,
      });
    }

    revalidatePath("/journal");
    revalidatePath("/student");

    return actionOk(null, count > 0 ? "Оценки удалены" : "Оценок не было");
  } catch (error) {
    return actionError(error);
  }
}

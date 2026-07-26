"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { lessonRef, logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth-guards";
import { isGradelessClassName } from "@/lib/gradeless";
import { requireLiveLesson, requireMarkTarget } from "@/lib/lesson-guards";
import { prisma } from "@/lib/prisma";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";

/**
 * Server Actions долгов (несданных работ).
 *
 * Урок берётся через requireLiveLesson БЕЗ проверки замка (решение #18
 * спецификации фазы): долговая бухгалтерия чисел не двигает, а долг закрытой
 * четверти нужно уметь и пометить, и снять — пересдача принимается уроком
 * ТЕКУЩЕЙ четверти. Статус «закрыт оценкой» нигде не хранится и не трогается:
 * он выводится по EXISTS Grade, рассинхронизироваться нечему.
 */

const markDebtSchema = z.object({
  studentId: z.string().min(1, "Не указан ученик"),
  lessonId: z.string().min(1, "Не указан урок"),
  note: z.string().trim().max(200, "Пометка — не длиннее 200 символов").optional(),
});

/** Отметить долг вручную (или воскресить прощённый повторной пометкой). */
export async function markDebtAction(input: {
  studentId: string;
  lessonId: string;
  note?: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const parsed = markDebtSchema.parse(input);
    const note = parsed.note?.trim() || null;

    const [lesson, student] = await Promise.all([
      requireLiveLesson(parsed.lessonId),
      requireMarkTarget(parsed.studentId, "any"),
    ]);
    // Долг закрывается оценкой, которой у безотметочного ученика не бывает, —
    // несдаваемый долг вешать нельзя (policy "any" + доменный отказ с понятным
    // текстом вместо сообщения гварда про оценки).
    if (isGradelessClassName(student.className)) {
      return actionFail(
        "В 1–2 классах долги не отмечаются: безотметочное обучение",
        409,
      );
    }

    const debt = await prisma.debt.upsert({
      where: {
        studentId_lessonId: { studentId: parsed.studentId, lessonId: parsed.lessonId },
      },
      create: {
        studentId: parsed.studentId,
        lessonId: parsed.lessonId,
        origin: "manual",
        note,
        createdById: teacher.id,
        // Денормализованные поля — ТОЛЬКО из урока (инвариант Grade/Absence).
        subjectId: lesson.subjectId,
        year: lesson.year,
        quarter: lesson.quarter,
      },
      // Повторная пометка воскрешает прощённый долг: надгробие снимается.
      update: { origin: "manual", note, clearedAt: null, clearedById: null },
      select: { id: true },
    });

    await logAudit({
      actor: teacher,
      action: "debt.set",
      targetName: student.name,
      subjectName: lesson.subject.name,
      details:
        `${lessonRef(lesson.subject.name, lesson.date)}: отмечен долг` +
        (note ? ` («${note}»)` : ""),
    });

    revalidatePath("/journal");
    revalidatePath("/journal/debts");
    revalidatePath("/student");
    return actionOk({ id: debt.id }, "Долг отмечен");
  } catch (error) {
    return actionError(error);
  }
}

const clearDebtSchema = z.object({ debtId: z.string().min(1, "Не указан долг") });

/** Снять долг вручную — надгробие (clearedAt), строка не удаляется. */
export async function clearDebtAction(input: { debtId: string }): Promise<ActionResult<null>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const parsed = clearDebtSchema.parse(input);

    const debt = await prisma.debt.findUnique({
      where: { id: parsed.debtId },
      select: {
        id: true,
        clearedAt: true,
        student: { select: { name: true } },
        lesson: { select: { date: true, subject: { select: { name: true } } } },
      },
    });
    if (!debt) return actionFail("Долг не найден", 404);
    // Идемпотентность: повторное нажатие — не ошибка.
    if (debt.clearedAt) return actionOk(null, "Долг уже снят");

    await prisma.debt.update({
      where: { id: debt.id },
      data: { clearedAt: new Date(), clearedById: teacher.id },
    });

    await logAudit({
      actor: teacher,
      action: "debt.clear",
      targetName: debt.student.name,
      subjectName: debt.lesson.subject.name,
      details: `${lessonRef(debt.lesson.subject.name, debt.lesson.date)}: долг снят`,
    });

    revalidatePath("/journal");
    revalidatePath("/journal/debts");
    revalidatePath("/student");
    return actionOk(null, "Долг снят");
  } catch (error) {
    return actionError(error);
  }
}

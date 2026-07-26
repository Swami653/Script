"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { lessonRef, logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth-guards";
import { syncControlDebts } from "@/lib/debts";
import { isGradelessClassName } from "@/lib/gradeless";
import {
  asGradeKind,
  GRADE_KINDS,
  gradeKindSchema,
  gradeSlotSchema,
  gradeValueSchema,
  MAX_BULK_GRADES,
  weightForKind,
} from "@/lib/grades";
import { requireMarkTarget, requireWritableLesson } from "@/lib/lesson-guards";
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
 * ВТОРОЕ ПРАВИЛО: урок для записи берётся ТОЛЬКО через requireWritableLesson
 * (src/lib/lesson-guards.ts) — единственную дверь, которая сама отказывает,
 * если урока нет, он в корзине или его четверть закрыта замком (423).
 *
 * ТРЕТЬЕ ПРАВИЛО: ученик берётся ТОЛЬКО через requireMarkTarget — гвард
 * отклоняет не-учеников (404) и сверяет политику оценивания с классом:
 * балл ученику безотметочного 1–2 класса невозможен (409, policy "graded");
 * «Н» и удаления универсальны (policy "any"). Формула действия с клеткой:
 * requireRole → zod → requireWritableLesson → requireMarkTarget.
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

    // Балл ученику безотметочного 1–2 класса невозможен — policy "graded".
    const [lesson, student, cellGrades] = await Promise.all([
      requireWritableLesson(parsed.lessonId),
      requireMarkTarget(parsed.studentId, "graded"),
      prisma.grade.findMany({
        where: { studentId: parsed.studentId, lessonId: parsed.lessonId },
        select: { slot: true, value: true },
      }),
    ]);

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

    // Клетка содержит одно из: оценки | уровень | «Н» — выставили оценку,
    // отметка отсутствия и уровень освоения (данные окна деплоя или перевода
    // классов) снимаются одной транзакцией.
    await prisma.$transaction([
      prisma.absence.deleteMany({
        where: { studentId: parsed.studentId, lessonId: parsed.lessonId },
      }),
      prisma.masteryMark.deleteMany({
        where: { studentId: parsed.studentId, lessonId: parsed.lessonId },
      }),
    ]);

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

    // Оценка закрывает долг сама (статус выводится), но клетка могла перестать
    // быть контрольной и т.п. — редьюсер приводит долги урока к инварианту.
    await syncControlDebts(lesson.id);

    revalidatePath("/journal");
    revalidatePath("/student");

    return actionOk(grade, `Оценка ${grade.value} сохранена`);
  } catch (error) {
    return actionError(error);
  }
}

const bulkEntrySchema = z.object({
  studentId: z.string().min(1, "Не указан ученик"),
  value: gradeValueSchema,
});

const setGradesBulkSchema = z.object({
  lessonId: z.string().min(1, "Не указан урок"),
  kind: gradeKindSchema.default("regular"),
  entries: z
    .array(bulkEntrySchema)
    .min(1, "Не выбрано ни одной оценки")
    .max(MAX_BULK_GRADES, `За один раз можно выставить не более ${MAX_BULK_GRADES} оценок`),
});

/**
 * Массовое выставление: оценка каждому ученику из списка за один урок.
 * Оценка встаёт в первую позицию клетки (slot 0), заменяя уже стоящую;
 * отметка «Н» у затронутых учеников снимается. Комментарии существующих
 * оценок не трогаются. В журнал изменений уходит одна сводная запись.
 */
export async function setGradesBulkAction(input: {
  lessonId: string;
  kind?: unknown;
  entries: { studentId: string; value: unknown }[];
}): Promise<ActionResult<{ count: number }>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);

    const parsed = setGradesBulkSchema.parse({
      lessonId: input.lessonId,
      kind: typeof input.kind === "string" ? input.kind : "regular",
      entries: Array.isArray(input.entries)
        ? input.entries.map((entry) => ({
            studentId: entry?.studentId,
            value: normalizeNumberInput(entry?.value),
          }))
        : input.entries,
    });

    // Повторы одного ученика схлопываем — последняя оценка в списке выигрывает.
    const byStudent = new Map<string, number>();
    for (const entry of parsed.entries) byStudent.set(entry.studentId, entry.value);
    const studentIds = [...byStudent.keys()];

    const kind = asGradeKind(parsed.kind);
    const weight = weightForKind(kind);

    // Урок и ВСЕ ученики проверяются в БД: оценку нельзя выставить ни на чужой
    // (несуществующий) id, ни пользователю с ролью учителя или администратора.
    const [lesson, students] = await Promise.all([
      requireWritableLesson(parsed.lessonId),
      prisma.user.findMany({
        where: { id: { in: studentIds }, role: "STUDENT" },
        select: { id: true, name: true, className: true },
      }),
    ]);
    if (students.length !== studentIds.length) {
      return actionFail("Часть учеников не найдена или не является учениками", 400);
    }

    // Гейт безотметочности: среди целей есть ученики 1–2 классов — отклоняется
    // ВЕСЬ батч до транзакции, с именами (учитель должен видеть, кого снять).
    const gradelessTargets = students.filter((student) =>
      isGradelessClassName(student.className),
    );
    if (gradelessTargets.length > 0) {
      return actionFail(
        "В 1–2 классах оценки не выставляются: " +
          gradelessTargets.map((student) => student.name).join(", "),
        409,
      );
    }

    // Одна транзакция на весь список: либо оценки получают все, либо никто.
    await prisma.$transaction([
      ...studentIds.map((studentId) =>
        prisma.grade.upsert({
          where: {
            studentId_lessonId_slot: { studentId, lessonId: lesson.id, slot: 0 },
          },
          create: {
            value: byStudent.get(studentId)!,
            slot: 0,
            kind,
            weight,
            studentId,
            lessonId: lesson.id,
            // Денормализованные поля берём ТОЛЬКО из урока — инвариант схемы.
            subjectId: lesson.subjectId,
            quarter: lesson.quarter,
            year: lesson.year,
            teacherId: teacher.id,
          },
          update: {
            value: byStudent.get(studentId)!,
            kind,
            weight,
            subjectId: lesson.subjectId,
            quarter: lesson.quarter,
            year: lesson.year,
            teacherId: teacher.id,
          },
        }),
      ),
      // Клетка эксклюзивна — у затронутых снимаются «Н» и (исторические,
      // после перевода классов) уровни освоения.
      prisma.absence.deleteMany({
        where: { lessonId: lesson.id, studentId: { in: studentIds } },
      }),
      prisma.masteryMark.deleteMany({
        where: { lessonId: lesson.id, studentId: { in: studentIds } },
      }),
    ]);

    const count = studentIds.length;
    await logAudit({
      actor: teacher,
      action: "grades.bulk",
      subjectName: lesson.subject.name,
      details:
        `${lessonRef(lesson.subject.name, lesson.date)}: выставлено ${count} ` +
        `${pluralize(count, "оценка", "оценки", "оценок")} ` +
        `(${GRADE_KINDS[kind].label.toLowerCase()})`,
    });

    await syncControlDebts(lesson.id);

    revalidatePath("/journal");
    revalidatePath("/student");

    return actionOk({ count }, `Выставлено оценок: ${count}`);
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

    // Удаление — policy "any": чистка доступна и после перевода между системами.
    const [lesson, student, cellGrades] = await Promise.all([
      requireWritableLesson(parsed.lessonId),
      requireMarkTarget(parsed.studentId, "any"),
      prisma.grade.findMany({
        where: { studentId: parsed.studentId, lessonId: parsed.lessonId },
        orderBy: { slot: "asc" },
        select: { id: true, slot: true, value: true },
      }),
    ]);

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

    // Удаление закрывшей оценки при живом «Н» возвращает долг в открытые;
    // без «Н» — авто-долг растворяется (решение #17). Всё делает редьюсер.
    await syncControlDebts(lesson.id);

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

    // «Н» универсальна — policy "any": посещаемость отмечается и в 1–2 классах.
    const [lesson, student] = await Promise.all([
      requireWritableLesson(lessonId),
      requireMarkTarget(studentId, "any"),
    ]);

    // Клетка содержит одно из: оценки | уровень | «Н» — отметка отсутствия
    // вытесняет из клетки оценки, уровень освоения и печати одной транзакцией.
    const [removedGrades, removedMastery, removedStamps] = await prisma.$transaction([
      prisma.grade.deleteMany({ where: { studentId, lessonId } }),
      prisma.masteryMark.deleteMany({ where: { studentId, lessonId } }),
      prisma.lessonStamp.deleteMany({ where: { studentId, lessonId } }),
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
        (removedGrades.count > 0 ? `, снято оценок: ${removedGrades.count}` : "") +
        (removedMastery.count > 0 ? ", уровень снят" : "") +
        (removedStamps.count > 0 ? `, печатей снято: ${removedStamps.count}` : ""),
    });

    // Именно здесь рождаются авто-долги: «Н» на прошедшей контрольной.
    await syncControlDebts(lesson.id);

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
      requireWritableLesson(lessonId),
      requireMarkTarget(studentId, "any"),
    ]);

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

    // Сняли ошибочное «Н» — фантомный авто-долг растворяется редьюсером.
    await syncControlDebts(lesson.id);

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
      requireWritableLesson(lessonId),
      requireMarkTarget(studentId, "any"),
    ]);

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

    await syncControlDebts(lesson.id);

    revalidatePath("/journal");
    revalidatePath("/student");

    return actionOk(null, count > 0 ? "Оценки удалены" : "Оценок не было");
  } catch (error) {
    return actionError(error);
  }
}

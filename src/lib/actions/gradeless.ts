"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { lessonRef, logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth-guards";
import {
  MASTERY_LEVELS,
  MAX_STAMPS_PER_LESSON,
  masteryLevelSchema,
  quarterNoteTextSchema,
  STAMP_KINDS,
  stampKindSchema,
  type MasteryLevel,
  type StampKind,
} from "@/lib/gradeless";
import { quarterSchema } from "@/lib/grades";
import {
  assertQuarterOpen,
  requireMarkTarget,
  requireWritableLesson,
} from "@/lib/lesson-guards";
import { prisma } from "@/lib/prisma";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";

/**
 * Server Actions безотметочного обучения (1–2 классы): печати-поощрения,
 * уровни освоения, словесная характеристика за четверть.
 *
 * Каркас каждого действия — формула CLAUDE.md:
 * requireRole → zod (все поля, включая id) → requireWritableLesson →
 * requireMarkTarget → БД → logAudit → revalidatePath; catch → actionError.
 *
 * Политики requireMarkTarget: запись уровня/печати — "gradeless" (оценочному
 * ученику 409), удаления — "any" (чистка доступна всегда: после перевода
 * 2→3 старые записи не должны стать неудаляемыми).
 *
 * Правило клетки: она содержит ОДНО ИЗ — оценки | уровень | «Н». Взаимное
 * вытеснение выполняется в одной $transaction, счётчики снятого — в аудит.
 * Ничто из этого файла НИКОГДА не попадает в средние баллы.
 */

const stampSchema = z.object({
  studentId: z.string().min(1, "Не указан ученик"),
  lessonId: z.string().min(1, "Не указан урок"),
  kind: stampKindSchema,
});

/**
 * Поставить печать-поощрение. Идемпотентный upsert своего вида (двойной клик
 * при оптимистичном UI — не ошибка), лимит MAX_STAMPS_PER_LESSON — по числу
 * ДРУГИХ видов в клетке. Печать при стоящем «Н» невозможна: сначала снимите «Н».
 */
export async function setStampAction(input: {
  studentId: string;
  lessonId: string;
  kind: unknown;
}): Promise<ActionResult<{ kind: StampKind }>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const parsed = stampSchema.parse(input);
    const kind = parsed.kind as StampKind;

    const lesson = await requireWritableLesson(parsed.lessonId);
    const student = await requireMarkTarget(parsed.studentId, "gradeless");

    const [absence, cellStamps] = await Promise.all([
      prisma.absence.findUnique({
        where: {
          studentId_lessonId: { studentId: student.id, lessonId: lesson.id },
        },
        select: { id: true },
      }),
      prisma.lessonStamp.findMany({
        where: { studentId: student.id, lessonId: lesson.id },
        select: { kind: true },
      }),
    ]);

    if (absence) {
      return actionFail("Ученик отмечен отсутствующим — сначала снимите «Н»", 409);
    }
    // Upsert своего вида новой печатью не считается — лимит по другим видам.
    const otherKinds = cellStamps.filter((stamp) => stamp.kind !== kind);
    if (otherKinds.length >= MAX_STAMPS_PER_LESSON) {
      return actionFail(
        `За один урок можно выдать не больше ${MAX_STAMPS_PER_LESSON} печатей`,
        409,
      );
    }

    await prisma.lessonStamp.upsert({
      where: {
        studentId_lessonId_kind: {
          studentId: student.id,
          lessonId: lesson.id,
          kind,
        },
      },
      create: {
        kind,
        studentId: student.id,
        lessonId: lesson.id,
        // Денормализованные поля берём ТОЛЬКО из урока — инвариант схемы.
        subjectId: lesson.subjectId,
        year: lesson.year,
        quarter: lesson.quarter,
        teacherId: teacher.id,
      },
      update: { teacherId: teacher.id },
    });

    await logAudit({
      actor: teacher,
      action: "stamp.set",
      targetName: student.name,
      subjectName: lesson.subject.name,
      details:
        `${lessonRef(lesson.subject.name, lesson.date)}: ` +
        `печать «${STAMP_KINDS[kind].label}»`,
    });

    revalidatePath("/journal");
    revalidatePath("/student");
    return actionOk({ kind }, `Печать «${STAMP_KINDS[kind].label}» поставлена`);
  } catch (error) {
    return actionError(error);
  }
}

/** Снять печать. Политика не проверяется ("any") — чистка доступна всегда. */
export async function removeStampAction(input: {
  studentId: string;
  lessonId: string;
  kind: unknown;
}): Promise<ActionResult<null>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const parsed = stampSchema.parse(input);
    const kind = parsed.kind as StampKind;

    const lesson = await requireWritableLesson(parsed.lessonId);
    const student = await requireMarkTarget(parsed.studentId, "any");

    const { count } = await prisma.lessonStamp.deleteMany({
      where: { studentId: student.id, lessonId: lesson.id, kind },
    });

    if (count > 0) {
      await logAudit({
        actor: teacher,
        action: "stamp.remove",
        targetName: student.name,
        subjectName: lesson.subject.name,
        details:
          `${lessonRef(lesson.subject.name, lesson.date)}: ` +
          `снята печать «${STAMP_KINDS[kind].label}»`,
      });
    }

    revalidatePath("/journal");
    revalidatePath("/student");
    return actionOk(null, count > 0 ? "Печать снята" : "Печати не было");
  } catch (error) {
    return actionError(error);
  }
}

const masterySchema = z.object({
  studentId: z.string().min(1, "Не указан ученик"),
  lessonId: z.string().min(1, "Не указан урок"),
  level: masteryLevelSchema,
  comment: z
    .string()
    .trim()
    .max(300, "Комментарий — не длиннее 300 символов")
    .optional(),
});

/**
 * Отметить уровень освоения. Одна $transaction вытесняет из клетки оценки и
 * «Н» (правило «клетка содержит одно из: оценки | уровень | Н») — иначе после
 * перевода 3→2 или записи в окно деплоя возможна клетка «оценка + уровень»,
 * которую не отображает ни один рендер.
 */
export async function setMasteryAction(input: {
  studentId: string;
  lessonId: string;
  level: unknown;
  comment?: unknown;
}): Promise<ActionResult<{ level: MasteryLevel }>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const parsed = masterySchema.parse({
      studentId: input.studentId,
      lessonId: input.lessonId,
      level: input.level,
      comment: typeof input.comment === "string" ? input.comment : undefined,
    });
    const level = parsed.level as MasteryLevel;
    const comment = parsed.comment?.trim() || null;

    const lesson = await requireWritableLesson(parsed.lessonId);
    const student = await requireMarkTarget(parsed.studentId, "gradeless");

    const [removedGrades, removedAbsences] = await prisma.$transaction([
      prisma.grade.deleteMany({
        where: { studentId: student.id, lessonId: lesson.id },
      }),
      prisma.absence.deleteMany({
        where: { studentId: student.id, lessonId: lesson.id },
      }),
      prisma.masteryMark.upsert({
        where: {
          studentId_lessonId: { studentId: student.id, lessonId: lesson.id },
        },
        create: {
          level,
          comment,
          studentId: student.id,
          lessonId: lesson.id,
          // Денормализованные поля берём ТОЛЬКО из урока — инвариант схемы.
          subjectId: lesson.subjectId,
          year: lesson.year,
          quarter: lesson.quarter,
          teacherId: teacher.id,
        },
        update: { level, comment, teacherId: teacher.id },
      }),
    ]);

    await logAudit({
      actor: teacher,
      action: "mastery.set",
      targetName: student.name,
      subjectName: lesson.subject.name,
      details:
        `${lessonRef(lesson.subject.name, lesson.date)}: ` +
        `уровень «${MASTERY_LEVELS[level].teacherLabel}»` +
        (comment ? ", с комментарием" : "") +
        (removedGrades.count > 0 ? `, снято оценок: ${removedGrades.count}` : "") +
        (removedAbsences.count > 0 ? ", снята отметка «Н»" : ""),
    });

    revalidatePath("/journal");
    revalidatePath("/student");
    return actionOk({ level }, `Уровень: ${MASTERY_LEVELS[level].label}`);
  } catch (error) {
    return actionError(error);
  }
}

const cellSchema = z.object({
  studentId: z.string().min(1, "Не указан ученик"),
  lessonId: z.string().min(1, "Не указан урок"),
});

/** Снять уровень освоения. Политика не проверяется ("any") — чистка доступна всегда. */
export async function clearMasteryAction(input: {
  studentId: string;
  lessonId: string;
}): Promise<ActionResult<null>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const parsed = cellSchema.parse(input);

    const lesson = await requireWritableLesson(parsed.lessonId);
    const student = await requireMarkTarget(parsed.studentId, "any");

    const { count } = await prisma.masteryMark.deleteMany({
      where: { studentId: student.id, lessonId: lesson.id },
    });

    if (count > 0) {
      await logAudit({
        actor: teacher,
        action: "mastery.clear",
        targetName: student.name,
        subjectName: lesson.subject.name,
        details: `${lessonRef(lesson.subject.name, lesson.date)}: уровень снят`,
      });
    }

    revalidatePath("/journal");
    revalidatePath("/student");
    return actionOk(null, count > 0 ? "Уровень снят" : "Уровня не было");
  } catch (error) {
    return actionError(error);
  }
}

const quarterNoteSchema = z.object({
  studentId: z.string().min(1, "Не указан ученик"),
  subjectId: z.string().min(1, "Не указан предмет"),
  year: z
    .number({ invalid_type_error: "Учебный год должен быть числом" })
    .int("Учебный год должен быть целым числом")
    .min(2000, "Учебный год должен быть не раньше 2000")
    .max(2100, "Учебный год должен быть не позже 2100"),
  quarter: quarterSchema,
  text: quarterNoteTextSchema,
});

/**
 * Приводит значение из формы к числу, НЕ ослабляя валидацию:
 * "2025" -> 2025, а "20.5", "abc", "" остаются как есть и будут отклонены схемой.
 */
function normalizeNumberInput(value: unknown): unknown {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return value;
}

/**
 * Сохранить (или удалить пустым текстом) словесную характеристику за четверть.
 * Урока нет, поэтому замок проверяется напрямую: assertQuarterOpen по тройке
 * (subjectId, year, quarter) — закрытие четверти замораживает и характеристику
 * (423). Пустой текст = удаление: отдельного действия не нужно.
 */
export async function saveQuarterNoteAction(input: {
  studentId: string;
  subjectId: string;
  year: unknown;
  quarter: unknown;
  text: unknown;
}): Promise<ActionResult<{ saved: boolean }>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const parsed = quarterNoteSchema.parse({
      studentId: input.studentId,
      subjectId: input.subjectId,
      year: normalizeNumberInput(input.year),
      quarter: normalizeNumberInput(input.quarter),
      text: input.text,
    });

    const student = await requireMarkTarget(parsed.studentId, "gradeless");
    const subject = await prisma.subject.findUnique({
      where: { id: parsed.subjectId },
      select: { id: true, name: true },
    });
    if (!subject) return actionFail("Предмет не найден", 404);

    await assertQuarterOpen(subject.id, parsed.year, parsed.quarter);

    const noteRef =
      `${subject.name}, ${parsed.quarter} четверть ` +
      `${parsed.year}/${parsed.year + 1}`;

    if (parsed.text === "") {
      const { count } = await prisma.quarterNote.deleteMany({
        where: {
          studentId: student.id,
          subjectId: subject.id,
          year: parsed.year,
          quarter: parsed.quarter,
        },
      });
      if (count > 0) {
        await logAudit({
          actor: teacher,
          action: "note.delete",
          targetName: student.name,
          subjectName: subject.name,
          details: `${noteRef}: характеристика удалена`,
        });
      }
      revalidatePath("/journal");
      revalidatePath("/student");
      return actionOk({ saved: false }, "Характеристика удалена");
    }

    await prisma.quarterNote.upsert({
      where: {
        studentId_subjectId_year_quarter: {
          studentId: student.id,
          subjectId: subject.id,
          year: parsed.year,
          quarter: parsed.quarter,
        },
      },
      create: {
        text: parsed.text,
        studentId: student.id,
        subjectId: subject.id,
        year: parsed.year,
        quarter: parsed.quarter,
        teacherId: teacher.id,
      },
      update: { text: parsed.text, teacherId: teacher.id },
    });

    await logAudit({
      actor: teacher,
      action: "note.save",
      targetName: student.name,
      subjectName: subject.name,
      details: `${noteRef}: характеристика обновлена`,
    });

    revalidatePath("/journal");
    revalidatePath("/student");
    return actionOk({ saved: true }, "Характеристика сохранена");
  } catch (error) {
    return actionError(error);
  }
}

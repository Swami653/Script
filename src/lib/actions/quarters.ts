"use server";

import { randomUUID } from "crypto";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth-guards";
import { formatAverage, quarterSchema, type Quarter } from "@/lib/grades";
import { prisma } from "@/lib/prisma";
import { getQuarterReview, type QuarterReview } from "@/lib/queries";
import { findOverlap, MAX_BULK_QUARTER_CLOSE, quarterPeriodSchema } from "@/lib/quarters";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";
import { ACTIVE_YEAR_KEY } from "@/lib/school-year";
import { formatDateShort, parseDateInputValue, pluralize } from "@/lib/utils";

/**
 * Учебный год, границы четвертей и ЗАМОК четверти. Настраивает учитель (или
 * администратор): даты определяют, какая четверть «идёт сейчас» и в какую
 * четверть попадёт урок при добавлении; замок (QuarterLock) фиксирует итоги —
 * пока он висит, оценки периода не меняются (см. src/lib/lesson-guards.ts).
 */

const yearSchema = z
  .number({ invalid_type_error: "Учебный год должен быть числом" })
  .int("Учебный год должен быть целым числом")
  .min(2000, "Учебный год должен быть не раньше 2000")
  .max(2100, "Учебный год должен быть не позже 2100");

/** Сохранить границы одной четверти. Пересечения с другими четвертями запрещены. */
export async function saveQuarterPeriodAction(input: {
  year: number;
  quarter: number;
  startDate: string;
  endDate: string;
}): Promise<ActionResult<null>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);

    const year = yearSchema.parse(input.year);
    const parsed = quarterPeriodSchema.parse({
      quarter: input.quarter,
      startDate: input.startDate,
      endDate: input.endDate,
    });

    const startDate = parseDateInputValue(parsed.startDate);
    const endDate = parseDateInputValue(parsed.endDate);

    const others = await prisma.quarterPeriod.findMany({
      where: { year, NOT: { quarter: parsed.quarter } },
      select: { quarter: true, startDate: true, endDate: true },
    });

    const overlap = findOverlap(others, { quarter: parsed.quarter, startDate, endDate });
    if (overlap) {
      return actionFail(
        `Даты пересекаются с ${overlap.quarter} четвертью — исправьте границы`,
        409,
      );
    }

    await prisma.quarterPeriod.upsert({
      where: { year_quarter: { year, quarter: parsed.quarter } },
      create: {
        year,
        quarter: parsed.quarter,
        startDate,
        endDate,
        authorId: teacher.id,
      },
      update: { startDate, endDate, authorId: teacher.id },
    });

    revalidatePath("/journal");
    revalidatePath("/journal/year");
    revalidatePath("/student");
    return actionOk(null, `${parsed.quarter} четверть сохранена`);
  } catch (error) {
    return actionError(error);
  }
}

export async function deleteQuarterPeriodAction(input: {
  year: number;
  quarter: number;
}): Promise<ActionResult<null>> {
  try {
    await requireRole(GRADE_EDITOR_ROLES);
    const year = yearSchema.parse(input.year);
    const quarter = z.number().int().min(1).max(4).parse(input.quarter);

    const existing = await prisma.quarterPeriod.findUnique({
      where: { year_quarter: { year, quarter } },
      select: { id: true },
    });
    if (!existing) return actionOk(null, "Период не был задан");

    await prisma.quarterPeriod.delete({ where: { id: existing.id } });

    revalidatePath("/journal");
    revalidatePath("/journal/year");
    return actionOk(null, `Границы ${quarter} четверти удалены`);
  } catch (error) {
    return actionError(error);
  }
}

/* ── Закрытие и переоткрытие четверти ─────────────────────────────────────── */

const quarterKeySchema = z.object({
  subjectId: z.string().min(1, "Не выбран предмет"),
  year: yearSchema,
  quarter: quarterSchema,
});

/** Сводка для аудита и тоста: «учеников 27, средний 7.12, качество 63%, успеваемость 96%». */
function reviewSummaryText(review: QuarterReview): string {
  const percent = (value: number | null) => (value === null ? "—" : `${value}%`);
  return (
    `учеников ${review.rows.length}, средний ${formatAverage(review.classAverage)}, ` +
    `качество ${percent(review.summary.qualityPercent)}, ` +
    `успеваемость ${percent(review.summary.passingPercent)}`
  );
}

/**
 * Строки снимка-ведомости из данных мастера (denorm-поля — только из ключа
 * замка). Безотметочные ученики (1–2 классы) фиксируются строками
 * gradeless: true БЕЗ среднего и отметки («б/о», не «н/а»), с текстом
 * характеристики на момент закрытия — ведомость обязана быть полным документом.
 */
function snapshotRows(
  review: QuarterReview,
  lockId: string,
  subjectId: string,
  year: number,
  quarter: number,
) {
  return [
    ...review.rows.map((row) => ({
      lockId,
      studentId: row.student.id,
      studentName: row.student.name,
      className: row.student.className,
      subjectId,
      year,
      quarter,
      average: row.average,
      finalGrade: row.proposed,
      gradeCount: row.gradeCount,
      absenceCount: row.absenceCount,
      gradeless: false,
      note: null as string | null,
    })),
    ...review.gradelessRows.map((row) => ({
      lockId,
      studentId: row.student.id,
      studentName: row.student.name,
      className: row.student.className,
      subjectId,
      year,
      quarter,
      // Средний и отметка у безотметочного не существуют — null всегда,
      // даже при исторических оценках после перевода классов.
      average: null as number | null,
      finalGrade: null as number | null,
      gradeCount: row.gradeCount,
      absenceCount: row.absenceCount,
      gradeless: true,
      note: row.note,
    })),
  ];
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const CLOSE_REVALIDATE_PATHS = [
  "/journal",
  "/journal/results",
  "/journal/year",
  "/journal/debts",
  "/student",
] as const;

/**
 * Закрыть четверть предмета: поставить замок и записать снимок-ведомость.
 *
 * Порядок «замок сначала, снимок потом» принципиален: create по уникальному
 * индексу атомарно захватывает четверть, после чего guard уже отбивает записи
 * оценок, и снимок читает неподвижные данные. Интерактивные транзакции на
 * pgbouncer-пуле (connection_limit=1) хрупки — вместо них компенсация:
 * не удалось записать снимок — замок снимается. Четвертная отметка НЕ
 * редактируется: finalGrade = quarterMark(average), считает сервер.
 */
export async function closeQuarterAction(input: {
  subjectId: string;
  year: number;
  quarter: number;
}): Promise<ActionResult<{ students: number; classAverage: number | null }>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const parsed = quarterKeySchema.parse(input);

    const subject = await prisma.subject.findUnique({
      where: { id: parsed.subjectId },
      select: { id: true, name: true },
    });
    if (!subject) return actionFail("Предмет не найден", 404);

    // ЗАМОК ПЕРВЫМ. Гонка двух вкладок решается уникальным индексом: P2002 -> 409.
    let lock: { id: string };
    try {
      lock = await prisma.quarterLock.create({
        data: {
          subjectId: parsed.subjectId,
          year: parsed.year,
          quarter: parsed.quarter,
          closedById: teacher.id,
          closedByName: teacher.name,
        },
        select: { id: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return actionFail("Четверть уже закрыта", 409);
      throw error;
    }

    // Снимок — БЕЗ фильтра класса: ведомость всегда полная, фильтр — только просмотр.
    let review: QuarterReview;
    try {
      review = await getQuarterReview(
        parsed.subjectId,
        parsed.quarter as Quarter,
        parsed.year,
      );
      await prisma.quarterResult.createMany({
        data: snapshotRows(review, lock.id, parsed.subjectId, parsed.year, parsed.quarter),
      });
    } catch (error) {
      // Компенсация: снимок не записался — замок не должен остаться висеть.
      await prisma.quarterLock.delete({ where: { id: lock.id } }).catch(() => {});
      throw error;
    }

    await logAudit({
      actor: teacher,
      action: "quarter.close",
      subjectName: subject.name,
      details:
        `${subject.name}: ${parsed.quarter} четверть ${parsed.year}/${parsed.year + 1} ` +
        `закрыта — ${reviewSummaryText(review)}`,
    });

    for (const path of CLOSE_REVALIDATE_PATHS) revalidatePath(path);
    return actionOk(
      { students: review.rows.length, classAverage: review.classAverage },
      "Четверть закрыта",
    );
  } catch (error) {
    return actionError(error);
  }
}

const bulkCloseSchema = z.object({
  subjectIds: z
    .array(z.string().min(1, "Не указан предмет"))
    .min(1, "Не выбран ни один предмет")
    .max(
      MAX_BULK_QUARTER_CLOSE,
      `За один раз можно закрыть не более ${MAX_BULK_QUARTER_CLOSE} предметов`,
    ),
  year: yearSchema,
  quarter: quarterSchema,
});

/**
 * Закрыть четверть сразу по НЕСКОЛЬКИМ предметам — одно подтверждение вместо
 * 12–16 одинаковых (один учитель ведёт все предметы двух классов). Механика
 * та же, что у closeQuarterAction, но пакетом: все замки одним createMany
 * (атомарный захват — гонка даёт P2002 на весь пакет), затем снимки всех
 * предметов одним createMany; при ошибке снимков компенсация снимает ВСЕ
 * замки пакета — либо закрылись все отмеченные предметы, либо ни один.
 * Переоткрытие остаётся поштучным (редкое админское действие).
 * В журнал изменений уходит одна сводная запись (по образцу grades.bulk).
 */
export async function closeQuartersBulkAction(input: {
  subjectIds: string[];
  year: number;
  quarter: number;
}): Promise<ActionResult<{ closed: number; students: number }>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);
    const parsed = bulkCloseSchema.parse(input);
    // Повторы схлопываем: [id, id] — это один предмет.
    const subjectIds = [...new Set(parsed.subjectIds)];

    const [subjects, existingLocks, lessonCounts] = await Promise.all([
      prisma.subject.findMany({
        where: { id: { in: subjectIds } },
        select: { id: true, name: true },
      }),
      prisma.quarterLock.findMany({
        where: { subjectId: { in: subjectIds }, year: parsed.year, quarter: parsed.quarter },
        select: { subjectId: true },
      }),
      prisma.lesson.groupBy({
        by: ["subjectId"],
        where: {
          subjectId: { in: subjectIds },
          year: parsed.year,
          quarter: parsed.quarter,
          deletedAt: null,
        },
        _count: { _all: true },
      }),
    ]);

    if (subjects.length !== subjectIds.length) {
      return actionFail("Часть предметов не найдена", 404);
    }
    const nameById = new Map(subjects.map((subject) => [subject.id, subject.name]));

    // Уже закрытые и пустые предметы отбиваются ЯВНО, а не пропускаются молча:
    // учитель должен видеть, что именно не так, и снять предмет из выбора.
    if (existingLocks.length > 0) {
      const names = existingLocks.map((lock) => nameById.get(lock.subjectId)).join(", ");
      return actionFail(`Уже закрыты: ${names} — снимите их из выбора`, 409);
    }
    const withLessons = new Set(lessonCounts.map((row) => row.subjectId));
    const empty = subjectIds.filter((id) => !withLessons.has(id));
    if (empty.length > 0) {
      const names = empty.map((id) => nameById.get(id)).join(", ");
      return actionFail(
        `Нет уроков в этой четверти: ${names} — закрывать нечего, снимите их из выбора`,
        400,
      );
    }

    // ЗАМКИ ПЕРВЫМИ, одним атомарным createMany (id генерируются заранее,
    // чтобы снимки могли сослаться на них без чтения из базы).
    const locks = subjectIds.map((subjectId) => ({
      id: randomUUID(),
      subjectId,
      year: parsed.year,
      quarter: parsed.quarter,
      closedById: teacher.id,
      closedByName: teacher.name,
    }));
    try {
      await prisma.quarterLock.createMany({ data: locks });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return actionFail("Часть предметов уже закрыта — обновите страницу", 409);
      }
      throw error;
    }

    // Снимки читаются ПОСЛЕ установки замков (записи уже отбиваются guard'ом)
    // и пишутся одним createMany; ошибка — компенсация снимает весь пакет.
    let totalStudents = 0;
    const summaries: string[] = [];
    try {
      const resultRows: ReturnType<typeof snapshotRows> = [];
      // Последовательно, не Promise.all: пул pgbouncer с connection_limit=1.
      for (const lock of locks) {
        const review = await getQuarterReview(
          lock.subjectId,
          parsed.quarter as Quarter,
          parsed.year,
        );
        resultRows.push(
          ...snapshotRows(review, lock.id, lock.subjectId, parsed.year, parsed.quarter),
        );
        totalStudents += review.rows.length;
        summaries.push(`${nameById.get(lock.subjectId)} — ${reviewSummaryText(review)}`);
      }
      if (resultRows.length > 0) {
        await prisma.quarterResult.createMany({ data: resultRows });
      }
    } catch (error) {
      await prisma.quarterLock
        .deleteMany({ where: { id: { in: locks.map((lock) => lock.id) } } })
        .catch(() => {});
      throw error;
    }

    const count = locks.length;
    await logAudit({
      actor: teacher,
      action: "quarters.close",
      details:
        `${parsed.quarter} четверть ${parsed.year}/${parsed.year + 1} закрыта по ` +
        `${count} ${pluralize(count, "предмету", "предметам", "предметам")}: ` +
        summaries.join("; "),
    });

    for (const path of CLOSE_REVALIDATE_PATHS) revalidatePath(path);
    return actionOk(
      { closed: count, students: totalStudents },
      `Закрыто предметов: ${count}`,
    );
  } catch (error) {
    return actionError(error);
  }
}

const reopenSchema = quarterKeySchema.extend({
  reason: z.string().trim().max(200, "Причина — не длиннее 200 символов").optional(),
});

/**
 * Переоткрыть четверть — ЕДИНСТВЕННОЕ чисто админское действие фазы.
 * Замок удаляется, снимок-ведомость уходит каскадом: итоги официально
 * «не действуют» до повторного закрытия. Причина — необязательна и живёт
 * только в аудите (сводка закрытия остаётся в вечной записи quarter.close).
 * Тихого обхода замка для ADMIN нет намеренно: правки закрытого периода
 * обязаны оставлять след «переоткрыл — исправил — закрыл заново».
 */
export async function reopenQuarterAction(input: {
  subjectId: string;
  year: number;
  quarter: number;
  reason?: string;
}): Promise<ActionResult<null>> {
  try {
    const admin = await requireRole(["ADMIN"]);
    const parsed = reopenSchema.parse(input);

    const lock = await prisma.quarterLock.findUnique({
      where: {
        subjectId_year_quarter: {
          subjectId: parsed.subjectId,
          year: parsed.year,
          quarter: parsed.quarter,
        },
      },
      select: {
        id: true,
        closedAt: true,
        closedByName: true,
        subject: { select: { name: true } },
      },
    });
    // Идемпотентность: повторное нажатие не должно быть ошибкой.
    if (!lock) return actionOk(null, "Четверть и так открыта");

    await prisma.quarterLock.delete({ where: { id: lock.id } });

    await logAudit({
      actor: admin,
      action: "quarter.reopen",
      subjectName: lock.subject.name,
      details:
        `${lock.subject.name}: ${parsed.quarter} четверть ${parsed.year}/${parsed.year + 1} ` +
        `переоткрыта (была закрыта ${formatDateShort(lock.closedAt)}, ${lock.closedByName})` +
        (parsed.reason ? `; причина: «${parsed.reason}»` : ""),
    });

    for (const path of CLOSE_REVALIDATE_PATHS) revalidatePath(path);
    return actionOk(null, "Четверть переоткрыта — итоги не действуют до повторного закрытия");
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Сделать учебный год активным. Настройка общая: журнал и дневники всех
 * пользователей начинают показывать именно этот год.
 */
export async function setActiveYearAction(input: {
  year: number;
}): Promise<ActionResult<{ year: number }>> {
  try {
    await requireRole(GRADE_EDITOR_ROLES);
    const year = yearSchema.parse(input.year);

    await prisma.appSetting.upsert({
      where: { key: ACTIVE_YEAR_KEY },
      create: { key: ACTIVE_YEAR_KEY, value: String(year) },
      update: { value: String(year) },
    });

    revalidatePath("/journal");
    revalidatePath("/journal/year");
    revalidatePath("/student");
    return actionOk({ year }, `Активный учебный год: ${year}/${year + 1}`);
  } catch (error) {
    return actionError(error);
  }
}

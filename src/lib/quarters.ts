import { z } from "zod";

import { quarterSchema, type Quarter } from "@/lib/grades";

/**
 * Границы четвертей учебного года.
 *
 * Раньше «текущая четверть» угадывалась по календарю (сентябрь — первая и т.д.).
 * Теперь учитель задаёт реальные даты, а календарная догадка осталась только
 * запасным вариантом на случай, если периоды ещё не заведены.
 */

export type QuarterPeriodInput = {
  quarter: number;
  startDate: string;
  endDate: string;
};

export type PeriodLike = {
  quarter: number;
  startDate: Date;
  endDate: Date;
};

export const quarterPeriodSchema = z
  .object({
    quarter: quarterSchema,
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата начала — в формате ГГГГ-ММ-ДД"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата окончания — в формате ГГГГ-ММ-ДД"),
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: "Четверть не может закончиться раньше, чем началась",
    path: ["endDate"],
  });

/** Учебный год по дате: сентябрь открывает новый год. 2025 — это 2025/2026. */
export function academicYearOf(date = new Date()): number {
  return date.getUTCMonth() + 1 >= 9 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

/** Попадает ли дата в период (границы включительно). */
export function periodContains(period: PeriodLike, date: Date): boolean {
  return date >= period.startDate && date <= period.endDate;
}

/** Четверть, в которую попадает дата урока. null — ни один период не подходит. */
export function quarterForDate(periods: readonly PeriodLike[], date: Date): Quarter | null {
  const match = periods.find((period) => periodContains(period, date));
  return match ? (match.quarter as Quarter) : null;
}

/**
 * Текущая четверть: та, чьи границы включают сегодняшний день.
 * Если сегодня каникулы — ближайшая прошедшая четверть, иначе null.
 */
export function currentQuarter(periods: readonly PeriodLike[], today = new Date()): Quarter | null {
  const exact = quarterForDate(periods, today);
  if (exact) return exact;

  const past = periods
    .filter((period) => period.endDate < today)
    .sort((a, b) => b.endDate.getTime() - a.endDate.getTime());

  return past.length > 0 ? (past[0]!.quarter as Quarter) : null;
}

/** Проверка, что периоды одного года не накладываются друг на друга. */
export function findOverlap(
  periods: readonly PeriodLike[],
  candidate: PeriodLike,
): PeriodLike | null {
  return (
    periods.find(
      (period) =>
        period.quarter !== candidate.quarter &&
        candidate.startDate <= period.endDate &&
        candidate.endDate >= period.startDate,
    ) ?? null
  );
}

import { prisma } from "@/lib/prisma";
import { academicYearOf } from "@/lib/quarters";

/**
 * Активный учебный год — общая для всех настройка, которую задаёт учитель.
 * Хранится в таблице AppSetting: журнал, дневник и отчёты по умолчанию
 * показывают именно этот год.
 */

export const ACTIVE_YEAR_KEY = "activeAcademicYear";

/** «2025» -> «2025/2026». */
export function formatYear(year: number): string {
  return `${year}/${year + 1}`;
}

/** Год из настроек; если не задан — вычисленный по сегодняшней дате. */
export async function getActiveYear(): Promise<number> {
  const setting = await prisma.appSetting.findUnique({ where: { key: ACTIVE_YEAR_KEY } });
  const parsed = Number(setting?.value);
  return Number.isInteger(parsed) ? parsed : academicYearOf();
}

/**
 * Годы, между которыми имеет смысл переключаться: активный, текущий по календарю
 * и все, где уже есть уроки или заведены четверти.
 */
export async function getKnownYears(): Promise<number[]> {
  const [active, lessonYears, periodYears] = await Promise.all([
    getActiveYear(),
    prisma.lesson.findMany({ distinct: ["year"], select: { year: true } }),
    prisma.quarterPeriod.findMany({ distinct: ["year"], select: { year: true } }),
  ]);

  const years = new Set<number>([active, academicYearOf()]);
  for (const row of lessonYears) years.add(row.year);
  for (const row of periodYears) years.add(row.year);

  return [...years].sort((a, b) => b - a);
}

/** Границы четвертей выбранного года, отсортированные по номеру четверти. */
export async function getQuarterPeriods(year: number) {
  return prisma.quarterPeriod.findMany({
    where: { year },
    orderBy: { quarter: "asc" },
    select: { id: true, quarter: true, startDate: true, endDate: true },
  });
}

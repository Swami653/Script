import type { Metadata } from "next";

import { YearManager } from "@/app/(app)/journal/year/year-manager";
import { requirePageRole } from "@/lib/auth-guards";
import { academicYearOf } from "@/lib/quarters";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";
import { getActiveYear, getKnownYears, getQuarterPeriods } from "@/lib/school-year";
import { toDateInputValue } from "@/lib/utils";

export const metadata: Metadata = { title: "Учебный год" };

type SearchParams = Promise<{ year?: string }>;

export default async function YearPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePageRole(GRADE_EDITOR_ROLES);

  const params = await searchParams;
  const [activeYear, knownYears] = await Promise.all([getActiveYear(), getKnownYears()]);

  const requested = Number(params.year);
  const year = Number.isInteger(requested) && requested > 2000 ? requested : activeYear;

  const periods = await getQuarterPeriods(year);

  // Предлагаем на выбор известные годы плюс соседние — чтобы можно было завести следующий.
  const current = academicYearOf();
  const options = [...new Set([...knownYears, current, current + 1, year - 1, year + 1])]
    .filter((item) => item >= current - 5 && item <= current + 5)
    .sort((a, b) => b - a);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-tight">
          Учебный год и четверти
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Даты четвертей определяют, какая четверть идёт сейчас и в какую попадёт новый
          урок. Активный год видят все — и учитель в журнале, и ученики в дневниках.
        </p>
      </header>

      <YearManager
        year={year}
        activeYear={activeYear}
        yearOptions={options}
        periods={periods.map((period) => ({
          quarter: period.quarter,
          startDate: toDateInputValue(period.startDate),
          endDate: toDateInputValue(period.endDate),
        }))}
      />
    </div>
  );
}

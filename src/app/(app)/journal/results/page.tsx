import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ResultsView } from "@/app/(app)/journal/results/results-view";
import { requirePageRole } from "@/lib/auth-guards";
import { isValidQuarter, QUARTER_LABELS, type Quarter } from "@/lib/grades";
import {
  getClassNames,
  getQuarterCloseOverview,
  getQuarterReview,
  getSubjects,
} from "@/lib/queries";
import { currentQuarter, periodContains } from "@/lib/quarters";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";
import { formatYear, getActiveYear, getKnownYears, getQuarterPeriods } from "@/lib/school-year";
import { todayUtcMidnight } from "@/lib/utils";

export const metadata: Metadata = { title: "Итоги четверти" };

type SearchParams = Promise<{
  subject?: string;
  quarter?: string;
  year?: string;
  class?: string;
}>;

/**
 * Мастер «Итоги четверти»: предлагаемые четвертные отметки, спорные средние,
 * неаттестованные, пропущенные контрольные — и закрытие четверти со штампом.
 * «Итоги» существуют и до, и после закрытия, поэтому маршрут — существительное.
 */
export default async function ResultsPage({ searchParams }: { searchParams: SearchParams }) {
  // Серверная проверка роли: ученик сюда не попадёт даже по прямой ссылке.
  const user = await requirePageRole(GRADE_EDITOR_ROLES);

  const params = await searchParams;
  const [subjects, classNames, knownYears, activeYear] = await Promise.all([
    getSubjects(),
    getClassNames(),
    getKnownYears(),
    getActiveYear(),
  ]);

  if (subjects.length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-dashed border-rule-strong bg-card p-10 text-center">
        <ClipboardList className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">Подводить итоги пока нечему</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Сначала добавьте предметы и ведите журнал — итоги четверти появятся здесь.
        </p>
        <Link
          href="/journal/subjects"
          className="focus-ring mt-4 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Управление предметами
        </Link>
      </div>
    );
  }

  const requestedYear = Number(params.year);
  const year = knownYears.includes(requestedYear) ? requestedYear : activeYear;

  const subjectId =
    subjects.find((subject) => subject.id === params.subject)?.id ?? subjects[0]!.id;
  const subjectName = subjects.find((subject) => subject.id === subjectId)!.name;

  const periods = await getQuarterPeriods(year);
  const requestedQuarter = Number(params.quarter);
  const quarter: Quarter = isValidQuarter(requestedQuarter)
    ? (requestedQuarter as Quarter)
    : (currentQuarter(periods) ?? 1);

  const className = params.class && classNames.includes(params.class) ? params.class : null;

  const [review, overview] = await Promise.all([
    getQuarterReview(subjectId, quarter, year, className),
    getQuarterCloseOverview(quarter, year),
  ]);

  // «Эта четверть идёт сейчас» — предупреждение панели закрытия.
  const period = periods.find((item) => item.quarter === quarter);
  const isCurrentQuarter = Boolean(period && periodContains(period, todayUtcMidnight()));

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {formatYear(year)} учебный год
          {year !== activeYear && " · архив"}
        </p>
        <h1 className="mt-1 text-[1.75rem] font-extrabold leading-tight tracking-tight">
          Итоги четверти
          <span className="ml-2 align-middle text-base font-medium text-muted-foreground">
            {subjectName} · {QUARTER_LABELS[quarter]}
            {className ? ` · ${className}` : ""}
          </span>
        </h1>
      </header>

      <ResultsView
        key={`${subjectId}-${quarter}-${year}-${className ?? ""}`}
        subjects={subjects.map((subject) => ({ id: subject.id, name: subject.name }))}
        subjectId={subjectId}
        subjectName={subjectName}
        quarter={quarter}
        years={knownYears}
        year={year}
        classNames={classNames}
        className={className}
        isAdmin={user.role === "ADMIN"}
        isCurrentQuarter={isCurrentQuarter}
        review={{
          locked: review.locked
            ? {
                closedAt: review.locked.closedAt.toISOString(),
                closedByName: review.locked.closedByName,
              }
            : null,
          results: review.results,
          lessonsTotal: review.lessonsTotal,
          lessonsWithoutTopic: review.lessonsWithoutTopic.map((lesson) => ({
            lessonId: lesson.lessonId,
            date: lesson.date.toISOString(),
          })),
          controlCount: review.controlCount,
          trashedCount: review.trashedCount,
          totalStudents: review.totalStudents,
          rows: review.rows.map((row) => ({
            ...row,
            missedControls: row.missedControls.map((control) => ({
              ...control,
              date: control.date.toISOString(),
            })),
          })),
          gradelessRows: review.gradelessRows,
          noteCoverage: review.noteCoverage,
          classAverage: review.classAverage,
          summary: review.summary,
        }}
        overview={overview.map((row) => ({
          ...row,
          locked: row.locked
            ? { closedAt: row.locked.closedAt.toISOString(), closedByName: row.locked.closedByName }
            : null,
        }))}
      />
    </div>
  );
}

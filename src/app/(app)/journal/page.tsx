import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { JournalGrid } from "@/app/(app)/journal/journal-grid";
import { JournalToolbar } from "@/app/(app)/journal/journal-toolbar";
import { requirePageRole } from "@/lib/auth-guards";
import {
  averageColorClasses,
  formatAverage,
  isValidQuarter,
  QUARTER_LABELS,
  type Quarter,
} from "@/lib/grades";
import {
  getClassNames,
  getJournalData,
  getQuartersWithLessons,
  getSubjects,
  getTopicSuggestions,
} from "@/lib/queries";
import { currentQuarter } from "@/lib/quarters";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";
import { formatYear, getActiveYear, getKnownYears, getQuarterPeriods } from "@/lib/school-year";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Журнал класса" };

type SearchParams = Promise<{
  subject?: string;
  quarter?: string;
  class?: string;
  year?: string;
  /** «Кого спросить?»: ask=1 включает подсветку кандидатов на опрос. */
  ask?: string;
}>;

export default async function JournalPage({ searchParams }: { searchParams: SearchParams }) {
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
      <EmptyState
        title="Пока нет ни одного предмета"
        description="Чтобы начать вести журнал, добавьте первый учебный предмет."
      />
    );
  }

  const requestedYear = Number(params.year);
  const year = knownYears.includes(requestedYear) ? requestedYear : activeYear;

  const subjectId =
    subjects.find((subject) => subject.id === params.subject)?.id ?? subjects[0]!.id;
  const subjectName = subjects.find((subject) => subject.id === subjectId)!.name;

  // Темы прошлых уроков предмета — подсказки в форме создания урока.
  const [periods, topicSuggestions] = await Promise.all([
    getQuarterPeriods(year),
    getTopicSuggestions(subjectId),
  ]);

  const requestedQuarter = Number(params.quarter);
  const quarter: Quarter = isValidQuarter(requestedQuarter)
    ? (requestedQuarter as Quarter)
    : await defaultQuarter(subjectId, year, periods);

  const className = params.class && classNames.includes(params.class) ? params.class : null;
  const askMode = params.ask === "1";

  // Границы выбранной четверти — для вкладки «Сетка на четверть» в тулбаре.
  const period = periods.find((item) => item.quarter === quarter);
  const currentPeriod = period
    ? { startDate: period.startDate.toISOString(), endDate: period.endDate.toISOString() }
    : null;

  const data = await getJournalData(subjectId, quarter, year, className);

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {formatYear(year)} учебный год
          {year !== activeYear && " · архив"}
        </p>
        <h1 className="mt-1 text-[1.75rem] font-extrabold leading-tight tracking-tight">
          {subjectName}
          <span className="ml-2 align-middle text-base font-medium text-muted-foreground">
            {QUARTER_LABELS[quarter]}
            {className ? ` · ${className}` : ""}
          </span>
        </h1>
        {/* Итоги строкой, а не рядом одинаковых карточек-метрик */}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>
            <span className="font-semibold tabular-nums text-foreground">{data.rows.length}</span>{" "}
            {pluralize(data.rows.length, "ученик", "ученика", "учеников")}
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="font-semibold tabular-nums text-foreground">
              {data.lessons.length}
            </span>{" "}
            {pluralize(data.lessons.length, "урок", "урока", "уроков")}
          </span>
          <span aria-hidden>·</span>
          <span>
            средний балл класса{" "}
            <span
              className={`font-semibold tabular-nums ${averageColorClasses(data.classAverage)}`}
            >
              {formatAverage(data.classAverage)}
            </span>
          </span>
        </p>
      </header>

      <JournalToolbar
        subjects={subjects.map((subject) => ({ id: subject.id, name: subject.name }))}
        subjectId={subjectId}
        quarter={quarter}
        classNames={classNames}
        className={className}
        years={knownYears}
        year={year}
        hasPeriods={periods.length > 0}
        currentPeriod={currentPeriod}
        askMode={askMode}
        topicSuggestions={topicSuggestions}
        lessons={data.lessons.map((lesson) => ({
          id: lesson.id,
          date: lesson.date.toISOString(),
          topic: lesson.topic,
        }))}
        students={data.rows.map((row) => ({
          id: row.student.id,
          name: row.student.name,
        }))}
      />

      <JournalGrid
        canEdit={GRADE_EDITOR_ROLES.includes(user.role)}
        quarter={quarter}
        subjectName={subjectName}
        askMode={askMode}
        lessons={data.lessons.map((lesson) => ({
          id: lesson.id,
          date: lesson.date.toISOString(),
          topic: lesson.topic,
          homework: lesson.homework,
          plannedKind: lesson.plannedKind,
        }))}
        rows={data.rows.map((row) => ({
          studentId: row.student.id,
          name: row.student.name,
          className: row.student.className,
          cells: Object.fromEntries(
            Object.entries(row.cells).map(([lessonId, grades]) => [
              lessonId,
              grades
                .sort((a, b) => a.slot - b.slot)
                .map((grade) => ({
                  value: grade.value,
                  weight: grade.weight,
                  kind: grade.kind,
                  comment: grade.comment,
                })),
            ]),
          ),
          absentLessons: row.absentLessons,
          quarterAverages: row.quarterAverages,
        }))}
      />
    </div>
  );
}

/**
 * Четверть по умолчанию: та, что идёт сейчас по заданным учителем границам.
 * Если границы не заданы или в четверти нет уроков — последняя четверть с уроками.
 */
async function defaultQuarter(
  subjectId: string,
  year: number,
  periods: { quarter: number; startDate: Date; endDate: Date }[],
): Promise<Quarter> {
  const filled = await getQuartersWithLessons(subjectId, year);
  const byCalendar = currentQuarter(periods);

  if (byCalendar && (filled.length === 0 || filled.includes(byCalendar))) return byCalendar;
  if (filled.length > 0) {
    const last = filled[filled.length - 1]!;
    if (isValidQuarter(last)) return last as Quarter;
  }
  return byCalendar ?? 1;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-dashed border-rule-strong bg-card p-10 text-center">
      <BookOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <Link
        href="/journal/subjects"
        className="focus-ring mt-4 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Управление предметами
      </Link>
    </div>
  );
}

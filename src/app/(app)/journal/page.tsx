import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { JournalGrid } from "@/app/(app)/journal/journal-grid";
import { JournalToolbar } from "@/app/(app)/journal/journal-toolbar";
import { requirePageRole } from "@/lib/auth-guards";
import {
  academicYearLabel,
  averageColorClasses,
  formatAverage,
  guessCurrentQuarter,
  isValidQuarter,
  QUARTER_LABELS,
  type Quarter,
} from "@/lib/grades";
import {
  getClassNames,
  getJournalData,
  getQuartersWithLessons,
  getSubjects,
} from "@/lib/queries";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Журнал класса" };

type SearchParams = Promise<{ subject?: string; quarter?: string; class?: string }>;

export default async function JournalPage({ searchParams }: { searchParams: SearchParams }) {
  // Серверная проверка роли: ученик сюда не попадёт даже по прямой ссылке.
  const user = await requirePageRole(GRADE_EDITOR_ROLES);

  const params = await searchParams;
  const [subjects, classNames] = await Promise.all([getSubjects(), getClassNames()]);

  if (subjects.length === 0) {
    return (
      <EmptyState
        title="Пока нет ни одного предмета"
        description="Чтобы начать вести журнал, добавьте первый учебный предмет."
      />
    );
  }

  const subjectId =
    subjects.find((subject) => subject.id === params.subject)?.id ?? subjects[0]!.id;
  const subjectName = subjects.find((subject) => subject.id === subjectId)!.name;

  const requestedQuarter = Number(params.quarter);
  const quarter: Quarter = isValidQuarter(requestedQuarter)
    ? (requestedQuarter as Quarter)
    : await defaultQuarter(subjectId);

  const className = params.class && classNames.includes(params.class) ? params.class : null;

  const data = await getJournalData(subjectId, quarter, className);

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {academicYearLabel()} учебный год
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
      />

      <JournalGrid
        canEdit={GRADE_EDITOR_ROLES.includes(user.role)}
        quarter={quarter}
        lessons={data.lessons.map((lesson) => ({
          id: lesson.id,
          date: lesson.date.toISOString(),
          topic: lesson.topic,
        }))}
        rows={data.rows.map((row) => ({
          studentId: row.student.id,
          name: row.student.name,
          className: row.student.className,
          cells: row.cells,
          quarterAverages: row.quarterAverages,
        }))}
      />
    </div>
  );
}

/**
 * Четверть по умолчанию: текущая по календарю, а если в ней ещё нет уроков —
 * последняя четверть, в которой уроки есть (иначе учитель видит пустой журнал).
 */
async function defaultQuarter(subjectId: string): Promise<Quarter> {
  const guess = guessCurrentQuarter();
  const filled = await getQuartersWithLessons(subjectId);
  if (filled.length === 0 || filled.includes(guess)) return guess;
  const last = filled[filled.length - 1]!;
  return isValidQuarter(last) ? (last as Quarter) : guess;
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

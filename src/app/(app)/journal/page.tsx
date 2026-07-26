import { BookOpen, TrendingUp, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { JournalGrid } from "@/app/(app)/journal/journal-grid";
import { JournalToolbar } from "@/app/(app)/journal/journal-toolbar";
import { Card, CardContent } from "@/components/ui/card";
import { requirePageRole } from "@/lib/auth-guards";
import {
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
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Журнал класса</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {subjectName} · {QUARTER_LABELS[quarter]}
            {className ? ` · ${className}` : ""}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <StatChip icon={Users} label="Учеников" value={String(data.rows.length)} />
          <StatChip icon={BookOpen} label="Уроков" value={String(data.lessons.length)} />
          <StatChip
            icon={TrendingUp}
            label="Средний класса"
            value={formatAverage(data.classAverage)}
            valueClassName={averageColorClasses(data.classAverage)}
          />
        </div>
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

function StatChip({
  icon: Icon,
  label,
  value,
  valueClassName,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <Card className="min-w-[110px]">
      <CardContent className="flex items-center gap-2.5 p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="leading-tight">
          <span className="block text-[11px] text-muted-foreground">{label}</span>
          <span className={`block text-base font-bold tabular-nums ${valueClassName ?? ""}`}>
            {value}
          </span>
        </span>
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-dashed border-border bg-card p-10 text-center">
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

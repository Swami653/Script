import { BookOpenCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DebtsList } from "@/app/(app)/journal/debts/debts-list";
import { requirePageRole } from "@/lib/auth-guards";
import { getSubjectDebts, getSubjects } from "@/lib/queries";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";
import { formatYear, getActiveYear, getKnownYears } from "@/lib/school-year";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Долги и пересдачи" };

type SearchParams = Promise<{ subject?: string; year?: string }>;

/**
 * Раздел «Долги»: несданные работы по предмету — авто-долги за «Н» на
 * контрольной и ручные пометки. Открытые сверху по давности; пересдача
 * принимается прямо из списка рядом оценок 1–10.
 */
export default async function DebtsPage({ searchParams }: { searchParams: SearchParams }) {
  // Серверная проверка роли: ученик сюда не попадёт даже по прямой ссылке.
  await requirePageRole(GRADE_EDITOR_ROLES);

  const params = await searchParams;
  const [subjects, knownYears, activeYear] = await Promise.all([
    getSubjects(),
    getKnownYears(),
    getActiveYear(),
  ]);

  if (subjects.length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-dashed border-rule-strong bg-card p-10 text-center">
        <BookOpenCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">Долгов пока нет — как и предметов</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Заведите предметы и ведите журнал: долги появятся здесь сами — за «Н» на
          контрольной — или вручную кнопкой «Долг» в клетке журнала.
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

  const debts = await getSubjectDebts(subjectId, year);
  const openCount = debts.filter((debt) => debt.status === "open").length;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {formatYear(year)} учебный год
          {year !== activeYear && " · архив"}
        </p>
        <h1 className="mt-1 text-[1.75rem] font-extrabold leading-tight tracking-tight">
          Долги и пересдачи
          <span className="ml-2 align-middle text-base font-medium text-muted-foreground">
            {subjectName}
          </span>
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {openCount > 0 ? (
            <>
              <span className="font-semibold tabular-nums text-foreground">{openCount}</span>{" "}
              {pluralize(openCount, "открытый долг", "открытых долга", "открытых долгов")}
            </>
          ) : (
            "Открытых долгов нет"
          )}
          {debts.length > openCount && ` · в истории ещё ${debts.length - openCount}`}
        </p>
      </header>

      <DebtsList
        subjects={subjects.map((subject) => ({ id: subject.id, name: subject.name }))}
        subjectId={subjectId}
        years={knownYears}
        year={year}
        debts={debts.map((debt) => ({
          id: debt.id,
          origin: debt.origin,
          note: debt.note,
          student: debt.student,
          lesson: {
            id: debt.lesson.id,
            date: debt.lesson.date.toISOString(),
            topic: debt.lesson.topic,
            quarter: debt.lesson.quarter,
          },
          status: debt.status,
          daysOpen: debt.daysOpen,
          closedGrade: debt.closedGrade,
          clearedAt: debt.clearedAt ? debt.clearedAt.toISOString() : null,
          quarterLocked: debt.quarterLocked,
        }))}
      />
    </div>
  );
}

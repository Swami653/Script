import type { Metadata } from "next";

import { StudentReportView } from "@/components/student-report";
import { requirePageRole } from "@/lib/auth-guards";
import {
  academicYearLabel,
  averageColorClasses,
  displayQuarter,
  formatAverage,
  gradeColorClasses,
} from "@/lib/grades";
import { getRecentGrades, getStudentReport } from "@/lib/queries";
import { cn, formatDateShort } from "@/lib/utils";

export const metadata: Metadata = { title: "Мой дневник" };

export default async function StudentPage() {
  // Только ученик: учитель и администратор будут перенаправлены в свои разделы.
  const user = await requirePageRole(["STUDENT"]);

  const [report, recent] = await Promise.all([
    getStudentReport(user.id, user),
    getRecentGrades(user.id),
  ]);

  if (!report) {
    return (
      <p className="rounded-lg border border-dashed border-rule-strong bg-card p-8 text-center text-sm text-muted-foreground">
        Данные ученика не найдены. Обратитесь к администратору.
      </p>
    );
  }

  // В каникулы текущая четверть пуста — показываем последнюю заполненную.
  const shownQuarter = displayQuarter(report.overallByQuarter);
  const quarterAverage = report.overallByQuarter[shownQuarter - 1] ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {academicYearLabel()} учебный год
          </p>
          <h1 className="mt-1 text-[1.75rem] font-extrabold leading-tight tracking-tight">
            Мой дневник
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {report.student.name}
            {report.student.className ? ` · ${report.student.className}` : ""}
          </p>
        </div>

        {/* Две главные цифры — крупно и без карточек */}
        <dl className="flex items-end gap-8">
          <div>
            <dt className="text-xs text-muted-foreground">
              Средний за {shownQuarter} четверть
            </dt>
            <dd
              className={cn(
                "text-3xl font-extrabold tabular-nums",
                averageColorClasses(quarterAverage),
              )}
            >
              {formatAverage(quarterAverage)}
            </dd>
          </div>
          <div className="border-l border-rule pl-8">
            <dt className="text-xs text-muted-foreground">Средний за год</dt>
            <dd
              className={cn(
                "text-3xl font-extrabold tabular-nums",
                averageColorClasses(report.overallYear),
              )}
            >
              {formatAverage(report.overallYear)}
            </dd>
          </div>
        </dl>
      </header>

      <StudentReportView report={report} />

      <section>
        <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Последние оценки
        </h2>
        {recent.length === 0 ? (
          <p className="rounded-lg border border-dashed border-rule-strong bg-card p-6 text-center text-sm text-muted-foreground">
            Оценок пока нет. Как только учитель поставит первую, она появится здесь.
          </p>
        ) : (
          <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
            {recent.map((grade) => (
              <li key={grade.id} className="flex items-center gap-3 px-3 py-2">
                <span
                  className={cn(
                    "flex h-8 w-9 shrink-0 items-center justify-center rounded text-[15px] font-bold tabular-nums",
                    gradeColorClasses(grade.value),
                  )}
                >
                  {grade.value}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{grade.subject.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatDateShort(grade.lesson.date)} · {grade.quarter} четверть
                    {grade.lesson.topic ? ` · ${grade.lesson.topic}` : ""}
                  </span>
                </span>
                {grade.teacher && (
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {grade.teacher.name}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { HomeworkSection, PlannedAheadSection } from "@/components/agenda";
import { GradeChip } from "@/components/grade-chip";
import { QuarterLegend, QuarterSparkline } from "@/components/sparkline";
import { StudentReportView } from "@/components/student-report";
import { requirePageRole } from "@/lib/auth-guards";
import {
  asGradeKind,
  averageColorClasses,
  displayQuarter,
  formatAverage,
  GRADE_KINDS,
} from "@/lib/grades";
import { getRecentGrades, getStudentAgenda, getStudentReport } from "@/lib/queries";
import { formatYear, getActiveYear } from "@/lib/school-year";
import { cn, formatDateShort, todayUtcMidnight } from "@/lib/utils";

export const metadata: Metadata = { title: "Мой дневник" };

export default async function StudentPage() {
  // Только ученик: учитель и администратор будут перенаправлены в свои разделы.
  const user = await requirePageRole(["STUDENT"]);
  const year = await getActiveYear();

  const [report, recent, agenda] = await Promise.all([
    getStudentReport(user.id, user, year),
    getRecentGrades(user.id, year),
    getStudentAgenda(year),
  ]);
  const today = todayUtcMidnight();

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
            {formatYear(year)} учебный год
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
            <dt className="text-xs text-muted-foreground">Средний за {shownQuarter} четверть</dt>
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

      {/* Планы ближайших двух недель: контрольные и домашние задания */}
      <PlannedAheadSection items={agenda.planned} today={today} />
      <HomeworkSection items={agenda.homework} inUse={agenda.homeworkInUse} today={today} />

      {report.totalGrades > 0 && (
        <section className="rounded-lg border border-rule-strong bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Динамика по четвертям
          </h2>
          <div className="flex flex-col items-center gap-1">
            <QuarterSparkline values={report.overallByQuarter} width={320} height={72} />
            <div className="w-full max-w-[320px]">
              <QuarterLegend values={report.overallByQuarter} />
            </div>
          </div>
        </section>
      )}

      <StudentReportView report={report} subjectHref={(id) => `/student/subject/${id}`} />

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
            {recent.map((grade) => {
              const kind = asGradeKind(grade.kind);
              return (
                /* Чип — вне ссылки: у чипа с комментарием собственный попап,
                   и кнопка внутри ссылки была бы невалидной и конфликтной */
                <li key={grade.id} className="flex items-center gap-3 px-3 py-2 hover:bg-primary/[0.05]">
                  <GradeChip value={grade.value} kind={kind} comment={grade.comment} />
                  <Link
                    href={`/student/subject/${grade.subject.id}`}
                    className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {grade.subject.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatDateShort(grade.lesson.date)} · {grade.quarter} четверть
                        {grade.lesson.topic ? ` · ${grade.lesson.topic}` : ""}
                        {kind !== "regular" ? ` · ${GRADE_KINDS[kind].label}` : ""}
                      </span>
                    </span>
                    {grade.teacher && (
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                        {grade.teacher.name}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

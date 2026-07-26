import type { Metadata } from "next";
import Link from "next/link";

import { GradelessDiary } from "@/app/(app)/student/gradeless-view";
import { HomeworkSection, PlannedAheadSection } from "@/components/agenda";
import { GradeChip } from "@/components/grade-chip";
import { QuarterLegend, QuarterSparkline } from "@/components/sparkline";
import { StampSealMini } from "@/components/stamp-seal";
import { StudentReportView } from "@/components/student-report";
import { requirePageRole } from "@/lib/auth-guards";
import { assessmentOf } from "@/lib/gradeless";
import {
  asGradeKind,
  averageColorClasses,
  displayQuarter,
  formatAverage,
  GRADE_KINDS,
} from "@/lib/grades";
import {
  getRecentGradelessMarks,
  getRecentGrades,
  getStudentAgenda,
  getStudentOpenDebts,
  getStudentReport,
} from "@/lib/queries";
import { formatYear, getActiveYear } from "@/lib/school-year";
import { cn, formatDateShort, pluralize, todayUtcMidnight } from "@/lib/utils";

export const metadata: Metadata = { title: "Мой дневник" };

export default async function StudentPage() {
  // Только ученик: учитель и администратор будут перенаправлены в свои разделы.
  const user = await requirePageRole(["STUDENT"]);
  const year = await getActiveYear();

  /* Безотметочный дневник (1–2 класс) читает ленту уровней и печатей ВМЕСТО
     ленты оценок — обе в одном Promise.all, лишнего round-trip нет. */
  const gradelessStudent = assessmentOf(user.className) === "gradeless";
  const [report, recent, gradelessFeed, agenda, debts] = await Promise.all([
    getStudentReport(user.id, user, year),
    gradelessStudent ? Promise.resolve([]) : getRecentGrades(user.id, year),
    gradelessStudent ? getRecentGradelessMarks(user.id, year) : Promise.resolve([]),
    getStudentAgenda(year),
    getStudentOpenDebts(user.id, user, year),
  ]);
  const today = todayUtcMidnight();

  if (!report) {
    return (
      <p className="rounded-lg border border-dashed border-rule-strong bg-card p-8 text-center text-sm text-muted-foreground">
        Данные ученика не найдены. Обратитесь к администратору.
      </p>
    );
  }

  const gradelessView = report.assessment === "gradeless";
  /* История переживает перевод 2→3: безотметочные секции рендерятся по ДАННЫМ,
     даже когда класс уже оценочный (у 3–4 класса без такой истории их нет). */
  const hasGradelessData =
    report.stampSheet.total > 0 ||
    report.subjects.some(
      (subject) =>
        subject.masteryByQuarter.some(
          (counts) => counts.high + counts.medium + counts.low > 0,
        ) || subject.notes.some((note) => note !== null),
    );

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

        {/* Две главные цифры — крупно и без карточек. У безотметочного (1–2
            класс) средних НЕ СУЩЕСТВУЕТ — его цифры: печати и пропуски */}
        {gradelessView ? (
          <dl className="flex items-end gap-8">
            <div>
              <dt className="text-xs text-muted-foreground">Печатей за год</dt>
              <dd className="flex items-center gap-2 text-3xl font-extrabold tabular-nums text-primary">
                <StampSealMini kind={null} seed={report.student.id} className="h-4 w-4 text-[9px]" />
                {report.stampSheet.total}
              </dd>
            </div>
            <div className="border-l border-rule pl-8">
              <dt className="text-xs text-muted-foreground">Пропусков</dt>
              <dd className="text-3xl font-extrabold tabular-nums">{report.totalAbsences}</dd>
            </div>
          </dl>
        ) : (
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
        )}
      </header>

      {/* Открытые долги: несданные работы, которые ждут пересдачи.
          Нет долгов — нет и блока (стиль полосы — как у временного пароля). */}
      {debts.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="font-semibold">
            За вами {debts.length === 1 ? "долг" : `долги: ${debts.length}`} — работы, которые
            нужно сдать
          </p>
          <ul className="mt-1 space-y-0.5">
            {debts.map((debt) => (
              <li key={debt.id}>
                {debt.subject.name} — урок {formatDateShort(debt.lesson.date)}
                {debt.lesson.topic ? ` («${debt.lesson.topic}»)` : ""}
                {debt.note ? ` — ${debt.note}` : ""}
                {debt.daysOpen > 0 &&
                  ` · висит ${debt.daysOpen} ${pluralize(debt.daysOpen, "день", "дня", "дней")}`}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs opacity-80">
            Подойдите к учителю, чтобы договориться о пересдаче: оценка за неё закроет долг.
          </p>
        </section>
      )}

      {/* Планы ближайших двух недель: контрольные и домашние задания */}
      <PlannedAheadSection items={agenda.planned} today={today} />
      <HomeworkSection items={agenda.homework} inUse={agenda.homeworkInUse} today={today} />

      {gradelessView ? (
        /* Безотметочный дневник 1–2 класса: лист печатей, уровни и
           характеристики — таблица средних и лента оценок не рисуются */
        <GradelessDiary
          stampSheet={report.stampSheet}
          subjects={report.subjects}
          feed={gradelessFeed}
        />
      ) : (
        <>
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

          {/* Переведённый посреди года (2→3): история печатей и уровней
              остаётся видимой рядом с обычной таблицей средних */}
          {hasGradelessData && (
            <GradelessDiary
              stampSheet={report.stampSheet}
              subjects={report.subjects}
              feed={gradelessFeed}
              primary={false}
            />
          )}

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
        </>
      )}
    </div>
  );
}

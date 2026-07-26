import { ArrowLeft, CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requirePageUser } from "@/lib/auth-guards";
import {
  averageColorClasses,
  formatAverage,
  gradeColorClasses,
  GRADE_KINDS,
  QUARTERS,
  QUARTER_LABELS,
} from "@/lib/grades";
import { GradeChip } from "@/components/grade-chip";
import { QuarterSparkline } from "@/components/sparkline";
import { Badge } from "@/components/ui/badge";
import { getStudentSubjectDetail } from "@/lib/queries";
import { formatYear, getActiveYear } from "@/lib/school-year";
import {
  addUtcDays,
  cn,
  formatDateLong,
  formatDateShort,
  formatWeekdayShort,
  pluralize,
  todayUtcMidnight,
} from "@/lib/utils";

export const metadata: Metadata = { title: "Оценки по предмету" };

/**
 * Оценки ученика по одному предмету: когда был урок, какая тема и что получено.
 * Ученик открывает свою страницу, учитель — страницу любого ученика
 * (проверку владельца делает getStudentSubjectDetail).
 */
export default async function StudentSubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const viewer = await requirePageUser();
  const [{ id: subjectId }, query] = await Promise.all([params, searchParams]);

  const studentId = viewer.role === "STUDENT" ? viewer.id : (query.student ?? viewer.id);
  const year = await getActiveYear();

  const detail = await getStudentSubjectDetail(studentId, subjectId, viewer, year);
  if (!detail) notFound();

  const backHref =
    viewer.role === "STUDENT" ? "/student" : `/journal/students/${detail.student.id}`;

  /**
   * «Впереди»: до 5 будущих уроков ближайших двух недель, у которых есть хоть
   * что-то из {тема, домашка, пометка работы}. Голые будущие уроки сетки не
   * показываются нигде — только строка «запланировано ещё N уроков».
   */
  const today = todayUtcMidnight();
  const upcomingHorizon = addUtcDays(today, 15);
  const upcomingShown = detail.upcoming
    .filter(
      (row) =>
        row.date < upcomingHorizon && (row.topic || row.homework || row.plannedKind),
    )
    .slice(0, 5);
  /* Остаток считаем по ТОЙ ЖЕ четверти, что и показанные уроки: иначе подпись
     «до конца четверти» врала бы, складывая будущие уроки всего года. */
  const scopeQuarter = upcomingShown[0]?.quarter;
  const upcomingRest =
    scopeQuarter === undefined
      ? 0
      : detail.upcoming.filter((row) => row.quarter === scopeQuarter).length -
        upcomingShown.length;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href={backHref}
        className="focus-ring inline-flex items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {viewer.role === "STUDENT" ? "К дневнику" : "К карточке ученика"}
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {formatYear(year)} учебный год
          </p>
          <h1 className="mt-1 text-[1.75rem] font-extrabold leading-tight tracking-tight">
            {detail.subject.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {detail.student.name}
            {detail.student.className ? ` · ${detail.student.className}` : ""} · оценок:{" "}
            {detail.totalGrades}
            {detail.totalAbsences > 0 && ` · пропусков: ${detail.totalAbsences}`}
          </p>
        </div>

        <dl className="flex items-end gap-6">
          {QUARTERS.map((quarter) => (
            <div key={quarter} className="text-center">
              <dt className="text-[11px] text-muted-foreground">{quarter} четв.</dt>
              <dd
                className={cn(
                  "text-lg font-bold tabular-nums",
                  averageColorClasses(detail.quarterAverages[quarter - 1] ?? null),
                )}
              >
                {formatAverage(detail.quarterAverages[quarter - 1] ?? null)}
              </dd>
            </div>
          ))}
          <div className="border-l border-rule pl-6 text-center">
            <dt className="text-[11px] text-muted-foreground">Год</dt>
            <dd
              className={cn(
                "inline-flex h-9 w-11 items-center justify-center rounded text-lg font-bold tabular-nums",
                gradeColorClasses(detail.year),
              )}
            >
              {detail.year ?? "—"}
            </dd>
          </div>
        </dl>
      </header>

      {/* Впереди: аннотированные будущие уроки — к чему готовиться */}
      {upcomingShown.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Впереди
          </h2>
          <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
            {upcomingShown.map((row) => (
              <li key={row.lessonId} className="px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatWeekdayShort(row.date)} {formatDateShort(row.date)}
                  </span>
                  {row.plannedKind && (
                    <Badge tone="warning" className="shrink-0">
                      {GRADE_KINDS[row.plannedKind].label}
                    </Badge>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {row.topic ?? <span className="text-muted-foreground">тема не указана</span>}
                  </span>
                </div>
                {/* Страница назначения — домашка полным текстом, без clamp */}
                {row.homework && (
                  <p className="mt-1 pl-[5.75rem] text-xs text-muted-foreground">
                    Задано: {row.homework}
                  </p>
                )}
              </li>
            ))}
            {upcomingRest > 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                запланировано ещё {upcomingRest}{" "}
                {pluralize(upcomingRest, "урок", "урока", "уроков")} до конца четверти
              </li>
            )}
          </ul>
        </section>
      )}

      {detail.totalGrades > 0 && (
        <section className="rounded-lg border border-rule-strong bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Динамика по четвертям
          </h2>
          <QuarterSparkline values={detail.quarterAverages} width={320} height={64} />
        </section>
      )}

      {QUARTERS.map((quarter) => {
        const rows = detail.byQuarter[quarter - 1] ?? [];
        if (rows.length === 0) return null;

        return (
          <section key={quarter}>
            <h2 className="mb-2 flex items-baseline justify-between px-1">
              <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {QUARTER_LABELS[quarter]}
              </span>
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  averageColorClasses(detail.quarterAverages[quarter - 1] ?? null),
                )}
              >
                средний {formatAverage(detail.quarterAverages[quarter - 1] ?? null)}
              </span>
            </h2>

            <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
              {rows.map((row) => (
                <li
                  key={row.lessonId}
                  className={cn(
                    "flex items-start gap-3 px-3 py-2.5",
                    row.grades.length === 0 && "bg-secondary/30",
                  )}
                >
                  <span className="w-28 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                    {formatDateLong(row.date)}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    {row.topic ?? <span className="text-muted-foreground">тема не указана</span>}
                    {/* Домашка видна всегда, даже при «Н»: отсутствовавшему
                        задание особенно нужно */}
                    {row.homework && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Задано: {row.homework}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {/* Тип — один на клетку: у «10/9» он общий для обеих оценок */}
                    {!row.absent &&
                      row.grades.length > 0 &&
                      row.grades[0]!.kind !== "regular" && (
                        <span
                          className="text-[10px] font-semibold uppercase text-muted-foreground"
                          title={GRADE_KINDS[row.grades[0]!.kind].label}
                        >
                          {GRADE_KINDS[row.grades[0]!.kind].short}
                        </span>
                      )}
                    {row.absent ? (
                      <span
                        className="flex h-8 w-9 items-center justify-center rounded bg-slate-200 text-[15px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200"
                        title="Отсутствовал"
                      >
                        Н
                      </span>
                    ) : row.grades.length === 0 ? (
                      <span className="text-xs text-muted-foreground">без оценки</span>
                    ) : (
                      row.grades.map((grade, index) => (
                        <GradeChip
                          key={index}
                          value={grade.value}
                          kind={grade.kind}
                          comment={grade.comment}
                        />
                      ))
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {detail.byQuarter.every((rows) => rows.length === 0) && (
        <div className="rounded-lg border border-dashed border-rule-strong bg-card p-10 text-center">
          <CalendarDays className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">По этому предмету ещё не было уроков</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {/* Уроки уже могут быть заведены наперёд «сеткой на четверть» —
                тогда обещать «как только учитель добавит урок» нельзя: он их
                уже добавил, просто они ещё не прошли. */}
            {detail.upcoming.length > 0
              ? "Уроки уже запланированы — оценки появятся после первого урока."
              : "Как только учитель добавит урок, он появится здесь вместе с темой и оценкой."}
          </p>
        </div>
      )}
    </div>
  );
}

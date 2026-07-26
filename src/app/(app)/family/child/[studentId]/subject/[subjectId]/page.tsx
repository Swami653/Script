import { ArrowLeft, CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AckAllButton, AckButton } from "@/components/ack-button";
import { GradeChip } from "@/components/grade-chip";
import { LevelChip } from "@/components/level-chip";
import { MarkViewed } from "@/components/mark-viewed";
import { QuarterSparkline } from "@/components/sparkline";
import { StampSealMini } from "@/components/stamp-seal";
import { requirePageRole } from "@/lib/auth-guards";
import { notFoundOn404 } from "@/lib/family-guards";
import { formatLevelCounts } from "@/lib/gradeless";
import {
  averageColorClasses,
  formatAverage,
  gradeColorClasses,
  GRADE_KINDS,
  QUARTERS,
  QUARTER_LABELS,
} from "@/lib/grades";
import { getStudentSubjectDetail } from "@/lib/queries";
import { formatYear, getActiveYear } from "@/lib/school-year";
import { cn, formatDateLong } from "@/lib/utils";

export const metadata: Metadata = { title: "Оценки по предмету" };

/**
 * Разбор оценок ребёнка по одному предмету глазами родителя — с кнопками
 * «Ознакомлен». Доступ решает requireOwnChild внутри getStudentSubjectDetail:
 * чужой ребёнок и несуществующий id неотличимы (страница «не найдено»).
 * Блока «Впереди» здесь нет: план уроков не привязан к классам, и родителю
 * младшеклассника он показывал бы чужие контрольные (решение §1 п.15).
 */
export default async function FamilySubjectPage({
  params,
}: {
  params: Promise<{ studentId: string; subjectId: string }>;
}) {
  const parent = await requirePageRole(["PARENT"]);
  const { studentId, subjectId } = await params;
  const year = await getActiveYear();

  const detail = await notFoundOn404(
    getStudentSubjectDetail(studentId, subjectId, parent, year),
  );
  if (!detail) notFound();

  const gradeless = detail.assessment === "gradeless";
  const unackedIds = detail.byQuarter
    .flat()
    .flatMap((row) => row.grades)
    .filter((grade) => !grade.ackedByViewer || grade.ackStale)
    .map((grade) => grade.id)
    .slice(0, 50);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <MarkViewed studentId={detail.student.id} />

      <Link
        href={`/family/child/${detail.student.id}`}
        className="focus-ring inline-flex items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        К дневнику
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
            {detail.student.className ? ` · ${detail.student.className}` : ""}
            {gradeless
              ? ` · печатей: ${detail.totalStamps}`
              : ` · оценок: ${detail.totalGrades}`}
            {detail.totalAbsences > 0 && ` · пропусков: ${detail.totalAbsences}`}
          </p>
        </div>

        {gradeless ? (
          <dl className="flex items-end gap-6">
            {QUARTERS.map((quarter) => {
              const counts = detail.masteryByQuarter[quarter - 1] ?? {
                high: 0,
                medium: 0,
                low: 0,
              };
              const line = formatLevelCounts(counts);
              return (
                <div key={quarter} className="text-center">
                  <dt className="text-[11px] text-muted-foreground">{quarter} четв.</dt>
                  <dd
                    className="text-sm font-bold tabular-nums"
                    title="Уровни: усвоил · усваивает · нужна помощь"
                  >
                    {line || <span className="text-muted-foreground">—</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
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
        )}
      </header>

      {!gradeless && unackedIds.length > 0 && <AckAllButton gradeIds={unackedIds} />}

      {!gradeless && detail.totalGrades > 0 && (
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
        const note = detail.notesByQuarter[quarter - 1] ?? null;
        const levelLine = formatLevelCounts(
          detail.masteryByQuarter[quarter - 1] ?? { high: 0, medium: 0, low: 0 },
        );

        return (
          <section key={quarter}>
            <h2 className="mb-2 flex items-baseline justify-between px-1">
              <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {QUARTER_LABELS[quarter]}
              </span>
              {gradeless ? (
                <span
                  className="text-sm font-semibold tabular-nums"
                  title="Уровни: усвоил · усваивает · нужна помощь"
                >
                  {levelLine || " "}
                </span>
              ) : (
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    averageColorClasses(detail.quarterAverages[quarter - 1] ?? null),
                  )}
                >
                  средний {formatAverage(detail.quarterAverages[quarter - 1] ?? null)}
                </span>
              )}
            </h2>

            {note && (
              <p className="mb-2 rounded-lg border border-rule-strong bg-secondary/40 px-3 py-2 text-sm italic">
                <span className="not-italic text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  От учителя:{" "}
                </span>
                {note}
              </p>
            )}

            <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
              {rows.map((row) => (
                <li
                  key={row.lessonId}
                  className={cn(
                    "flex items-start gap-3 px-3 py-2.5",
                    row.grades.length === 0 &&
                      !row.mastery &&
                      row.stamps.length === 0 &&
                      "bg-secondary/30",
                  )}
                >
                  <span className="w-28 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                    {formatDateLong(row.date)}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    {row.topic ?? <span className="text-muted-foreground">тема не указана</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
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
                    ) : (
                      <>
                        {row.mastery && (
                          <LevelChip level={row.mastery.level} comment={row.mastery.comment} />
                        )}
                        {row.grades.map((grade) => (
                          <GradeChip
                            key={grade.id}
                            value={grade.value}
                            kind={grade.kind}
                            comment={grade.comment}
                            acked={grade.ackedByViewer}
                            ackStale={grade.ackStale}
                          />
                        ))}
                        {row.stamps.length > 0 && (
                          <span className="flex flex-col gap-0.5" title="Печати за урок">
                            {row.stamps.map((kind, index) => (
                              <StampSealMini
                                key={index}
                                kind={kind}
                                seed={`${row.lessonId}-${index}`}
                              />
                            ))}
                          </span>
                        )}
                        {row.grades.length > 0 && (
                          <AckButton
                            gradeIds={row.grades.map((grade) => grade.id)}
                            acked={row.grades.every((grade) => grade.ackedByViewer)}
                            stale={row.grades.some((grade) => grade.ackStale)}
                          />
                        )}
                        {!row.mastery && row.grades.length === 0 && row.stamps.length === 0 && (
                          <span className="text-xs text-muted-foreground">
                            {gradeless ? "без отметки" : "без оценки"}
                          </span>
                        )}
                      </>
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
            {gradeless
              ? "Как только пройдёт первый урок, здесь появятся отметки учителя."
              : "Как только пройдёт первый урок, здесь появятся оценки."}
          </p>
        </div>
      )}
    </div>
  );
}

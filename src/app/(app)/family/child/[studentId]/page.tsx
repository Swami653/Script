import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { GradelessDiary } from "@/app/(app)/student/gradeless-view";
import { AckAllButton, AckButton } from "@/components/ack-button";
import { GradeChip } from "@/components/grade-chip";
import { MarkViewed } from "@/components/mark-viewed";
import { QuarterLegend, QuarterSparkline } from "@/components/sparkline";
import { StudentReportView } from "@/components/student-report";
import { requirePageRole } from "@/lib/auth-guards";
import { notFoundOn404 } from "@/lib/family-guards";
import { asGradeKind, GRADE_KINDS } from "@/lib/grades";
import {
  getRecentGradelessMarks,
  getRecentGrades,
  getStudentReport,
  getUnackedGradeIds,
} from "@/lib/queries";
import { formatYear, getActiveYear } from "@/lib/school-year";
import { formatDateShort } from "@/lib/utils";

export const metadata: Metadata = { title: "Дневник ребёнка" };

/**
 * Дневник ребёнка глазами родителя. Доступ решает requireOwnChild ВНУТРИ
 * функций чтения: чужой и несуществующий id дают одинаковую страницу
 * «не найдено». Агенды и домашних заданий здесь нет намеренно — уроки не
 * привязаны к классам, и родитель первоклассника видел бы контрольные
 * четвёртого класса (решение §1 п.15 спецификации фазы).
 */
export default async function FamilyChildPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const parent = await requirePageRole(["PARENT"]);
  const { studentId } = await params;
  const year = await getActiveYear();

  const report = await notFoundOn404(getStudentReport(studentId, parent, year));
  if (!report) notFound();

  const gradeless = report.assessment === "gradeless";
  const [recent, gradelessFeed, unackedIds] = await Promise.all([
    gradeless ? Promise.resolve([]) : getRecentGrades(studentId, parent, year),
    gradeless ? getRecentGradelessMarks(studentId, parent, year) : Promise.resolve([]),
    gradeless ? Promise.resolve([]) : getUnackedGradeIds(studentId, parent, year),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Отметка визита — ПОСЛЕ рендера дневника, а не на /family */}
      <MarkViewed studentId={report.student.id} />

      <Link
        href="/family"
        className="focus-ring inline-flex items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Ко всем детям
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {formatYear(year)} учебный год
          </p>
          <h1 className="mt-1 text-[1.75rem] font-extrabold leading-tight tracking-tight">
            {report.student.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {report.student.className ?? "класс не указан"}
            {gradeless && " · безотметочное обучение (1–2 класс)"}
          </p>
        </div>
        {!gradeless && <AckAllButton gradeIds={unackedIds} />}
      </header>

      {gradeless ? (
        /* 1–2 класс: печати, уровни и характеристики — на реальных данных */
        <GradelessDiary
          stampSheet={report.stampSheet}
          subjects={report.subjects}
          feed={gradelessFeed}
          subjectHref={(subjectId) =>
            `/family/child/${report.student.id}/subject/${subjectId}`
          }
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

          <StudentReportView
            report={report}
            subjectHref={(subjectId) =>
              `/family/child/${report.student.id}/subject/${subjectId}`
            }
          />

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
                    <li
                      key={grade.id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-primary/[0.05]"
                    >
                      <GradeChip
                        value={grade.value}
                        kind={kind}
                        comment={grade.comment}
                        acked={grade.acked}
                        ackStale={grade.ackStale}
                      />
                      <Link
                        href={`/family/child/${report.student.id}/subject/${grade.subject.id}`}
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
                      </Link>
                      <AckButton
                        gradeIds={[grade.id]}
                        acked={grade.acked}
                        stale={grade.ackStale}
                        className="shrink-0"
                      />
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

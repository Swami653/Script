import {
  averageColorClasses,
  formatAverage,
  gradeColorClasses,
  QUARTERS,
  QUARTER_LABELS,
} from "@/lib/grades";
import type { StudentReport } from "@/lib/queries";
import { cn, formatDateShort } from "@/lib/utils";

/**
 * Сводная ведомость ученика: предметы × 4 четверти + годовая оценка.
 * Используется и учителем (/journal/students/[id]), и учеником (/student).
 */
export function StudentReportView({ report }: { report: StudentReport }) {
  const { subjects, overallByQuarter, overallYear } = report;
  const hasAnyGrade = report.totalGrades > 0;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Успеваемость по предметам
        </h2>

        <div className="journal-scroll overflow-x-auto rounded-lg border border-rule-strong">
          <table className="ledger-paper w-full border-collapse text-sm">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="border-b-2 border-r border-rule-strong px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Предмет
                </th>
                {QUARTERS.map((quarter) => (
                  <th
                    key={quarter}
                    scope="col"
                    className="w-24 border-b-2 border-rule-strong px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {quarter} четв.
                  </th>
                ))}
                <th
                  scope="col"
                  className="w-20 border-b-2 border-l border-rule-strong bg-secondary/40 px-4 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Год
                </th>
              </tr>
            </thead>

            <tbody>
              {subjects.map((subject) => (
                <tr key={subject.subjectId} className="hover:bg-primary/[0.04]">
                  <th
                    scope="row"
                    className="border-b border-r border-rule px-4 py-0 text-left font-medium shadow-[inset_3px_0_0_hsl(var(--spine))]"
                  >
                    <span className="flex h-9 items-center">{subject.subjectName}</span>
                  </th>
                  {QUARTERS.map((quarter) => {
                    const average = subject.quarterAverages[quarter - 1] ?? null;
                    const count = subject.quarterGrades[quarter - 1]?.length ?? 0;
                    return (
                      <td key={quarter} className="border-b border-rule px-3 text-center">
                        <span
                          className={cn(
                            "text-[15px] font-semibold tabular-nums",
                            averageColorClasses(average),
                          )}
                          title={count > 0 ? `Оценок: ${count}` : "Нет оценок"}
                        >
                          {formatAverage(average)}
                        </span>
                      </td>
                    );
                  })}
                  <td className="border-b border-l border-rule-strong bg-secondary/30 px-4 text-center">
                    <span
                      className={cn(
                        "inline-flex h-7 w-9 items-center justify-center rounded text-[15px] font-bold tabular-nums",
                        gradeColorClasses(subject.year),
                      )}
                    >
                      {subject.year ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}

              {subjects.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Предметы пока не заведены.
                  </td>
                </tr>
              )}
            </tbody>

            {subjects.length > 0 && (
              <tfoot>
                <tr className="bg-secondary/50">
                  <th
                    scope="row"
                    className="border-r border-t-2 border-rule-strong px-4 py-2 text-left text-xs font-medium text-muted-foreground"
                  >
                    Средний балл
                  </th>
                  {QUARTERS.map((quarter) => (
                    <td
                      key={quarter}
                      className="border-t-2 border-rule-strong px-3 py-2 text-center text-sm font-semibold tabular-nums"
                    >
                      <span className={averageColorClasses(overallByQuarter[quarter - 1] ?? null)}>
                        {formatAverage(overallByQuarter[quarter - 1] ?? null)}
                      </span>
                    </td>
                  ))}
                  <td className="border-l border-t-2 border-rule-strong px-4 py-2 text-center text-sm font-semibold tabular-nums">
                    <span className={averageColorClasses(overallYear)}>
                      {formatAverage(overallYear)}
                    </span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="mt-1.5 px-1 text-xs text-muted-foreground">
          Средний балл за четверть округляется до сотых, годовая оценка — до целого числа от 1 до 10.
        </p>
      </section>

      {hasAnyGrade && (
        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Все оценки по четвертям
          </h2>
          <div className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
            {subjects
              .filter((subject) => subject.quarterGrades.some((items) => items.length > 0))
              .map((subject) => (
                <details key={subject.subjectId} className="group">
                  <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-accent/40">
                    <span>{subject.subjectName}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      год:
                      <span
                        className={cn(
                          "inline-flex h-6 w-8 items-center justify-center rounded font-bold tabular-nums",
                          gradeColorClasses(subject.year),
                        )}
                      >
                        {subject.year ?? "—"}
                      </span>
                      <span
                        aria-hidden
                        className="transition-transform duration-150 group-open:rotate-180"
                      >
                        ▾
                      </span>
                    </span>
                  </summary>

                  <div className="grid gap-3 border-t border-rule bg-secondary/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
                    {QUARTERS.map((quarter) => {
                      const items = subject.quarterGrades[quarter - 1] ?? [];
                      return (
                        <div key={quarter}>
                          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {QUARTER_LABELS[quarter]}
                          </p>
                          {items.length === 0 ? (
                            <p className="text-xs text-muted-foreground">нет оценок</p>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {items.map((item, index) => (
                                <span
                                  key={`${subject.subjectId}-${quarter}-${index}`}
                                  title={`${formatDateShort(item.date)}${
                                    item.topic ? ` — ${item.topic}` : ""
                                  }`}
                                  className={cn(
                                    "inline-flex h-7 w-7 items-center justify-center rounded text-xs font-bold tabular-nums",
                                    gradeColorClasses(item.value),
                                  )}
                                >
                                  {item.value}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

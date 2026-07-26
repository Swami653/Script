import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
 * Сводная карточка ученика: предметы × 4 четверти + годовая оценка.
 * Используется и учителем (/journal/students/[id]), и учеником (/student).
 */
export function StudentReportView({ report }: { report: StudentReport }) {
  const { subjects, overallByQuarter, overallYear } = report;
  const hasAnyGrade = report.totalGrades > 0;

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border bg-muted/40">
          <CardTitle>Успеваемость по предметам</CardTitle>
          <p className="text-xs text-muted-foreground">
            Средний балл за четверть округляется до сотых, годовая оценка — до целого
            числа от 1 до 10.
          </p>
        </CardHeader>

        <CardContent className="p-0">
          <div className="journal-scroll overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                    Предмет
                  </th>
                  {QUARTERS.map((quarter) => (
                    <th key={quarter} scope="col" className="px-3 py-2.5 text-center font-semibold">
                      {quarter} четв.
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-2.5 text-center font-semibold">
                    Год
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                {subjects.map((subject) => (
                  <tr key={subject.subjectId} className="hover:bg-accent/30">
                    <th scope="row" className="px-4 py-2.5 text-left font-medium">
                      {subject.subjectName}
                    </th>
                    {QUARTERS.map((quarter) => {
                      const average = subject.quarterAverages[quarter - 1] ?? null;
                      const count = subject.quarterGrades[quarter - 1]?.length ?? 0;
                      return (
                        <td key={quarter} className="px-3 py-2.5 text-center">
                          <span
                            className={cn(
                              "font-semibold tabular-nums",
                              averageColorClasses(average),
                            )}
                            title={count > 0 ? `Оценок: ${count}` : "Нет оценок"}
                          >
                            {formatAverage(average)}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={cn(
                          "inline-flex h-8 w-10 items-center justify-center rounded-md text-sm font-bold tabular-nums",
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
                  <tr className="bg-muted/50 font-semibold">
                    <th scope="row" className="px-4 py-2.5 text-left">
                      Средний балл
                    </th>
                    {QUARTERS.map((quarter) => (
                      <td key={quarter} className="px-3 py-2.5 text-center tabular-nums">
                        <span className={averageColorClasses(overallByQuarter[quarter - 1] ?? null)}>
                          {formatAverage(overallByQuarter[quarter - 1] ?? null)}
                        </span>
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-center tabular-nums">
                      <span className={averageColorClasses(overallYear)}>
                        {formatAverage(overallYear)}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {hasAnyGrade && (
        <Card>
          <CardHeader>
            <CardTitle>Все оценки по четвертям</CardTitle>
            <p className="text-xs text-muted-foreground">
              Нажмите на предмет, чтобы раскрыть список оценок с датами уроков.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {subjects
              .filter((subject) => subject.quarterGrades.some((items) => items.length > 0))
              .map((subject) => (
                <details
                  key={subject.subjectId}
                  className="group rounded-lg border border-border bg-background/60 p-3"
                >
                  <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-3 rounded text-sm font-medium">
                    <span>{subject.subjectName}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      год:
                      <span
                        className={cn(
                          "inline-flex h-6 w-8 items-center justify-center rounded font-bold",
                          gradeColorClasses(subject.year),
                        )}
                      >
                        {subject.year ?? "—"}
                      </span>
                      <span className="transition-transform group-open:rotate-180">▾</span>
                    </span>
                  </summary>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {QUARTERS.map((quarter) => {
                      const items = subject.quarterGrades[quarter - 1] ?? [];
                      return (
                        <div key={quarter} className="rounded-md border border-border p-2">
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}

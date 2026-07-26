import { CalendarDays, Sparkles } from "lucide-react";
import type { Metadata } from "next";

import { StudentReportView } from "@/components/student-report";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageRole } from "@/lib/auth-guards";
import { formatAverage, gradeColorClasses, guessCurrentQuarter } from "@/lib/grades";
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
      <p className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Данные ученика не найдены. Обратитесь к администратору.
      </p>
    );
  }

  const currentQuarter = guessCurrentQuarter();
  const currentAverage = report.overallByQuarter[currentQuarter - 1] ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Мой дневник</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {report.student.name}
            {report.student.className ? ` · ${report.student.className}` : ""}
          </p>
        </div>

        <div className="flex gap-3">
          <Card>
            <CardContent className="flex items-center gap-3 p-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <CalendarDays className="h-4 w-4" aria-hidden />
              </span>
              <span className="leading-tight">
                <span className="block text-[11px] text-muted-foreground">
                  Средний за {currentQuarter} четверть
                </span>
                <span className="block text-lg font-bold tabular-nums">
                  {formatAverage(currentAverage)}
                </span>
              </span>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-3 p-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
              <span className="leading-tight">
                <span className="block text-[11px] text-muted-foreground">Средний за год</span>
                <span className="block text-lg font-bold tabular-nums">
                  {formatAverage(report.overallYear)}
                </span>
              </span>
            </CardContent>
          </Card>
        </div>
      </header>

      <StudentReportView report={report} />

      <Card>
        <CardHeader>
          <CardTitle>Последние оценки</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Оценок пока нет.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((grade) => (
                <li key={grade.id} className="flex items-center gap-3 py-2">
                  <span
                    className={cn(
                      "flex h-8 w-9 shrink-0 items-center justify-center rounded-md text-sm font-bold tabular-nums",
                      gradeColorClasses(grade.value),
                    )}
                  >
                    {grade.value}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {grade.subject.name}
                    </span>
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
        </CardContent>
      </Card>
    </div>
  );
}

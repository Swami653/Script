import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StudentReportView } from "@/components/student-report";
import { requirePageRole } from "@/lib/auth-guards";
import { getStudentReport } from "@/lib/queries";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";
import { initials } from "@/lib/utils";

export const metadata: Metadata = { title: "Карточка ученика" };

export default async function StudentCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePageRole(GRADE_EDITOR_ROLES);
  const { id } = await params;

  const report = await getStudentReport(id, user);
  if (!report) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link
        href="/journal/students"
        className="focus-ring inline-flex items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Ко всем ученикам
      </Link>

      <header className="flex flex-wrap items-center gap-4 rounded-lg border border-rule-strong bg-card p-5">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
          {initials(report.student.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight">{report.student.name}</h1>
          <p className="text-sm text-muted-foreground">
            {report.student.email}
            {report.student.className ? ` · ${report.student.className}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Всего оценок</p>
          <p className="text-2xl font-bold tabular-nums">{report.totalGrades}</p>
        </div>
      </header>

      <StudentReportView report={report} />
    </div>
  );
}

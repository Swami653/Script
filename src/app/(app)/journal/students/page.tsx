import type { Metadata } from "next";

import { StudentsList } from "@/app/(app)/journal/students/students-list";
import { requirePageRole } from "@/lib/auth-guards";
import { getStudents } from "@/lib/queries";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";

export const metadata: Metadata = { title: "Ученики" };

export default async function StudentsPage() {
  await requirePageRole(GRADE_EDITOR_ROLES);
  const students = await getStudents();

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Ученики</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Откройте карточку ученика, чтобы увидеть оценки сразу по всем предметам.
        </p>
      </header>

      <StudentsList students={students} />
    </div>
  );
}

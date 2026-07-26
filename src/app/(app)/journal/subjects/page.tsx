import type { Metadata } from "next";

import { SubjectsManager } from "@/app/(app)/journal/subjects/subjects-manager";
import { requirePageRole } from "@/lib/auth-guards";
import { getSubjects } from "@/lib/queries";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";

export const metadata: Metadata = { title: "Предметы" };

export default async function SubjectsPage() {
  await requirePageRole(GRADE_EDITOR_ROLES);
  const subjects = await getSubjects();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Учебные предметы</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Добавляйте новые предметы и удаляйте неактуальные. Удаление предмета удаляет
          все его уроки и оценки — действие необратимо.
        </p>
      </header>

      <SubjectsManager
        subjects={subjects.map((subject) => ({
          id: subject.id,
          name: subject.name,
          lessons: subject._count.lessons,
          grades: subject._count.grades,
        }))}
      />
    </div>
  );
}

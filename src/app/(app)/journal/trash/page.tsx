import type { Metadata } from "next";

import { TrashList } from "@/app/(app)/journal/trash/trash-list";
import { requirePageRole } from "@/lib/auth-guards";
import { getTrashedLessons } from "@/lib/queries";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Корзина уроков" };

export default async function TrashPage() {
  // Серверная проверка роли: ученик сюда не попадёт даже по прямой ссылке.
  await requirePageRole(GRADE_EDITOR_ROLES);
  const lessons = await getTrashedLessons();

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Корзина уроков</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Удалённый урок хранится здесь вместе со своими оценками и отметками «Н».
          Его можно восстановить — всё вернётся в журнал — или удалить навсегда.
        </p>
        {lessons.length > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            В корзине{" "}
            <span className="font-semibold tabular-nums text-foreground">{lessons.length}</span>{" "}
            {pluralize(lessons.length, "урок", "урока", "уроков")}
          </p>
        )}
      </header>

      <TrashList
        lessons={lessons.map((lesson) => ({
          id: lesson.id,
          date: lesson.date.toISOString(),
          quarter: lesson.quarter,
          year: lesson.year,
          topic: lesson.topic,
          deletedAt: lesson.deletedAt?.toISOString() ?? "",
          subjectName: lesson.subject.name,
          grades: lesson._count.grades,
          absences: lesson._count.absences,
        }))}
      />
    </div>
  );
}

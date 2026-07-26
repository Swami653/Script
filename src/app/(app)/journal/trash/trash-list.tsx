"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Flash, useFlash } from "@/components/flash";
import { Button } from "@/components/ui/button";
import { destroyLessonAction, restoreLessonAction } from "@/lib/actions/lessons";
import { formatDateLong, pluralize } from "@/lib/utils";

type TrashedLesson = {
  id: string;
  date: string;
  quarter: number;
  year: number;
  topic: string | null;
  deletedAt: string;
  subjectName: string;
  grades: number;
  absences: number;
};

/** Список удалённых уроков: восстановить или удалить навсегда. */
export function TrashList({ lessons }: { lessons: TrashedLesson[] }) {
  const router = useRouter();
  const { flash, show, clear } = useFlash();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function restore(lesson: TrashedLesson) {
    setPendingId(lesson.id);
    startTransition(async () => {
      const result = await restoreLessonAction({ lessonId: lesson.id });
      setPendingId(null);
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      show("success", result.message ?? "Урок восстановлен");
      router.refresh();
    });
  }

  function destroy(lesson: TrashedLesson) {
    const warning =
      lesson.grades > 0 || lesson.absences > 0
        ? `Удалить урок «${lesson.subjectName}» от ${formatDateLong(lesson.date)} НАВСЕГДА? ` +
          `Вместе с ним безвозвратно исчезнут ${lesson.grades} ` +
          `${pluralize(lesson.grades, "оценка", "оценки", "оценок")} и ` +
          `${lesson.absences} ${pluralize(lesson.absences, "отметка", "отметки", "отметок")} «Н».`
        : `Удалить урок «${lesson.subjectName}» от ${formatDateLong(lesson.date)} навсегда?`;
    if (!window.confirm(warning)) return;

    setPendingId(lesson.id);
    startTransition(async () => {
      const result = await destroyLessonAction({ lessonId: lesson.id });
      setPendingId(null);
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      show("success", result.message ?? "Урок удалён навсегда");
      router.refresh();
    });
  }

  if (lessons.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-rule-strong bg-card p-8 text-center text-sm text-muted-foreground">
        Корзина пуста. Урок попадает сюда после удаления из журнала — и его
        всегда можно вернуть, пока он не удалён навсегда.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
        {lessons.map((lesson) => (
          <li
            key={lesson.id}
            className="group/row flex flex-wrap items-center gap-x-3 gap-y-2 p-3 hover:bg-primary/[0.04]"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {lesson.subjectName} · {formatDateLong(lesson.date)}
                {lesson.topic ? (
                  <span className="font-normal text-muted-foreground"> — {lesson.topic}</span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {lesson.quarter} четверть {lesson.year}/{lesson.year + 1} · оценок:{" "}
                <span className="tabular-nums">{lesson.grades}</span> · отметок «Н»:{" "}
                <span className="tabular-nums">{lesson.absences}</span> · удалён{" "}
                {formatDateLong(lesson.deletedAt)}
              </p>
            </div>

            <Button
              size="sm"
              variant="outline"
              loading={pendingId === lesson.id}
              onClick={() => restore(lesson)}
              title="Вернуть урок в журнал вместе с оценками"
            >
              {pendingId !== lesson.id && <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
              Восстановить
            </Button>
            <Button
              size="icon"
              variant="ghost"
              disabled={pendingId === lesson.id}
              title="Удалить навсегда — вместе с оценками и «Н»"
              className="text-muted-foreground opacity-60 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover/row:opacity-100"
              onClick={() => destroy(lesson)}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>

      <Flash message={flash} onClose={clear} />
    </>
  );
}

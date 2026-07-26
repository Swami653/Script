"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import type { BulkLesson } from "@/app/(app)/journal/bulk-grade-panel";
import { Button } from "@/components/ui/button";
import { FieldHint, Label } from "@/components/ui/field";
import { createLessonGridAction } from "@/lib/actions/lessons";
import { MAX_GRID_LESSONS } from "@/lib/quarters";
import { addUtcDays, cn, formatDateShort, pluralize, WEEKDAYS_SHORT } from "@/lib/utils";

/** Дни недели сетки: 1..6 (пн..сб), численно равны getUTCDay(); воскресенья нет. */
const GRID_WEEKDAYS = [1, 2, 3, 4, 5, 6] as const;

/**
 * Вкладка «Сетка на четверть»: выбрать дни недели — и создать уроки на всю
 * четверть вперёд одним действием. Предпросмотр приблизительный («≈»):
 * он вычитает из дат-кандидатов уроки текущего журнала, но не видит корзину —
 * точные счётчики пропусков вернёт сервер.
 */
export function LessonGridForm({
  subjectId,
  year,
  quarter,
  currentPeriod,
  lessons,
  onDone,
  onError,
}: {
  subjectId: string;
  year: number;
  quarter: number;
  /** Границы выбранной четверти (ISO-даты) или null — период не задан. */
  currentPeriod: { startDate: string; endDate: string } | null;
  /** Уроки выбранной четверти — вычитаются из предпросмотра. */
  lessons: BulkLesson[];
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [weekdays, setWeekdays] = useState<ReadonlySet<number>>(new Set());

  const preview = useMemo(() => {
    if (!currentPeriod || weekdays.size === 0) {
      return { candidates: 0, fresh: 0 };
    }
    const start = new Date(currentPeriod.startDate);
    const end = new Date(currentPeriod.endDate);
    const existing = new Set(lessons.map((lesson) => new Date(lesson.date).getTime()));
    let candidates = 0;
    let fresh = 0;
    // Стоп сразу за предохранителем: дальше считать незачем, форма откажет.
    for (let date = start; date <= end && candidates <= MAX_GRID_LESSONS; date = addUtcDays(date, 1)) {
      if (!weekdays.has(date.getUTCDay())) continue;
      candidates += 1;
      if (!existing.has(date.getTime())) fresh += 1;
    }
    return { candidates, fresh };
  }, [currentPeriod, weekdays, lessons]);

  if (!currentPeriod) {
    return (
      <p className="text-sm text-muted-foreground">
        Границы {quarter} четверти на {year}/{year + 1} не заданы — сетке не из чего строиться.{" "}
        <Link href="/journal/year" className="font-medium text-primary underline">
          Задать даты четвертей
        </Link>
      </p>
    );
  }

  const overLimit = preview.candidates > MAX_GRID_LESSONS;

  function toggleWeekday(day: number) {
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function submit() {
    startTransition(async () => {
      const result = await createLessonGridAction({
        subjectId,
        year,
        quarter,
        weekdays: [...weekdays].sort((a, b) => a - b),
      });
      if (!result.ok) {
        onError(`${result.status}: ${result.error}`);
        return;
      }
      const skippedParts: string[] = [];
      if (result.data.skippedExisting > 0)
        skippedParts.push(`${result.data.skippedExisting} уже есть`);
      if (result.data.skippedTrashed > 0)
        skippedParts.push(`${result.data.skippedTrashed} в корзине`);
      onDone(
        `${result.message ?? "Уроки созданы"}${
          skippedParts.length > 0 ? ` (пропущено: ${skippedParts.join(", ")})` : ""
        }`,
      );
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Дни недели, по которым идёт предмет</Label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Дни недели">
          {GRID_WEEKDAYS.map((day) => (
            <button
              key={day}
              type="button"
              aria-pressed={weekdays.has(day)}
              onClick={() => toggleWeekday(day)}
              className={cn(
                "focus-ring h-9 min-w-[3rem] rounded-md px-2 text-sm font-medium capitalize transition-colors",
                weekdays.has(day)
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground",
              )}
            >
              {WEEKDAYS_SHORT[day]}
            </button>
          ))}
        </div>
      </div>

      {/* Живой предпросмотр: сколько уроков появится и в каких границах */}
      {weekdays.size > 0 &&
        (overLimit ? (
          <p className="text-xs font-medium text-destructive" role="alert">
            {/* Предпросмотр останавливает счёт сразу за пределом — отсюда «+» */}
            Слишком много дат ({preview.candidates}+) — проверьте границы четверти в разделе
            «Учебный год» или сузьте дни недели.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            будет создано ≈
            <span className="font-semibold tabular-nums text-foreground">{preview.fresh}</span>{" "}
            {pluralize(preview.fresh, "урок", "урока", "уроков")} с{" "}
            {formatDateShort(currentPeriod.startDate)} по {formatDateShort(currentPeriod.endDate)}
            {preview.candidates > preview.fresh &&
              ` (${preview.candidates - preview.fresh} ${pluralize(
                preview.candidates - preview.fresh,
                "дата занята",
                "даты заняты",
                "дат занято",
              )})`}
          </p>
        ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} loading={pending} disabled={weekdays.size === 0 || overLimit}>
          Создать сетку уроков
        </Button>
        <FieldHint className="flex-1 basis-64">
          Уроки появятся на все выбранные дни недели в границах четверти. Даты, где урок уже
          есть (в том числе в корзине), пропускаются — ничего не перезаписывается.
        </FieldHint>
      </div>
    </div>
  );
}

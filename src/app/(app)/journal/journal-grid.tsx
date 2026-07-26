"use client";

import { Eraser, ExternalLink, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { Flash, useFlash } from "@/components/flash";
import { Button } from "@/components/ui/button";
import { deleteGradeAction, setGradeAction } from "@/lib/actions/grades";
import { deleteLessonAction } from "@/lib/actions/lessons";
import {
  averageColorClasses,
  averageGrade,
  formatAverage,
  gradeColorClasses,
  MAX_GRADE,
  MIN_GRADE,
  yearGrade,
  type Quarter,
} from "@/lib/grades";
import { cn, formatDateLong, formatDateShort } from "@/lib/utils";

export type GridLesson = {
  id: string;
  date: string;
  topic: string | null;
};

export type GridRow = {
  studentId: string;
  name: string;
  className: string | null;
  cells: Record<string, { id: string; value: number }>;
  quarterAverages: (number | null)[];
};

type CellKey = `${string}|${string}`;

const GRADE_BUTTONS = Array.from({ length: MAX_GRADE }, (_, index) => index + MIN_GRADE);

function cellKey(studentId: string, lessonId: string): CellKey {
  return `${studentId}|${lessonId}`;
}

/**
 * Журнал: строки — ученики, столбцы — уроки.
 *
 * Управление с клавиатуры:
 *   ← → ↑ ↓  — перемещение по ячейкам
 *   1…9      — выставить оценку, 0 — выставить 10 (или наберите «10»)
 *   Enter    — открыть выбор оценки мышью
 *   Delete / Backspace — удалить оценку
 *
 * Значение в ячейке обновляется оптимистично; при ошибке сервера
 * (например, 403 для ученика) изменение откатывается и показывается уведомление.
 */
export function JournalGrid({
  lessons,
  rows,
  quarter,
  canEdit,
}: {
  lessons: GridLesson[];
  rows: GridRow[];
  quarter: Quarter;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { flash, show, clear } = useFlash();
  const [, startTransition] = useTransition();

  /** Оптимистичные значения поверх серверных данных. */
  const [overrides, setOverrides] = useState<Record<string, number | null>>({});
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [picker, setPicker] = useState<{ row: number; col: number; x: number; y: number } | null>(
    null,
  );
  const pendingOne = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Свежие данные с сервера отменяют оптимистичные значения.
  useEffect(() => {
    setOverrides({});
  }, [rows, lessons]);

  useEffect(() => () => void (pendingOne.current && clearTimeout(pendingOne.current)), []);

  const valueAt = useCallback(
    (rowIndex: number, colIndex: number): number | null => {
      const row = rows[rowIndex];
      const lesson = lessons[colIndex];
      if (!row || !lesson) return null;
      const key = cellKey(row.studentId, lesson.id);
      if (key in overrides) return overrides[key] ?? null;
      return row.cells[lesson.id]?.value ?? null;
    },
    [lessons, overrides, rows],
  );

  /** Средний балл строки за выбранную четверть с учётом несохранённых изменений. */
  const rowStats = useMemo(
    () =>
      rows.map((row, rowIndex) => {
        const values: number[] = [];
        for (let colIndex = 0; colIndex < lessons.length; colIndex += 1) {
          const value = valueAt(rowIndex, colIndex);
          if (value !== null) values.push(value);
        }
        const average = averageGrade(values);
        const quarterAverages = row.quarterAverages.map((item, index) =>
          index === quarter - 1 ? average : item,
        );
        return { average, year: yearGrade(quarterAverages) };
      }),
    [lessons.length, quarter, rows, valueAt],
  );

  const classAverage = useMemo(
    () => averageGrade(rowStats.map((s) => s.average).filter((v): v is number => v !== null)),
    [rowStats],
  );

  const focusCell = useCallback((rowIndex: number, colIndex: number) => {
    const node = gridRef.current?.querySelector<HTMLButtonElement>(
      `[data-cell="${rowIndex}-${colIndex}"]`,
    );
    node?.focus();
  }, []);

  const commitGrade = useCallback(
    (rowIndex: number, colIndex: number, value: number) => {
      const row = rows[rowIndex];
      const lesson = lessons[colIndex];
      if (!row || !lesson) return;

      const key = cellKey(row.studentId, lesson.id);
      const previous = row.cells[lesson.id]?.value ?? null;
      setOverrides((prev) => ({ ...prev, [key]: value }));

      startTransition(async () => {
        const result = await setGradeAction({
          studentId: row.studentId,
          lessonId: lesson.id,
          value,
        });

        if (!result.ok) {
          setOverrides((prev) => ({ ...prev, [key]: previous }));
          show("error", `${result.status}: ${result.error}`);
          return;
        }
        router.refresh();
      });
    },
    [lessons, router, rows, show],
  );

  const removeGrade = useCallback(
    (rowIndex: number, colIndex: number) => {
      const row = rows[rowIndex];
      const lesson = lessons[colIndex];
      if (!row || !lesson) return;

      const key = cellKey(row.studentId, lesson.id);
      const previous = row.cells[lesson.id]?.value ?? null;
      if (previous === null && !(key in overrides)) return;

      setOverrides((prev) => ({ ...prev, [key]: null }));

      startTransition(async () => {
        const result = await deleteGradeAction({
          studentId: row.studentId,
          lessonId: lesson.id,
        });
        if (!result.ok) {
          setOverrides((prev) => ({ ...prev, [key]: previous }));
          show("error", `${result.status}: ${result.error}`);
          return;
        }
        router.refresh();
      });
    },
    [lessons, overrides, router, rows, show],
  );

  /** Переход к следующему ученику — как в Excel, чтобы быстро заполнять столбец. */
  const advanceDown = useCallback(
    (rowIndex: number, colIndex: number) => {
      const next = Math.min(rowIndex + 1, rows.length - 1);
      if (next !== rowIndex) {
        setSelected({ row: next, col: colIndex });
        focusCell(next, colIndex);
      }
    },
    [focusCell, rows.length],
  );

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, row: number, col: number) {
    const { key } = event;

    const move = (nextRow: number, nextCol: number) => {
      event.preventDefault();
      const r = Math.max(0, Math.min(nextRow, rows.length - 1));
      const c = Math.max(0, Math.min(nextCol, lessons.length - 1));
      setSelected({ row: r, col: c });
      setPicker(null);
      focusCell(r, c);
    };

    if (key === "ArrowRight") return move(row, col + 1);
    if (key === "ArrowLeft") return move(row, col - 1);
    if (key === "ArrowDown") return move(row + 1, col);
    if (key === "ArrowUp") return move(row - 1, col);
    if (key === "Home") return move(row, 0);
    if (key === "End") return move(row, lessons.length - 1);

    if (key === "Escape") {
      setPicker(null);
      return;
    }

    if (!canEdit) return;

    if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      removeGrade(row, col);
      return;
    }

    // «0» = 10; «1» ждёт возможного «0», чтобы набор «10» работал естественно.
    if (key === "0") {
      event.preventDefault();
      if (pendingOne.current) {
        clearTimeout(pendingOne.current);
        pendingOne.current = null;
      }
      commitGrade(row, col, 10);
      advanceDown(row, col);
      return;
    }

    if (/^[1-9]$/.test(key)) {
      event.preventDefault();
      const value = Number(key);

      if (value === 1) {
        setOverrides((prev) => ({
          ...prev,
          [cellKey(rows[row]!.studentId, lessons[col]!.id)]: 1,
        }));
        if (pendingOne.current) clearTimeout(pendingOne.current);
        pendingOne.current = setTimeout(() => {
          pendingOne.current = null;
          commitGrade(row, col, 1);
          advanceDown(row, col);
        }, 450);
        return;
      }

      commitGrade(row, col, value);
      advanceDown(row, col);
    }
  }

  function openPicker(event: React.MouseEvent<HTMLButtonElement>, row: number, col: number) {
    if (!canEdit) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setSelected({ row, col });
    setPicker({ row, col, x: rect.left + rect.width / 2, y: rect.bottom + 6 });
  }

  const activeCell = selected ?? { row: 0, col: 0 };

  if (lessons.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <p className="text-sm font-medium">В этой четверти ещё нет уроков</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Добавьте урок кнопкой «Добавить урок» — он станет новым столбцом журнала.
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <Users className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">Нет учеников</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Добавьте учеников в панели администратора — там есть массовый импорт списком.
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        ref={gridRef}
        className="journal-scroll overflow-x-auto rounded-xl border border-border bg-card shadow-sm"
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/60">
              <th
                scope="col"
                className="sticky left-0 z-20 min-w-[220px] border-b border-r border-border bg-muted/95 px-3 py-2 text-left font-semibold backdrop-blur"
              >
                Ученик
              </th>
              {lessons.map((lesson) => (
                <th
                  key={lesson.id}
                  scope="col"
                  className="group border-b border-border px-1 py-2 text-center font-medium"
                  title={`${formatDateLong(lesson.date)}${lesson.topic ? ` — ${lesson.topic}` : ""}`}
                >
                  <div className="flex min-w-[46px] flex-col items-center gap-0.5">
                    <span className="tabular-nums">{formatDateShort(lesson.date)}</span>
                    {lesson.topic && (
                      <span className="max-w-[70px] truncate text-[10px] font-normal text-muted-foreground">
                        {lesson.topic}
                      </span>
                    )}
                    {canEdit && <DeleteLessonButton lessonId={lesson.id} onError={show} />}
                  </div>
                </th>
              ))}
              <th
                scope="col"
                className="border-b border-l border-border bg-muted/60 px-3 py-2 text-center font-semibold"
                title="Средний балл за выбранную четверть"
              >
                Средний
              </th>
              <th
                scope="col"
                className="border-b border-border bg-muted/60 px-3 py-2 text-center font-semibold"
                title="Годовая оценка по предмету (округление среднего по четвертям)"
              >
                Год
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.studentId} className="group/row even:bg-muted/20">
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-1.5 text-left font-normal group-hover/row:bg-accent/40"
                >
                  <Link
                    href={`/journal/students/${row.studentId}`}
                    className="focus-ring flex items-center justify-between gap-2 rounded"
                    title="Открыть карточку ученика — оценки по всем предметам"
                  >
                    <span className="truncate">{row.name}</span>
                    <span className="flex items-center gap-1.5">
                      {row.className && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {row.className}
                        </span>
                      )}
                      <ExternalLink
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100"
                        aria-hidden
                      />
                    </span>
                  </Link>
                </th>

                {lessons.map((lesson, colIndex) => {
                  const value = valueAt(rowIndex, colIndex);
                  const isSelected = selected?.row === rowIndex && selected?.col === colIndex;
                  const isFocusable =
                    activeCell.row === rowIndex && activeCell.col === colIndex ? 0 : -1;

                  return (
                    <td key={lesson.id} className="border-b border-border p-0.5 text-center">
                      <button
                        type="button"
                        data-cell={`${rowIndex}-${colIndex}`}
                        tabIndex={isFocusable}
                        onClick={(event) => openPicker(event, rowIndex, colIndex)}
                        onFocus={() => setSelected({ row: rowIndex, col: colIndex })}
                        onKeyDown={(event) => handleKeyDown(event, rowIndex, colIndex)}
                        aria-label={`${row.name}, ${formatDateShort(lesson.date)}, оценка ${
                          value ?? "не выставлена"
                        }`}
                        className={cn(
                          "mx-auto flex h-8 w-11 items-center justify-center rounded-md text-sm font-semibold tabular-nums transition-all focus:outline-none",
                          value === null
                            ? "text-transparent hover:bg-accent hover:text-muted-foreground"
                            : gradeColorClasses(value),
                          isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-card",
                          canEdit ? "cursor-pointer" : "cursor-default",
                        )}
                      >
                        {value ?? "·"}
                      </button>
                    </td>
                  );
                })}

                <td className="border-b border-l border-border bg-muted/30 px-3 py-1.5 text-center">
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      averageColorClasses(rowStats[rowIndex]?.average ?? null),
                    )}
                  >
                    {formatAverage(rowStats[rowIndex]?.average ?? null)}
                  </span>
                </td>
                <td className="border-b border-border bg-muted/30 px-3 py-1.5 text-center">
                  <span
                    className={cn(
                      "inline-flex h-7 w-9 items-center justify-center rounded-md text-sm font-bold tabular-nums",
                      gradeColorClasses(rowStats[rowIndex]?.year ?? null),
                    )}
                  >
                    {rowStats[rowIndex]?.year ?? "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="bg-muted/50 text-xs">
              <th
                scope="row"
                className="sticky left-0 z-10 border-r border-border bg-muted/95 px-3 py-2 text-left font-medium"
              >
                Средний балл класса
              </th>
              {lessons.map((lesson, colIndex) => {
                const values = rows
                  .map((_, rowIndex) => valueAt(rowIndex, colIndex))
                  .filter((value): value is number => value !== null);
                return (
                  <td key={lesson.id} className="px-1 py-2 text-center tabular-nums">
                    <span className={averageColorClasses(averageGrade(values))}>
                      {formatAverage(averageGrade(values))}
                    </span>
                  </td>
                );
              })}
              <td className="border-l border-border px-3 py-2 text-center font-semibold tabular-nums">
                <span className={averageColorClasses(classAverage)}>
                  {formatAverage(classAverage)}
                </span>
              </td>
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>

      {picker && canEdit && (
        <GradePicker
          x={picker.x}
          y={picker.y}
          current={valueAt(picker.row, picker.col)}
          onPick={(value) => {
            commitGrade(picker.row, picker.col, value);
            setPicker(null);
            focusCell(picker.row, picker.col);
          }}
          onRemove={() => {
            removeGrade(picker.row, picker.col);
            setPicker(null);
            focusCell(picker.row, picker.col);
          }}
          onClose={() => setPicker(null)}
        />
      )}

      <Flash message={flash} onClose={clear} />
    </>
  );
}

function GradePicker({
  x,
  y,
  current,
  onPick,
  onRemove,
  onClose,
}: {
  x: number;
  y: number;
  current: number | null;
  onPick: (value: number) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  if (!mounted) return null;

  const left = Math.min(Math.max(x, 130), window.innerWidth - 130);
  const top = Math.min(y, window.innerHeight - 150);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Выбор оценки"
      className="animate-pop-in fixed z-50 -translate-x-1/2 rounded-xl border border-border bg-card p-2 shadow-xl"
      style={{ left, top }}
    >
      <div className="grid grid-cols-5 gap-1">
        {GRADE_BUTTONS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onPick(value)}
            className={cn(
              "focus-ring h-9 w-9 rounded-md text-sm font-bold tabular-nums transition-transform hover:scale-110",
              gradeColorClasses(value),
              current === value && "ring-2 ring-primary ring-offset-1 ring-offset-card",
            )}
          >
            {value}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={current === null}
        className="focus-ring mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
      >
        <Eraser className="h-3.5 w-3.5" aria-hidden />
        Удалить оценку
      </button>
    </div>,
    document.body,
  );
}

function DeleteLessonButton({
  lessonId,
  onError,
}: {
  lessonId: string;
  onError: (tone: "success" | "error", text: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100"
      title="Удалить урок вместе с оценками"
      loading={pending}
      onClick={() => {
        if (!window.confirm("Удалить этот урок и все оценки за него?")) return;
        startTransition(async () => {
          const result = await deleteLessonAction({ lessonId });
          if (!result.ok) {
            onError("error", `${result.status}: ${result.error}`);
            return;
          }
          router.refresh();
        });
      }}
    >
      {!pending && <Trash2 className="h-3 w-3 text-muted-foreground" aria-hidden />}
    </Button>
  );
}

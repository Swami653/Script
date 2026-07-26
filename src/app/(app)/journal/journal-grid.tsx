"use client";

import { Eraser, ExternalLink, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { Flash, useFlash } from "@/components/flash";
import { Button } from "@/components/ui/button";
import { clearCellAction, deleteGradeAction, setGradeAction } from "@/lib/actions/grades";
import { deleteLessonAction } from "@/lib/actions/lessons";
import {
  averageColorClasses,
  averageGrade,
  formatAverage,
  gradeColorClasses,
  MAX_GRADE,
  MAX_GRADES_PER_LESSON,
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

/**
 * Клетка журнала — массив оценок за один урок: [] пусто, [8] одна,
 * [10, 9] две («10/9» за контрольную).
 */
export type GridRow = {
  studentId: string;
  name: string;
  className: string | null;
  cells: Record<string, number[]>;
  quarterAverages: (number | null)[];
};

const GRADE_BUTTONS = Array.from({ length: MAX_GRADE }, (_, index) => index + MIN_GRADE);

function cellKey(studentId: string, lessonId: string): string {
  return `${studentId}|${lessonId}`;
}

/** «Иванова Мария Петровна» -> «Иванова М. П.» — для узких экранов. */
function shortName(name: string): string {
  const [surname, ...rest] = name.trim().split(/\s+/);
  if (!surname) return name;
  const initials = rest
    .slice(0, 2)
    .map((part) => `${part[0]!.toUpperCase()}.`)
    .join(" ");
  return initials ? `${surname} ${initials}` : surname;
}

/**
 * Журнал класса. Разворот ведомости: строки — ученики, столбцы — уроки,
 * справа за чертой — итоги (средний за четверть и годовая).
 *
 * За один урок можно поставить до двух оценок — «10/9» за контрольную.
 * Это две отдельные целые оценки, каждая идёт в средний балл сама по себе.
 *
 * Клавиатура:
 *   ← → ↑ ↓        — перемещение по клеткам
 *   1…9, 0 = 10    — первая оценка
 *   Shift + цифра  — вторая оценка в той же клетке
 *   Enter          — открыть выбор мышью
 *   Delete         — убрать последнюю оценку клетки (Shift+Delete — очистить клетку)
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

  /** Оптимистичные значения клеток поверх серверных данных. */
  const [overrides, setOverrides] = useState<Record<string, number[]>>({});
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [picker, setPicker] = useState<{ row: number; col: number; x: number; y: number } | null>(
    null,
  );
  /** Клетки, куда оценка «легла» только что — для короткой анимации. */
  const [settled, setSettled] = useState<Record<string, number>>({});
  const pendingOne = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Свежие данные с сервера отменяют оптимистичные значения.
  useEffect(() => {
    setOverrides({});
  }, [rows, lessons]);

  useEffect(() => () => void (pendingOne.current && clearTimeout(pendingOne.current)), []);

  const valuesAt = useCallback(
    (rowIndex: number, colIndex: number): number[] => {
      const row = rows[rowIndex];
      const lesson = lessons[colIndex];
      if (!row || !lesson) return [];
      const key = cellKey(row.studentId, lesson.id);
      if (key in overrides) return overrides[key] ?? [];
      return row.cells[lesson.id] ?? [];
    },
    [lessons, overrides, rows],
  );

  const rowStats = useMemo(
    () =>
      rows.map((row, rowIndex) => {
        const values: number[] = [];
        for (let colIndex = 0; colIndex < lessons.length; colIndex += 1) {
          values.push(...valuesAt(rowIndex, colIndex));
        }
        const average = averageGrade(values);
        const quarterAverages = row.quarterAverages.map((item, index) =>
          index === quarter - 1 ? average : item,
        );
        return { average, year: yearGrade(quarterAverages) };
      }),
    [lessons.length, quarter, rows, valuesAt],
  );

  const classAverage = useMemo(
    () => averageGrade(rowStats.map((s) => s.average).filter((v): v is number => v !== null)),
    [rowStats],
  );

  const focusCell = useCallback((rowIndex: number, colIndex: number) => {
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-cell="${rowIndex}-${colIndex}"]`)
      ?.focus();
  }, []);

  /** Записать оценку в позицию slot. Значения клетки обновляются оптимистично. */
  const commitGrade = useCallback(
    (rowIndex: number, colIndex: number, value: number, slot: number) => {
      const row = rows[rowIndex];
      const lesson = lessons[colIndex];
      if (!row || !lesson) return;
      if (slot >= MAX_GRADES_PER_LESSON) return;

      const key = cellKey(row.studentId, lesson.id);
      const previous = valuesAt(rowIndex, colIndex);
      if (slot > previous.length) {
        show("error", "Сначала поставьте первую оценку за этот урок");
        return;
      }

      const next = [...previous];
      next[slot] = value;

      setOverrides((prev) => ({ ...prev, [key]: next }));
      setSettled((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));

      startTransition(async () => {
        const result = await setGradeAction({
          studentId: row.studentId,
          lessonId: lesson.id,
          value,
          slot,
        });

        if (!result.ok) {
          setOverrides((prev) => ({ ...prev, [key]: previous }));
          show("error", `${result.status}: ${result.error}`);
          return;
        }
        router.refresh();
      });
    },
    [lessons, router, rows, show, valuesAt],
  );

  /** Убрать одну оценку из клетки; оставшаяся сдвигается на её место. */
  const removeGrade = useCallback(
    (rowIndex: number, colIndex: number, slot: number) => {
      const row = rows[rowIndex];
      const lesson = lessons[colIndex];
      if (!row || !lesson) return;

      const key = cellKey(row.studentId, lesson.id);
      const previous = valuesAt(rowIndex, colIndex);
      if (previous.length === 0 || slot >= previous.length) return;

      const next = previous.filter((_, index) => index !== slot);
      setOverrides((prev) => ({ ...prev, [key]: next }));

      startTransition(async () => {
        const result = await deleteGradeAction({
          studentId: row.studentId,
          lessonId: lesson.id,
          slot,
        });
        if (!result.ok) {
          setOverrides((prev) => ({ ...prev, [key]: previous }));
          show("error", `${result.status}: ${result.error}`);
          return;
        }
        router.refresh();
      });
    },
    [lessons, router, rows, show, valuesAt],
  );

  /** Очистить клетку целиком (обе половинки «10/9»). */
  const clearCell = useCallback(
    (rowIndex: number, colIndex: number) => {
      const row = rows[rowIndex];
      const lesson = lessons[colIndex];
      if (!row || !lesson) return;

      const key = cellKey(row.studentId, lesson.id);
      const previous = valuesAt(rowIndex, colIndex);
      if (previous.length === 0) return;

      setOverrides((prev) => ({ ...prev, [key]: [] }));

      startTransition(async () => {
        const result = await clearCellAction({ studentId: row.studentId, lessonId: lesson.id });
        if (!result.ok) {
          setOverrides((prev) => ({ ...prev, [key]: previous }));
          show("error", `${result.status}: ${result.error}`);
          return;
        }
        router.refresh();
      });
    },
    [lessons, router, rows, show, valuesAt],
  );

  /** Как в ведомости: выставил — курсор ушёл к следующему ученику. */
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
    const { key, shiftKey } = event;

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
      const values = valuesAt(row, col);
      if (values.length === 0) return;
      // Shift — очистить клетку целиком, иначе убрать последнюю оценку.
      if (shiftKey) clearCell(row, col);
      else removeGrade(row, col, values.length - 1);
      return;
    }

    // Shift + цифра ставит вторую оценку в ту же клетку.
    const slot = shiftKey ? 1 : 0;

    // «0» = 10; «1» ждёт возможного «0», чтобы набор «10» работал естественно.
    if (key === "0" || (shiftKey && key === ")")) {
      event.preventDefault();
      if (pendingOne.current) {
        clearTimeout(pendingOne.current);
        pendingOne.current = null;
      }
      commitGrade(row, col, 10, slot);
      if (slot === 0) advanceDown(row, col);
      return;
    }

    if (/^[1-9]$/.test(key)) {
      event.preventDefault();
      const value = Number(key);

      if (value === 1) {
        const previous = valuesAt(row, col);
        const optimistic = [...previous];
        optimistic[slot] = 1;
        setOverrides((prev) => ({
          ...prev,
          [cellKey(rows[row]!.studentId, lessons[col]!.id)]: optimistic,
        }));
        if (pendingOne.current) clearTimeout(pendingOne.current);
        pendingOne.current = setTimeout(() => {
          pendingOne.current = null;
          commitGrade(row, col, 1, slot);
          if (slot === 0) advanceDown(row, col);
        }, 450);
        return;
      }

      commitGrade(row, col, value, slot);
      if (slot === 0) advanceDown(row, col);
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
      <EmptyBoard
        title="В этой четверти ещё нет уроков"
        hint="Урок — это столбец журнала. Нажмите «Добавить урок», укажите дату и тему — и можно выставлять оценки."
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyBoard
        icon={Users}
        title="В журнале нет учеников"
        hint="Ученики заводятся в панели администратора. Там есть массовый импорт: вставьте список ФИО — логины и пароли создадутся сами."
      />
    );
  }

  return (
    <>
      {/* ── Разворот ведомости: с планшета и шире ─────────────────────────── */}
      <div
        ref={gridRef}
        className="journal-scroll hidden overflow-x-auto rounded-lg border border-rule-strong shadow-sm md:block"
      >
        <table className="ledger-paper w-auto min-w-full border-collapse text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-20 w-[17rem] min-w-[17rem] border-b-2 border-r border-rule-strong bg-card px-3 py-2 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Ученик
              </th>
              {lessons.map((lesson, index) => (
                <th
                  key={lesson.id}
                  scope="col"
                  className={cn(
                    "group w-[4.25rem] border-b-2 border-rule-strong px-0 py-1.5 align-bottom font-medium",
                    // Смена месяца — единственная вертикальная линия внутри сетки:
                    // она несёт смысл, а не украшает.
                    index > 0 &&
                      new Date(lesson.date).getUTCMonth() !==
                        new Date(lessons[index - 1]!.date).getUTCMonth() &&
                      "border-l border-l-rule-strong",
                  )}
                  title={`${formatDateLong(lesson.date)}${lesson.topic ? ` — ${lesson.topic}` : ""}`}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[13px] tabular-nums">{formatDateShort(lesson.date)}</span>
                    {canEdit && <DeleteLessonButton lessonId={lesson.id} onError={show} />}
                  </div>
                </th>
              ))}
              {/* Незаполненная часть разворота: забирает лишнюю ширину,
                  чтобы столбцы уроков стояли плотно, а не расползались */}
              <th scope="col" aria-hidden className="w-auto border-b-2 border-rule-strong" />
              <th
                scope="col"
                className="w-24 border-b-2 border-l border-rule-strong bg-secondary/40 px-3 py-2 text-center align-bottom text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                title="Средний балл за выбранную четверть"
              >
                Средний
              </th>
              <th
                scope="col"
                className="w-16 border-b-2 border-rule-strong bg-secondary/40 px-2 py-2 text-center align-bottom text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                title="Годовая оценка: среднее по четвертям, округлённое до целого"
              >
                Год
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.studentId} className="group/row hover:bg-primary/[0.04]">
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-r border-rule bg-card px-3 py-0 text-left font-normal shadow-[inset_3px_0_0_hsl(var(--spine))] group-hover/row:bg-accent/50"
                >
                  <Link
                    href={`/journal/students/${row.studentId}`}
                    className="focus-ring flex h-9 items-center justify-between gap-2 rounded"
                    title="Открыть карточку ученика — оценки по всем предметам"
                  >
                    <span className="truncate">{row.name}</span>
                    <ExternalLink
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100"
                      aria-hidden
                    />
                  </Link>
                </th>

                {lessons.map((lesson, colIndex) => {
                  const values = valuesAt(rowIndex, colIndex);
                  const isSelected = selected?.row === rowIndex && selected?.col === colIndex;
                  const key = cellKey(row.studentId, lesson.id);
                  const monthBreak =
                    colIndex > 0 &&
                    new Date(lesson.date).getUTCMonth() !==
                      new Date(lessons[colIndex - 1]!.date).getUTCMonth();

                  return (
                    <td
                      key={lesson.id}
                      className={cn(
                        "border-b border-rule p-0 text-center",
                        monthBreak && "border-l border-l-rule-strong",
                      )}
                    >
                      <button
                        type="button"
                        data-cell={`${rowIndex}-${colIndex}`}
                        tabIndex={
                          activeCell.row === rowIndex && activeCell.col === colIndex ? 0 : -1
                        }
                        onClick={(event) => openPicker(event, rowIndex, colIndex)}
                        onFocus={() => setSelected({ row: rowIndex, col: colIndex })}
                        onKeyDown={(event) => handleKeyDown(event, rowIndex, colIndex)}
                        aria-label={`${row.name}, ${formatDateShort(lesson.date)}, ${
                          values.length > 0
                            ? `оценки ${values.join(" и ")}`
                            : "оценка не выставлена"
                        }`}
                        className={cn(
                          "flex h-9 w-full items-center justify-center transition-colors focus:outline-none",
                          values.length === 0 && "hover:bg-primary/10",
                          isSelected && "ring-2 ring-inset ring-primary",
                          canEdit ? "cursor-pointer" : "cursor-default",
                        )}
                      >
                        <CellGrades values={values} settleKey={settled[key] ?? 0} />
                      </button>
                    </td>
                  );
                })}

                <td className="border-b border-rule" />

                <td className="border-b border-l border-rule-strong bg-secondary/30 px-3 py-1 text-center">
                  <span
                    className={cn(
                      "text-[15px] font-semibold tabular-nums",
                      averageColorClasses(rowStats[rowIndex]?.average ?? null),
                    )}
                  >
                    {formatAverage(rowStats[rowIndex]?.average ?? null)}
                  </span>
                </td>
                <td className="border-b border-rule bg-secondary/30 px-2 py-1 text-center">
                  <span
                    className={cn(
                      "inline-flex h-7 w-9 items-center justify-center rounded text-[15px] font-bold tabular-nums",
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
            <tr className="bg-secondary/50 text-xs">
              <th
                scope="row"
                className="sticky left-0 z-10 border-r border-t-2 border-rule-strong bg-secondary px-3 py-2 text-left font-medium text-muted-foreground"
              >
                Средний балл класса
              </th>
              {lessons.map((lesson, colIndex) => {
                const values = rows.flatMap((_, rowIndex) => valuesAt(rowIndex, colIndex));
                return (
                  <td
                    key={lesson.id}
                    className="border-t-2 border-rule-strong px-0 py-2 text-center tabular-nums"
                  >
                    <span className={averageColorClasses(averageGrade(values))}>
                      {formatAverage(averageGrade(values))}
                    </span>
                  </td>
                );
              })}
              <td className="border-t-2 border-rule-strong" />
              <td className="border-l border-t-2 border-rule-strong px-3 py-2 text-center font-semibold tabular-nums">
                <span className={averageColorClasses(classAverage)}>
                  {formatAverage(classAverage)}
                </span>
              </td>
              <td className="border-t-2 border-rule-strong px-2 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Телефон: «урок за раз» ────────────────────────────────────────── */}
      <MobileLessonBoard
        lessons={lessons}
        rows={rows}
        canEdit={canEdit}
        valuesAt={valuesAt}
        rowStats={rowStats}
        onPick={(rowIndex, colIndex, value, slot) => commitGrade(rowIndex, colIndex, value, slot)}
        onRemove={(rowIndex, colIndex, slot) => removeGrade(rowIndex, colIndex, slot)}
      />

      {picker && canEdit && (
        <GradePicker
          x={picker.x}
          y={picker.y}
          values={valuesAt(picker.row, picker.col)}
          onPick={(value, slot) => {
            commitGrade(picker.row, picker.col, value, slot);
            setPicker(null);
            focusCell(picker.row, picker.col);
          }}
          onRemove={(slot) => {
            removeGrade(picker.row, picker.col, slot);
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

/** Содержимое клетки: пусто, «8» или «10/9». */
function CellGrades({ values, settleKey }: { values: number[]; settleKey: number }) {
  if (values.length === 0) {
    return <span className="text-transparent">·</span>;
  }

  return (
    <span key={settleKey} className="animate-ink-settle flex items-center">
      {values.map((value, index) => (
        <span key={index} className="flex items-center">
          {index > 0 && <span className="px-px text-[11px] text-muted-foreground">/</span>}
          <span
            className={cn(
              "flex h-7 items-center justify-center rounded font-semibold tabular-nums",
              values.length > 1 ? "w-[1.6rem] text-[13px]" : "w-9 text-[15px]",
              gradeColorClasses(value),
            )}
          >
            {value}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Мобильный режим: сначала выбираем урок, потом идём по списку учеников.
 * Таблица на 390px нечитаема, а этот экран позволяет реально вести журнал с телефона.
 */
function MobileLessonBoard({
  lessons,
  rows,
  canEdit,
  valuesAt,
  rowStats,
  onPick,
  onRemove,
}: {
  lessons: GridLesson[];
  rows: GridRow[];
  canEdit: boolean;
  valuesAt: (row: number, col: number) => number[];
  rowStats: { average: number | null; year: number | null }[];
  onPick: (row: number, col: number, value: number, slot: number) => void;
  onRemove: (row: number, col: number, slot: number) => void;
}) {
  const [colIndex, setColIndex] = useState(() => Math.max(0, lessons.length - 1));
  const [openRow, setOpenRow] = useState<number | null>(null);

  const lesson = lessons[Math.min(colIndex, lessons.length - 1)];
  if (!lesson) return null;

  return (
    <div className="space-y-3 md:hidden">
      <div className="rounded-lg border border-rule-strong bg-card p-3">
        <label
          htmlFor="mobile-lesson"
          className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Урок
        </label>
        <select
          id="mobile-lesson"
          value={colIndex}
          onChange={(event) => {
            setColIndex(Number(event.target.value));
            setOpenRow(null);
          }}
          className="focus-ring h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground"
        >
          {lessons.map((item, index) => (
            <option key={item.id} value={index}>
              {formatDateShort(item.date)}
              {item.topic ? ` · ${item.topic}` : ""}
            </option>
          ))}
        </select>
      </div>

      <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
        {rows.map((row, rowIndex) => {
          const values = valuesAt(rowIndex, colIndex);
          const isOpen = openRow === rowIndex;

          return (
            <li key={row.studentId}>
              <div className="flex items-center gap-2 p-2.5">
                <Link
                  href={`/journal/students/${row.studentId}`}
                  className="focus-ring min-w-0 flex-1 rounded"
                >
                  <span className="block truncate text-sm font-medium">{shortName(row.name)}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    средний за четверть: {formatAverage(rowStats[rowIndex]?.average ?? null)}
                  </span>
                </Link>

                <button
                  type="button"
                  onClick={() => canEdit && setOpenRow(isOpen ? null : rowIndex)}
                  disabled={!canEdit}
                  aria-expanded={isOpen}
                  aria-label={`Оценки ученика ${row.name}: ${
                    values.length > 0 ? values.join(" и ") : "не выставлены"
                  }`}
                  className={cn(
                    "flex h-11 min-w-[3.5rem] shrink-0 items-center justify-center rounded-md px-1.5 text-base font-bold tabular-nums transition-transform active:scale-95",
                    values.length === 0 &&
                      "border border-dashed border-input text-muted-foreground",
                    isOpen && "ring-2 ring-primary",
                  )}
                >
                  {values.length === 0
                    ? "—"
                    : values.map((value, index) => (
                        <span key={index} className="flex items-center">
                          {index > 0 && <span className="px-0.5 text-xs opacity-60">/</span>}
                          <span
                            className={cn(
                              "flex h-8 w-8 items-center justify-center rounded",
                              gradeColorClasses(value),
                            )}
                          >
                            {value}
                          </span>
                        </span>
                      ))}
                </button>
              </div>

              {isOpen && canEdit && (
                <div className="animate-fade-in space-y-3 border-t border-rule bg-secondary/40 p-2.5">
                  {Array.from({ length: MAX_GRADES_PER_LESSON }).map((_, slot) => {
                    const disabled = slot > values.length;
                    return (
                      <div key={slot} className={cn(disabled && "opacity-40")}>
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {slot === 0 ? "Оценка" : "Вторая оценка за этот урок"}
                        </p>
                        <div className="grid grid-cols-5 gap-1.5">
                          {GRADE_BUTTONS.map((grade) => (
                            <button
                              key={grade}
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                onPick(rowIndex, colIndex, grade, slot);
                                if (slot > 0) setOpenRow(null);
                              }}
                              className={cn(
                                "focus-ring h-11 rounded-md text-base font-bold tabular-nums disabled:cursor-not-allowed",
                                gradeColorClasses(grade),
                                values[slot] === grade && "ring-2 ring-primary",
                              )}
                            >
                              {grade}
                            </button>
                          ))}
                        </div>
                        {values[slot] !== undefined && (
                          <button
                            type="button"
                            onClick={() => {
                              onRemove(rowIndex, colIndex, slot);
                              setOpenRow(null);
                            }}
                            className="focus-ring mt-1.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-md text-sm text-muted-foreground"
                          >
                            <Eraser className="h-4 w-4" aria-hidden />
                            Убрать {slot === 0 ? "оценку" : "вторую оценку"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmptyBoard({
  title,
  hint,
  icon: Icon,
}: {
  title: string;
  hint: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="ledger-paper rounded-lg border border-rule-strong p-10 text-center">
      {Icon && <Icon className="mx-auto mb-3 h-6 w-6 text-muted-foreground" aria-hidden />}
      <p className="text-base font-semibold">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Выбор оценки мышью: отдельный ряд цифр для первой и для второй оценки. */
function GradePicker({
  x,
  y,
  values,
  onPick,
  onRemove,
  onClose,
}: {
  x: number;
  y: number;
  values: number[];
  onPick: (value: number, slot: number) => void;
  onRemove: (slot: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [showSecond, setShowSecond] = useState(values.length > 1);

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

  const left = Math.min(Math.max(x, 140), window.innerWidth - 140);
  const top = Math.min(y, window.innerHeight - (showSecond ? 250 : 175));

  const digits = (slot: number) => (
    <div className="grid grid-cols-5 gap-1">
      {GRADE_BUTTONS.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onPick(value, slot)}
          className={cn(
            "focus-ring h-9 w-9 rounded text-sm font-bold tabular-nums transition-transform hover:scale-110",
            gradeColorClasses(value),
            values[slot] === value && "ring-2 ring-primary",
          )}
        >
          {value}
        </button>
      ))}
    </div>
  );

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Выбор оценки"
      className="animate-pop-in fixed z-50 -translate-x-1/2 rounded-lg border border-rule-strong bg-card p-2 shadow-lg"
      style={{ left, top }}
    >
      {digits(0)}

      {values[0] !== undefined && !showSecond && (
        <button
          type="button"
          onClick={() => setShowSecond(true)}
          className="focus-ring mt-1.5 w-full rounded px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
        >
          + вторая оценка за урок
        </button>
      )}

      {showSecond && (
        <div className="mt-2 border-t border-rule pt-2">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Вторая оценка
          </p>
          {digits(1)}
        </div>
      )}

      {values.length > 0 && (
        <button
          type="button"
          onClick={() => onRemove(values.length - 1)}
          className="focus-ring mt-1.5 flex w-full items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Eraser className="h-3.5 w-3.5" aria-hidden />
          Убрать {values.length > 1 ? "вторую оценку" : "оценку"}
        </button>
      )}
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
      className="h-4 w-4 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
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

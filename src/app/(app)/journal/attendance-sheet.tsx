"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { GridGrade, GridLesson, GridRow } from "@/app/(app)/journal/journal-grid";
import { MASTERY_LEVELS, type MasteryLevel, type StampKind } from "@/lib/gradeless";
import { gradeColorClasses } from "@/lib/grades";
import { cn, formatDateShort, shortName } from "@/lib/utils";

/**
 * Перекличка в одно касание. Дефолт «все здесь» — ноль записей в БД: чипы
 * «здесь» ничего не значат, пока учитель не тапнул. Каждый тап немедленно
 * зовёт СУЩЕСТВУЮЩИЕ колбэки грида markAbsent/clearAbsent — оптимизм, откат
 * и аудит (absence.set / absence.clear) уже готовы, отдельного пакетного
 * действия нет намеренно (см. CLAUDE.md о правах и спецификацию фазы 3).
 *
 * Защита от тихой потери данных: если в клетке есть оценки, первый тап лишь
 * взводит подтверждение — «Н» (которое сотрёт оценки) ставится вторым тапом.
 *
 * Разметка: origin == null — нижний лист (телефон), origin задан — панель
 * у столбца (десктоп). Закрытие: «Готово», Escape, pointerdown вне панели.
 * На scroll НЕ закрывается: внутри — прокручиваемый список класса.
 */
export function AttendanceSheet({
  lesson,
  col,
  rows,
  origin,
  gradesAt,
  masteryAt,
  stampsAt,
  isAbsent,
  onMarkAbsent,
  onClearAbsent,
  onClose,
}: {
  lesson: GridLesson;
  col: number;
  rows: GridRow[];
  /** Координаты якоря у столбца (десктоп) или null — нижний лист (телефон). */
  origin: { x: number; y: number } | null;
  gradesAt: (row: number, col: number) => GridGrade[];
  /** Уровень освоения клетки (1–2 класс) — «Н» его тоже вытесняет. */
  masteryAt: (row: number, col: number) => { level: MasteryLevel } | null;
  /** Печати клетки (позиции; null — пусто) — вытесняются вместе с уровнем. */
  stampsAt: (row: number, col: number) => (StampKind | null)[];
  isAbsent: (row: number, col: number) => boolean;
  onMarkAbsent: (row: number, col: number) => void;
  onClearAbsent: (row: number, col: number) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  /** Индекс строки, у которой взведено подтверждение «сотрёт оценку». */
  const [confirmRow, setConfirmRow] = useState<number | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  if (!mounted) return null;

  const absentCount = rows.reduce((sum, _, index) => sum + (isAbsent(index, col) ? 1 : 0), 0);

  /** Есть ли в клетке что-то, что сотрёт отметка «Н». */
  function hasWork(rowIndex: number): boolean {
    return (
      gradesAt(rowIndex, col).length > 0 ||
      masteryAt(rowIndex, col) !== null ||
      stampsAt(rowIndex, col).some(Boolean)
    );
  }

  /** Что именно сотрёт «Н» — словами, чтобы учитель понимал цену второго тапа. */
  function describeWork(rowIndex: number): string {
    const cellGrades = gradesAt(rowIndex, col);
    if (cellGrades.length > 0) {
      return cellGrades.length > 1
        ? `оценки ${cellGrades.map((grade) => grade.value).join("/")}`
        : `оценку ${cellGrades[0]!.value}`;
    }
    const parts: string[] = [];
    const mastery = masteryAt(rowIndex, col);
    if (mastery) parts.push(`уровень «${MASTERY_LEVELS[mastery.level].label}»`);
    const stampCount = stampsAt(rowIndex, col).filter(Boolean).length;
    if (stampCount > 0) parts.push(stampCount > 1 ? `${stampCount} печати` : "печать");
    return parts.join(" и ") || "отметку";
  }

  function handleTap(rowIndex: number) {
    if (isAbsent(rowIndex, col)) {
      onClearAbsent(rowIndex, col);
      setConfirmRow(null);
      return;
    }
    /* Подтверждение нужно не только для оценок: у безотметочного ученика
       «Н» так же молча снесёт уровень и печати — труд учителя за урок. */
    if (hasWork(rowIndex) && confirmRow !== rowIndex) {
      setConfirmRow(rowIndex);
      return;
    }
    onMarkAbsent(rowIndex, col);
    setConfirmRow(null);
  }

  const content = (
    <>
      <div className="border-b border-rule px-3 py-2.5">
        <p className="truncate text-sm font-semibold">
          Перекличка · {formatDateShort(lesson.date)}
          {lesson.topic && (
            <span className="font-normal text-muted-foreground"> · {lesson.topic}</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          отсутствуют:{" "}
          <span className="font-semibold tabular-nums text-foreground">{absentCount}</span>
        </p>
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-rule overflow-y-auto overscroll-contain">
        {rows.map((row, rowIndex) => {
          const absent = isAbsent(rowIndex, col);
          const grades = gradesAt(rowIndex, col);
          const armed = confirmRow === rowIndex && hasWork(rowIndex) && !absent;

          return (
            <li key={row.studentId}>
              {/* Весь ряд — тап-цель не ниже 44px: один тап переключает состояние */}
              <button
                type="button"
                onClick={() => handleTap(rowIndex)}
                aria-pressed={absent}
                className="focus-ring flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{shortName(row.name)}</span>
                  {armed && (
                    <span className="block text-[11px] font-medium text-destructive">
                      ещё раз — сотрёт {describeWork(rowIndex)}
                    </span>
                  )}
                </span>

                {absent ? (
                  <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded bg-slate-200 text-[13px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                    Н
                  </span>
                ) : grades.length > 0 ? (
                  <span className="flex shrink-0 items-center gap-0.5">
                    {grades.map((grade, index) => (
                      <span
                        key={index}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded text-[13px] font-bold tabular-nums",
                          gradeColorClasses(grade.value),
                        )}
                      >
                        {grade.value}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    здесь
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-rule p-2">
        <button
          type="button"
          onClick={onClose}
          className="focus-ring flex h-10 w-full items-center justify-center rounded-md bg-secondary text-sm font-semibold transition-colors hover:bg-accent"
        >
          Готово
        </button>
      </div>
    </>
  );

  if (origin) {
    // Панель у столбца: clamp-позиционирование как у окна выбора оценки.
    const left = Math.min(Math.max(origin.x, 170), window.innerWidth - 170);
    const top = Math.max(8, Math.min(origin.y, window.innerHeight * 0.3 - 8));
    return createPortal(
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Перекличка"
        className="animate-pop-in fixed z-50 flex max-h-[70vh] w-[20rem] -translate-x-1/2 flex-col rounded-lg border border-rule-strong bg-card shadow-lg"
        style={{ left, top }}
      >
        {content}
      </div>,
      document.body,
    );
  }

  return createPortal(
    <>
      {/* Лёгкий backdrop: тап по нему — «Готово» (pointerdown вне панели) */}
      <div className="fixed inset-0 z-40 bg-black/20" aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Перекличка"
        className="animate-fade-in fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-lg border-t border-rule-strong bg-card shadow-lg"
      >
        {content}
      </div>
    </>,
    document.body,
  );
}

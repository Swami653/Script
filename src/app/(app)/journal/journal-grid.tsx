"use client";

import {
  BarChart3,
  ClipboardCheck,
  Eraser,
  ExternalLink,
  History,
  Trash2,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { AttendanceSheet } from "@/app/(app)/journal/attendance-sheet";
import { LessonInsight } from "@/app/(app)/journal/lesson-insight";
import { Flash, useFlash } from "@/components/flash";
import { Button } from "@/components/ui/button";
import {
  clearAbsenceAction,
  clearCellAction,
  deleteGradeAction,
  setAbsenceAction,
  setGradeAction,
} from "@/lib/actions/grades";
import { deleteLessonAction } from "@/lib/actions/lessons";
import {
  buildAskStats,
  LOW_GRADE_COUNT,
  NOT_ASKED_WINDOW,
  pickAskCandidates,
} from "@/lib/ask-candidates";
import {
  analyzeLessonColumn,
  averageColorClasses,
  averageGrade,
  formatAverage,
  gradeColorClasses,
  GRADE_KIND_KEYS,
  GRADE_KINDS,
  MAX_GRADE,
  MAX_GRADES_PER_LESSON,
  MIN_GRADE,
  projectedAverage,
  weightForKind,
  weightedAverage,
  yearGrade,
  type GradeKind,
  type Quarter,
} from "@/lib/grades";
import { cn, formatDateLong, formatDateShort, todayUtcMidnight } from "@/lib/utils";

export type GridLesson = {
  id: string;
  date: string;
  topic: string | null;
  /** «Что задано» к этому уроку. null — не записано. */
  homework: string | null;
  /** Пометка планируемой работы — сырой TEXT; сравнивается с "control" защитно. */
  plannedKind: string | null;
};

/** Панель урока: анализ/домашка/пометка (insight) или перекличка (attendance). */
type LessonPanelState = {
  type: "insight" | "attendance";
  lessonId: string;
  /** Координаты якоря у столбца (десктоп) или null — нижний лист (телефон). */
  origin: { x: number; y: number } | null;
};

/** Одна оценка в клетке: значение + тип/вес/комментарий. */
export type GridGrade = {
  value: number;
  weight: number;
  kind: GradeKind;
  comment: string | null;
};

export type GridRow = {
  studentId: string;
  name: string;
  className: string | null;
  cells: Record<string, GridGrade[]>;
  /** lessonId, где у ученика отмечено «Н» */
  absentLessons: string[];
  quarterAverages: (number | null)[];
};

const GRADE_BUTTONS = Array.from({ length: MAX_GRADE }, (_, index) => index + MIN_GRADE);

function cellKey(studentId: string, lessonId: string): string {
  return `${studentId}|${lessonId}`;
}

function makeGrade(value: number, kind: GradeKind): GridGrade {
  return { value, weight: weightForKind(kind), kind, comment: null };
}

/** «Иванова Мария Петровна» -> «Иванова М. П.» — для узких экранов и панелей. */
export function shortName(name: string): string {
  const [surname, ...rest] = name.trim().split(/\s+/);
  if (!surname) return name;
  const initials = rest
    .slice(0, 2)
    .map((part) => `${part[0]!.toUpperCase()}.`)
    .join(" ");
  return initials ? `${surname} ${initials}` : surname;
}

/**
 * Журнал класса. Строки — ученики, столбцы — уроки, справа за чертой итоги.
 *
 * В клетке: до двух оценок («10/9»), либо отметка «Н» (отсутствие — в средний
 * балл не входит). У оценки есть тип («за что» она) и комментарий.
 *
 * Клавиатура (быстрый ввод текущих оценок):
 *   ← → ↑ ↓        — перемещение
 *   1…9, 0 = 10    — первая оценка (тип «текущая»)
 *   Shift + цифра  — вторая оценка в клетке
 *   Enter / клик   — окно с типом работы, комментарием и отметкой «Н»
 *   Delete         — убрать оценку (Shift+Delete — очистить клетку)
 */
export function JournalGrid({
  lessons,
  rows,
  quarter,
  canEdit,
  subjectName,
  askMode,
}: {
  lessons: GridLesson[];
  rows: GridRow[];
  quarter: Quarter;
  canEdit: boolean;
  subjectName: string;
  /** Режим «Кого спросить?» (?ask=1): подсветка кандидатов на опрос. */
  askMode: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { flash, show, clear } = useFlash();
  const [, startTransition] = useTransition();

  /** Оптимистичные значения клеток поверх серверных данных. */
  const [overrides, setOverrides] = useState<Record<string, GridGrade[]>>({});
  /** Оптимистичные отметки «Н»: ключ клетки -> отсутствует ли. */
  const [absenceOverrides, setAbsenceOverrides] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [picker, setPicker] = useState<{ row: number; col: number; x: number; y: number } | null>(
    null,
  );
  /**
   * Открытая панель урока. Хранится lessonId, а не индекс столбца: после
   * refresh, смены четверти или удаления урока панель сама находит свой
   * столбец заново, а если урока больше нет — не рендерится.
   */
  const [lessonPanel, setLessonPanel] = useState<LessonPanelState | null>(null);
  const [settled, setSettled] = useState<Record<string, number>>({});
  const pendingOne = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /** Автоскролл к «сегодня» — один раз при монтировании. */
  const scrolledToToday = useRef(false);

  useEffect(() => {
    setOverrides({});
    setAbsenceOverrides({});
  }, [rows, lessons]);

  useEffect(() => () => void (pendingOne.current && clearTimeout(pendingOne.current)), []);

  /**
   * После генерации «Сетки на четверть» уроков много и последние — будущие:
   * журнал открывается прокрученным к сегодняшнему столбцу (первый с
   * date >= сегодня UTC; если все прошли — последний). Однократно.
   */
  useEffect(() => {
    if (scrolledToToday.current || lessons.length === 0) return;
    scrolledToToday.current = true;
    const todayMs = todayUtcMidnight().getTime();
    let target = lessons.findIndex((lesson) => new Date(lesson.date).getTime() >= todayMs);
    if (target === -1) target = lessons.length - 1;
    gridRef.current
      ?.querySelector(`[data-lesson-col="${target}"]`)
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [lessons]);

  const gradesAt = useCallback(
    (rowIndex: number, colIndex: number): GridGrade[] => {
      const row = rows[rowIndex];
      const lesson = lessons[colIndex];
      if (!row || !lesson) return [];
      const key = cellKey(row.studentId, lesson.id);
      if (key in overrides) return overrides[key] ?? [];
      return row.cells[lesson.id] ?? [];
    },
    [lessons, overrides, rows],
  );

  const isAbsent = useCallback(
    (rowIndex: number, colIndex: number): boolean => {
      const row = rows[rowIndex];
      const lesson = lessons[colIndex];
      if (!row || !lesson) return false;
      const key = cellKey(row.studentId, lesson.id);
      if (key in absenceOverrides) return absenceOverrides[key]!;
      return row.absentLessons.includes(lesson.id);
    },
    [absenceOverrides, lessons, rows],
  );

  const rowStats = useMemo(
    () =>
      rows.map((row, rowIndex) => {
        const items: { value: number; weight: number }[] = [];
        for (let colIndex = 0; colIndex < lessons.length; colIndex += 1) {
          items.push(...gradesAt(rowIndex, colIndex));
        }
        const average = weightedAverage(items);
        const quarterAverages = row.quarterAverages.map((item, index) =>
          index === quarter - 1 ? average : item,
        );
        return {
          average,
          year: yearGrade(quarterAverages),
          // Прогноз «а что, если»: средний после гипотетической 10 и после 1.
          p10: projectedAverage(items, MAX_GRADE),
          p1: projectedAverage(items, MIN_GRADE),
        };
      }),
    [gradesAt, lessons.length, quarter, rows],
  );

  const classAverage = useMemo(
    () => averageGrade(rowStats.map((s) => s.average).filter((v): v is number => v !== null)),
    [rowStats],
  );

  /**
   * Накопляемость и «Кого спросить?». Окно «давно не спрашивали» считается
   * ТОЛЬКО по прошедшим урокам (date <= сегодня UTC): будущие столбцы сетки
   * не делают весь класс «давно не спрошенным». Считается поверх gradesAt и
   * isAbsent — оптимистичные оценки учитываются до ответа сервера.
   */
  const askStats = useMemo(() => {
    const todayMs = todayUtcMidnight().getTime();
    const pastLessonIds = lessons
      .filter((lesson) => new Date(lesson.date).getTime() <= todayMs)
      .map((lesson) => lesson.id);
    return rows.map((row, rowIndex) => {
      const cellGradeCounts: Record<string, number> = {};
      const absentLessonIds: string[] = [];
      for (let colIndex = 0; colIndex < lessons.length; colIndex += 1) {
        const count = gradesAt(rowIndex, colIndex).length;
        if (count > 0) cellGradeCounts[lessons[colIndex]!.id] = count;
        if (isAbsent(rowIndex, colIndex)) absentLessonIds.push(lessons[colIndex]!.id);
      }
      return {
        studentId: row.studentId,
        name: row.name,
        ...buildAskStats({ pastLessonIds, cellGradeCounts, absentLessonIds }),
      };
    });
  }, [gradesAt, isAbsent, lessons, rows]);

  const askCandidates = useMemo(
    () => (askMode ? new Set(pickAskCandidates(askStats)) : new Set<string>()),
    [askMode, askStats],
  );

  /** Скрыть режим «Кого спросить?»: убрать ?ask=1 из адреса. */
  const hideAsk = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("ask");
    router.push(`/journal?${params.toString()}`);
  }, [router, searchParams]);

  const focusCell = useCallback((rowIndex: number, colIndex: number) => {
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-cell="${rowIndex}-${colIndex}"]`)
      ?.focus();
  }, []);

  const commitGrade = useCallback(
    (rowIndex: number, colIndex: number, value: number, slot: number, kind: GradeKind, comment?: string) => {
      const row = rows[rowIndex];
      const lesson = lessons[colIndex];
      if (!row || !lesson) return;
      if (slot >= MAX_GRADES_PER_LESSON) return;

      const key = cellKey(row.studentId, lesson.id);
      const previous = gradesAt(rowIndex, colIndex);
      if (slot > previous.length) {
        show("error", "Сначала поставьте первую оценку за этот урок");
        return;
      }

      const next = [...previous];
      next[slot] = { value, weight: weightForKind(kind), kind, comment: comment?.trim() || null };

      setOverrides((prev) => ({ ...prev, [key]: next }));
      setAbsenceOverrides((prev) => ({ ...prev, [key]: false }));
      setSettled((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));

      startTransition(async () => {
        const result = await setGradeAction({
          studentId: row.studentId,
          lessonId: lesson.id,
          value,
          slot,
          kind,
          comment,
        });
        if (!result.ok) {
          setOverrides((prev) => ({ ...prev, [key]: previous }));
          show("error", `${result.status}: ${result.error}`);
          return;
        }
        router.refresh();
      });
    },
    [gradesAt, lessons, router, rows, show],
  );

  /**
   * Поменять тип работы и комментарий у уже выставленных оценок клетки.
   *
   * Нужно потому, что учитель сначала ставит цифру, а «за что» и комментарий
   * дописывает после — окно выбора остаётся открытым. Тип и комментарий
   * общие для обеих оценок клетки: «10/9» — это одна работа.
   */
  const updateCellMeta = useCallback(
    (rowIndex: number, colIndex: number, kind: GradeKind, comment: string) => {
      const row = rows[rowIndex];
      const lesson = lessons[colIndex];
      if (!row || !lesson) return;

      const previous = gradesAt(rowIndex, colIndex);
      if (previous.length === 0) return; // цифры ещё нет — правка уедет вместе с ней

      const trimmed = comment.trim() || null;
      const unchanged = previous.every((grade) => grade.kind === kind && grade.comment === trimmed);
      if (unchanged) return;

      const key = cellKey(row.studentId, lesson.id);
      const next = previous.map((grade) => ({
        ...grade,
        kind,
        weight: weightForKind(kind),
        comment: trimmed,
      }));
      setOverrides((prev) => ({ ...prev, [key]: next }));

      startTransition(async () => {
        for (const [slot, grade] of previous.entries()) {
          const result = await setGradeAction({
            studentId: row.studentId,
            lessonId: lesson.id,
            value: grade.value,
            slot,
            kind,
            comment: trimmed ?? "",
          });
          if (!result.ok) {
            setOverrides((prev) => ({ ...prev, [key]: previous }));
            show("error", `${result.status}: ${result.error}`);
            return;
          }
        }
        show("success", trimmed ? "Комментарий сохранён" : `Тип: ${GRADE_KINDS[kind].label}`);
        router.refresh();
      });
    },
    [gradesAt, lessons, router, rows, show],
  );

  const removeGrade = useCallback(
    (rowIndex: number, colIndex: number, slot: number) => {
      const row = rows[rowIndex];
      const lesson = lessons[colIndex];
      if (!row || !lesson) return;

      const key = cellKey(row.studentId, lesson.id);
      const previous = gradesAt(rowIndex, colIndex);
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
    [gradesAt, lessons, router, rows, show],
  );

  const clearCell = useCallback(
    (rowIndex: number, colIndex: number) => {
      const row = rows[rowIndex];
      const lesson = lessons[colIndex];
      if (!row || !lesson) return;

      const key = cellKey(row.studentId, lesson.id);
      const previous = gradesAt(rowIndex, colIndex);
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
    [gradesAt, lessons, router, rows, show],
  );

  const markAbsent = useCallback(
    (rowIndex: number, colIndex: number) => {
      const row = rows[rowIndex];
      const lesson = lessons[colIndex];
      if (!row || !lesson) return;

      const key = cellKey(row.studentId, lesson.id);
      const prevGrades = gradesAt(rowIndex, colIndex);
      setOverrides((prev) => ({ ...prev, [key]: [] }));
      setAbsenceOverrides((prev) => ({ ...prev, [key]: true }));

      startTransition(async () => {
        const result = await setAbsenceAction({ studentId: row.studentId, lessonId: lesson.id });
        if (!result.ok) {
          setOverrides((prev) => ({ ...prev, [key]: prevGrades }));
          setAbsenceOverrides((prev) => ({ ...prev, [key]: false }));
          show("error", `${result.status}: ${result.error}`);
          return;
        }
        router.refresh();
      });
    },
    [gradesAt, lessons, router, rows, show],
  );

  const clearAbsent = useCallback(
    (rowIndex: number, colIndex: number) => {
      const row = rows[rowIndex];
      const lesson = lessons[colIndex];
      if (!row || !lesson) return;
      const key = cellKey(row.studentId, lesson.id);
      setAbsenceOverrides((prev) => ({ ...prev, [key]: false }));

      startTransition(async () => {
        const result = await clearAbsenceAction({ studentId: row.studentId, lessonId: lesson.id });
        if (!result.ok) {
          setAbsenceOverrides((prev) => ({ ...prev, [key]: true }));
          show("error", `${result.status}: ${result.error}`);
          return;
        }
        router.refresh();
      });
    },
    [lessons, router, rows, show],
  );

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
    if (key === "Escape") return setPicker(null);

    if (!canEdit) return;

    // «Н» с клавиатуры — русская «н» или латинская «h».
    if (key === "н" || key === "Н" || key === "h" || key === "H") {
      event.preventDefault();
      if (isAbsent(row, col)) clearAbsent(row, col);
      else markAbsent(row, col);
      advanceDown(row, col);
      return;
    }

    if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      if (isAbsent(row, col)) return clearAbsent(row, col);
      const grades = gradesAt(row, col);
      if (grades.length === 0) return;
      if (shiftKey) clearCell(row, col);
      else removeGrade(row, col, grades.length - 1);
      return;
    }

    const slot = shiftKey ? 1 : 0;

    if (key === "0" || (shiftKey && key === ")")) {
      event.preventDefault();
      if (pendingOne.current) {
        clearTimeout(pendingOne.current);
        pendingOne.current = null;
      }
      commitGrade(row, col, 10, slot, "regular");
      if (slot === 0) advanceDown(row, col);
      return;
    }

    if (/^[1-9]$/.test(key)) {
      event.preventDefault();
      const value = Number(key);
      if (value === 1) {
        const previous = gradesAt(row, col);
        const optimistic = [...previous];
        optimistic[slot] = makeGrade(1, "regular");
        setOverrides((prev) => ({
          ...prev,
          [cellKey(rows[row]!.studentId, lessons[col]!.id)]: optimistic,
        }));
        if (pendingOne.current) clearTimeout(pendingOne.current);
        pendingOne.current = setTimeout(() => {
          pendingOne.current = null;
          commitGrade(row, col, 1, slot, "regular");
          if (slot === 0) advanceDown(row, col);
        }, 450);
        return;
      }
      commitGrade(row, col, value, slot, "regular");
      if (slot === 0) advanceDown(row, col);
    }
  }

  function openPicker(event: React.MouseEvent<HTMLButtonElement>, row: number, col: number) {
    if (!canEdit) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setSelected({ row, col });
    // Панель урока и окно оценки не живут одновременно — открытие закрывает другое.
    setLessonPanel(null);
    setPicker({ row, col, x: rect.left + rect.width / 2, y: rect.bottom + 6 });
  }

  /** Открыть панель урока от элемента шапки (десктоп): якорь — под элементом. */
  function openLessonPanel(
    event: React.MouseEvent<HTMLElement>,
    type: "insight" | "attendance",
    lessonId: string,
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    setPicker(null);
    setLessonPanel({
      type,
      lessonId,
      origin: { x: rect.left + rect.width / 2, y: rect.bottom + 6 },
    });
  }

  /** Открыть панель урока нижним листом (телефон). */
  const openMobilePanel = useCallback((type: "insight" | "attendance", lessonId: string) => {
    setPicker(null);
    setLessonPanel({ type, lessonId, origin: null });
  }, []);

  const closeLessonPanel = useCallback(() => setLessonPanel(null), []);

  /** Столбец открытой панели; -1 — урок пропал (удалён/сменилась четверть). */
  const panelColIndex = lessonPanel
    ? lessons.findIndex((lesson) => lesson.id === lessonPanel.lessonId)
    : -1;
  const panelLesson = panelColIndex >= 0 ? lessons[panelColIndex] : undefined;

  /** Анализ столбца для панели — по live-данным (видит оптимистичные оценки). */
  const panelAnalysis = useMemo(
    () =>
      lessonPanel?.type === "insight" && panelColIndex >= 0
        ? analyzeLessonColumn(
            rows.map((row, rowIndex) => ({
              name: row.name,
              grades: gradesAt(rowIndex, panelColIndex),
              absent: isAbsent(rowIndex, panelColIndex),
            })),
          )
        : null,
    [lessonPanel, panelColIndex, rows, gradesAt, isAbsent],
  );

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
        icon={UserX}
        title="В журнале нет учеников"
        hint="Ученики заводятся в панели администратора. Там есть массовый импорт: вставьте список ФИО — логины и пароли создадутся сами."
      />
    );
  }

  return (
    <>
      {/* ── «Кого спросить?»: критерии подсветки и выключатель ────────────── */}
      {askMode && (
        <div className="animate-fade-in flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-primary/30 bg-primary/[0.04] px-3 py-2 text-xs text-muted-foreground">
          <span>
            {askCandidates.size > 0
              ? `Подсвечены кандидаты на опрос: меньше ${LOW_GRADE_COUNT} оценок за четверть ` +
                `или нет оценок за последние ${NOT_ASKED_WINDOW} уроков; отсутствующие на ` +
                `последнем уроке пропущены.`
              : "Все спрошены недавно — подсветки нет."}
          </span>
          <button
            type="button"
            onClick={hideAsk}
            className="focus-ring rounded px-1.5 py-0.5 font-medium text-primary transition-colors hover:bg-primary/10"
          >
            Скрыть
          </button>
        </div>
      )}

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
                  data-lesson-col={index}
                  className={cn(
                    "group w-[4.25rem] border-b-2 border-rule-strong px-0 py-1.5 align-bottom font-medium",
                    index > 0 &&
                      new Date(lesson.date).getUTCMonth() !==
                        new Date(lessons[index - 1]!.date).getUTCMonth() &&
                      "border-l border-l-rule-strong",
                  )}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    {/* Дата — кнопка: открывает панель урока (анализ + домашка + КР) */}
                    <button
                      type="button"
                      onClick={(event) => openLessonPanel(event, "insight", lesson.id)}
                      title={`${formatDateLong(lesson.date)}${lesson.topic ? ` — ${lesson.topic}` : ""}${
                        lesson.homework ? ` — задано: ${lesson.homework}` : ""
                      }`}
                      className="focus-ring rounded px-1 text-[13px] tabular-nums transition-colors hover:bg-accent"
                    >
                      {formatDateShort(lesson.date)}
                    </button>
                    {/* Ряд под датой: постоянный штамп «КР» + hover-иконки.
                        Высота фиксированная, чтобы даты всех столбцов стояли в линию */}
                    <div className="flex h-4 items-center justify-center gap-1">
                      {lesson.plannedKind === "control" && (
                        <span
                          className="text-[9px] font-semibold uppercase leading-none tracking-wide text-muted-foreground"
                          title="Планируется контрольная"
                        >
                          КР
                        </span>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={(event) => openLessonPanel(event, "attendance", lesson.id)}
                          title="Перекличка — отметить отсутствующих"
                          className="focus-ring flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <ClipboardCheck className="h-3 w-3 text-muted-foreground" aria-hidden />
                        </button>
                      )}
                      {canEdit && <DeleteLessonButton lessonId={lesson.id} onError={show} />}
                    </div>
                  </div>
                </th>
              ))}
              <th scope="col" aria-hidden className="w-auto border-b-2 border-rule-strong" />
              <th
                scope="col"
                className="w-24 border-b-2 border-l border-rule-strong bg-secondary/40 px-3 py-2 text-center align-bottom text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                title="Средний балл за четверть"
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
            {rows.map((row, rowIndex) => {
              const ask = askStats[rowIndex];
              const isAskCandidate = askCandidates.has(row.studentId);
              const lowCount = (ask?.gradeCount ?? 0) < LOW_GRADE_COUNT;
              const staleAsk = (ask?.lessonsSinceAsked ?? 0) >= NOT_ASKED_WINDOW;

              return (
              <tr
                key={row.studentId}
                className={cn(
                  "group/row hover:bg-primary/[0.04]",
                  isAskCandidate && "bg-primary/[0.06]",
                )}
              >
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-r border-rule bg-card px-3 py-0 text-left font-normal shadow-[inset_3px_0_0_hsl(var(--spine))] group-hover/row:bg-accent/50"
                >
                  <Link
                    href={`/journal/students/${row.studentId}`}
                    className="focus-ring flex h-9 items-center justify-between gap-2 rounded"
                    title="Открыть карточку ученика — оценки по всем предметам"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{row.name}</span>
                      {isAskCandidate && (
                        <span className="inline-block shrink-0 -rotate-2 rounded border border-primary/60 px-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                          спросить
                        </span>
                      )}
                    </span>
                    {/* Накопляемость: постоянный счётчик, на hover уступает
                        место стрелке перехода в карточку ученика */}
                    <span className="relative flex h-3.5 shrink-0 items-center">
                      <span
                        className="flex items-center gap-0.5 transition-opacity group-hover/row:opacity-0"
                        title={`Оценок за четверть: ${ask?.gradeCount ?? 0}${
                          staleAsk
                            ? ` · без оценки ${ask!.lessonsSinceAsked} прошедших уроков подряд`
                            : ""
                        }`}
                      >
                        {staleAsk && (
                          <History className="h-3 w-3 text-muted-foreground" aria-hidden />
                        )}
                        <span
                          className={cn(
                            "w-7 text-right text-[11px] tabular-nums",
                            lowCount
                              ? "font-semibold text-amber-600 dark:text-amber-300"
                              : "text-muted-foreground",
                          )}
                        >
                          {ask?.gradeCount ?? 0}
                        </span>
                      </span>
                      <ExternalLink
                        className="absolute right-0 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100"
                        aria-hidden
                      />
                    </span>
                  </Link>
                </th>

                {lessons.map((lesson, colIndex) => {
                  const grades = gradesAt(rowIndex, colIndex);
                  const absent = isAbsent(rowIndex, colIndex);
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
                          absent
                            ? "отсутствовал"
                            : grades.length > 0
                              ? `оценки ${grades.map((g) => g.value).join(" и ")}`
                              : "оценка не выставлена"
                        }`}
                        className={cn(
                          "flex h-9 w-full items-center justify-center transition-colors focus:outline-none",
                          grades.length === 0 && !absent && "hover:bg-primary/10",
                          isSelected && "ring-2 ring-inset ring-primary",
                          canEdit ? "cursor-pointer" : "cursor-default",
                        )}
                      >
                        <CellContent grades={grades} absent={absent} settleKey={settled[key] ?? 0} />
                      </button>
                    </td>
                  );
                })}

                <td className="border-b border-rule" />

                <td className="border-b border-l border-rule-strong bg-secondary/30 px-3 py-0 text-center">
                  <span
                    className={cn(
                      "block text-[15px] font-semibold leading-tight tabular-nums",
                      averageColorClasses(rowStats[rowIndex]?.average ?? null),
                    )}
                  >
                    {formatAverage(rowStats[rowIndex]?.average ?? null)}
                  </span>
                  {/* Прогноз «а что, если»: цвета шкалы не применяются —
                      это гипотетические числа, а не данные */}
                  {rowStats[rowIndex]?.average != null && (
                    <span className="block whitespace-nowrap text-[10px] leading-none tabular-nums text-muted-foreground">
                      10→{formatAverage(rowStats[rowIndex]?.p10 ?? null)} · 1→
                      {formatAverage(rowStats[rowIndex]?.p1 ?? null)}
                    </span>
                  )}
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
              );
            })}
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
                const items = rows.flatMap((_, rowIndex) => gradesAt(rowIndex, colIndex));
                return (
                  <td
                    key={lesson.id}
                    className="border-t-2 border-rule-strong px-0 py-2 text-center tabular-nums"
                  >
                    <span className={averageColorClasses(weightedAverage(items))}>
                      {formatAverage(weightedAverage(items))}
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
        gradesAt={gradesAt}
        isAbsent={isAbsent}
        rowStats={rowStats}
        onPick={(r, c, value, slot, kind, comment) => commitGrade(r, c, value, slot, kind, comment)}
        onUpdateMeta={(r, c, kind, comment) => updateCellMeta(r, c, kind, comment)}
        onRemove={(r, c, slot) => removeGrade(r, c, slot)}
        onAbsent={(r, c) => markAbsent(r, c)}
        onClearAbsent={(r, c) => clearAbsent(r, c)}
        onOpenPanel={openMobilePanel}
        askCandidates={askCandidates}
      />

      {/* ── Панели урока: перекличка и анализ/домашка/пометка КР ──────────── */}
      {lessonPanel?.type === "attendance" && panelLesson && canEdit && (
        <AttendanceSheet
          /* key — чтобы при смене урока подтверждения начинались заново */
          key={`attendance-${panelLesson.id}`}
          lesson={panelLesson}
          col={panelColIndex}
          rows={rows}
          origin={lessonPanel.origin}
          gradesAt={gradesAt}
          isAbsent={isAbsent}
          onMarkAbsent={markAbsent}
          onClearAbsent={clearAbsent}
          onClose={closeLessonPanel}
        />
      )}
      {lessonPanel?.type === "insight" && panelLesson && panelAnalysis && (
        <LessonInsight
          /* key — чтобы черновик домашки не переезжал на другой урок */
          key={`insight-${panelLesson.id}`}
          lesson={panelLesson}
          subjectName={subjectName}
          canEdit={canEdit}
          origin={lessonPanel.origin}
          analysis={panelAnalysis}
          onFlash={show}
          onClose={closeLessonPanel}
        />
      )}

      {picker && canEdit && (
        <GradePicker
          /* key — чтобы при переходе на другую клетку окно пересоздалось
             с типом и комментарием ЭТОЙ клетки, а не предыдущей */
          key={`${picker.row}-${picker.col}`}
          x={picker.x}
          y={picker.y}
          grades={gradesAt(picker.row, picker.col)}
          absent={isAbsent(picker.row, picker.col)}
          studentName={rows[picker.row]?.name ?? ""}
          /* Окно НЕ закрывается: после цифры учитель дописывает «за что» и комментарий */
          onPick={(value, slot, kind, comment) =>
            commitGrade(picker.row, picker.col, value, slot, kind, comment)
          }
          onUpdateMeta={(kind, comment) => updateCellMeta(picker.row, picker.col, kind, comment)}
          onRemove={(slot) => removeGrade(picker.row, picker.col, slot)}
          onAbsent={() => {
            markAbsent(picker.row, picker.col);
            setPicker(null);
            focusCell(picker.row, picker.col);
          }}
          onClearAbsent={() => {
            clearAbsent(picker.row, picker.col);
            setPicker(null);
            focusCell(picker.row, picker.col);
          }}
          onClose={() => {
            setPicker(null);
            focusCell(picker.row, picker.col);
          }}
        />
      )}

      <Flash message={flash} onClose={clear} />
    </>
  );
}

/** Содержимое клетки: «Н», пусто, «8» или «10/9». Контрольная — с точкой снизу. */
function CellContent({
  grades,
  absent,
  settleKey,
}: {
  grades: GridGrade[];
  absent: boolean;
  settleKey: number;
}) {
  if (absent) {
    return (
      <span
        className="flex h-7 w-9 items-center justify-center rounded bg-slate-200 text-[15px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200"
        title="Отсутствовал"
      >
        Н
      </span>
    );
  }
  if (grades.length === 0) {
    return <span className="text-transparent">·</span>;
  }

  return (
    <span key={settleKey} className="animate-ink-settle flex items-center">
      {grades.map((grade, index) => (
        <span key={index} className="flex items-center">
          {index > 0 && <span className="px-px text-[11px] text-muted-foreground">/</span>}
          <span
            className={cn(
              "relative flex h-7 items-center justify-center rounded font-semibold tabular-nums",
              grades.length > 1 ? "w-[1.6rem] text-[13px]" : "w-9 text-[15px]",
              gradeColorClasses(grade.value),
            )}
            title={`${GRADE_KINDS[grade.kind].label}${grade.comment ? ` — ${grade.comment}` : ""}`}
          >
            {grade.value}
            {/* Точка — визуальная пометка контрольной, к весу отношения не имеет */}
            {grade.kind === "control" && (
              <span
                aria-hidden
                className="absolute bottom-0.5 h-[3px] w-[3px] rounded-full bg-current opacity-70"
              />
            )}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Урок по умолчанию — последний ПРОШЕДШИЙ (date <= сегодня UTC): после
 * генерации «Сетки на четверть» последний урок списка — будущий, а оценки
 * ставят за сегодняшний. Прошедших нет — последний в списке.
 */
function lastPastLessonIndex(lessons: GridLesson[]): number {
  const todayMs = todayUtcMidnight().getTime();
  let last = -1;
  for (let index = 0; index < lessons.length; index += 1) {
    if (new Date(lessons[index]!.date).getTime() <= todayMs) last = index;
  }
  return last >= 0 ? last : Math.max(0, lessons.length - 1);
}

function MobileLessonBoard({
  lessons,
  rows,
  canEdit,
  gradesAt,
  isAbsent,
  rowStats,
  onPick,
  onUpdateMeta,
  onRemove,
  onAbsent,
  onClearAbsent,
  onOpenPanel,
  askCandidates,
}: {
  lessons: GridLesson[];
  rows: GridRow[];
  canEdit: boolean;
  gradesAt: (row: number, col: number) => GridGrade[];
  isAbsent: (row: number, col: number) => boolean;
  rowStats: { average: number | null; year: number | null; p10: number | null; p1: number | null }[];
  onPick: (row: number, col: number, value: number, slot: number, kind: GradeKind, comment?: string) => void;
  onUpdateMeta: (row: number, col: number, kind: GradeKind, comment: string) => void;
  onRemove: (row: number, col: number, slot: number) => void;
  onAbsent: (row: number, col: number) => void;
  onClearAbsent: (row: number, col: number) => void;
  onOpenPanel: (type: "insight" | "attendance", lessonId: string) => void;
  /** Кандидаты «Кого спросить?» — тот же штамп, что и в развороте. */
  askCandidates: ReadonlySet<string>;
}) {
  const [colIndex, setColIndex] = useState(() => lastPastLessonIndex(lessons));
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [kind, setKind] = useState<GradeKind>("regular");
  const [comment, setComment] = useState("");

  /** Открыть карточку ученика: подхватываем тип и комментарий его оценки. */
  const openStudent = (rowIndex: number) => {
    const grades = gradesAt(rowIndex, colIndex);
    setKind(grades[0]?.kind ?? "regular");
    setComment(grades[0]?.comment ?? "");
    setOpenRow(rowIndex);
  };

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

        {/* Действия урока: перекличка и анализ — открываются нижними листами */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={() => onOpenPanel("attendance", lesson.id)}
              className="focus-ring flex h-11 items-center justify-center gap-1.5 rounded-md border border-input bg-card text-sm font-medium transition-colors hover:bg-accent"
            >
              <ClipboardCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
              Перекличка
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenPanel("insight", lesson.id)}
            className={cn(
              "focus-ring flex h-11 items-center justify-center gap-1.5 rounded-md border border-input bg-card text-sm font-medium transition-colors hover:bg-accent",
              !canEdit && "col-span-2",
            )}
          >
            <BarChart3 className="h-4 w-4 text-muted-foreground" aria-hidden />
            Анализ урока
          </button>
        </div>
      </div>

      <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
        {rows.map((row, rowIndex) => {
          const grades = gradesAt(rowIndex, colIndex);
          const absent = isAbsent(rowIndex, colIndex);
          const isOpen = openRow === rowIndex;

          return (
            <li key={row.studentId}>
              <div className="flex items-center gap-2 p-2.5">
                <Link
                  href={`/journal/students/${row.studentId}`}
                  className="focus-ring min-w-0 flex-1 rounded"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{shortName(row.name)}</span>
                    {askCandidates.has(row.studentId) && (
                      <span className="inline-block shrink-0 -rotate-2 rounded border border-primary/60 px-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                        спросить
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] tabular-nums text-muted-foreground">
                    средний за четверть: {formatAverage(rowStats[rowIndex]?.average ?? null)}
                    {rowStats[rowIndex]?.average != null &&
                      ` · 10→${formatAverage(rowStats[rowIndex]?.p10 ?? null)} · 1→${formatAverage(
                        rowStats[rowIndex]?.p1 ?? null,
                      )}`}
                  </span>
                </Link>

                <button
                  type="button"
                  onClick={() => canEdit && (isOpen ? setOpenRow(null) : openStudent(rowIndex))}
                  disabled={!canEdit}
                  aria-expanded={isOpen}
                  className={cn(
                    "flex h-11 min-w-[3.5rem] shrink-0 items-center justify-center gap-0.5 rounded-md px-1.5 text-base font-bold tabular-nums transition-transform active:scale-95",
                    absent
                      ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100"
                      : grades.length === 0
                        ? "border border-dashed border-input text-muted-foreground"
                        : "",
                    isOpen && "ring-2 ring-primary",
                  )}
                >
                  {absent
                    ? "Н"
                    : grades.length === 0
                      ? "—"
                      : grades.map((grade, index) => (
                          <span key={index} className="flex items-center">
                            {index > 0 && <span className="px-0.5 text-xs opacity-60">/</span>}
                            <span
                              className={cn(
                                "flex h-8 w-8 items-center justify-center rounded",
                                gradeColorClasses(grade.value),
                              )}
                            >
                              {grade.value}
                            </span>
                          </span>
                        ))}
                </button>
              </div>

              {isOpen && canEdit && (
                <div className="animate-fade-in space-y-3 border-t border-rule bg-secondary/40 p-2.5">
                  {/* Тип работы: если оценка уже стоит — правится сразу */}
                  <div className="flex flex-wrap gap-1.5">
                    {GRADE_KIND_KEYS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          setKind(k);
                          if (grades.length > 0) onUpdateMeta(rowIndex, colIndex, k, comment);
                        }}
                        className={cn(
                          "focus-ring rounded-full px-3 py-1 text-xs font-medium",
                          kind === k
                            ? "bg-primary text-primary-foreground"
                            : "bg-card text-muted-foreground ring-1 ring-border",
                        )}
                      >
                        {GRADE_KINDS[k].label}
                      </button>
                    ))}
                  </div>

                  {Array.from({ length: MAX_GRADES_PER_LESSON }).map((_, slot) => {
                    const disabled = slot > grades.length;
                    return (
                      <div key={slot} className={cn(disabled && "opacity-40")}>
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {slot === 0 ? "Оценка" : "Вторая оценка за урок"}
                        </p>
                        <div className="grid grid-cols-5 gap-1.5">
                          {GRADE_BUTTONS.map((grade) => (
                            <button
                              key={grade}
                              type="button"
                              disabled={disabled}
                              onClick={() => onPick(rowIndex, colIndex, grade, slot, kind, comment)}
                              className={cn(
                                "focus-ring h-11 rounded-md text-base font-bold tabular-nums disabled:cursor-not-allowed",
                                gradeColorClasses(grade),
                                grades[slot]?.value === grade && "ring-2 ring-primary",
                              )}
                            >
                              {grade}
                            </button>
                          ))}
                        </div>
                        {grades[slot] !== undefined && (
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

                  {/* Комментарий: сохраняется при потере фокуса и по кнопке «Готово» */}
                  <input
                    type="text"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    onBlur={() => {
                      if (grades.length > 0) onUpdateMeta(rowIndex, colIndex, kind, comment);
                    }}
                    placeholder="Комментарий ученику"
                    maxLength={300}
                    className="focus-ring h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground"
                  />

                  {/* Отметка отсутствия */}
                  <button
                    type="button"
                    onClick={() => {
                      if (absent) onClearAbsent(rowIndex, colIndex);
                      else onAbsent(rowIndex, colIndex);
                      setOpenRow(null);
                    }}
                    className={cn(
                      "focus-ring flex h-10 w-full items-center justify-center gap-1.5 rounded-md text-sm font-medium",
                      absent
                        ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100"
                        : "text-muted-foreground ring-1 ring-border",
                    )}
                  >
                    <UserX className="h-4 w-4" aria-hidden />
                    {absent ? "Снять «Н» (был на уроке)" : "Отметить «Н» (отсутствовал)"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (grades.length > 0) onUpdateMeta(rowIndex, colIndex, kind, comment);
                      setOpenRow(null);
                    }}
                    className="focus-ring flex h-10 w-full items-center justify-center rounded-md bg-secondary text-sm font-semibold"
                  >
                    Готово
                  </button>
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

/**
 * Окно выбора: цифры (две позиции), тип работы, комментарий, «Н».
 *
 * Важно: клик по цифре НЕ закрывает окно. Оценка сохраняется сразу, а «за что»
 * и комментарий учитель дописывает следом — они долетают до уже сохранённой
 * оценки через onUpdateMeta. Пока цифры нет, тип и комментарий ждут в состоянии
 * окна и уходят на сервер вместе с первой же цифрой.
 */
function GradePicker({
  x,
  y,
  grades,
  absent,
  studentName,
  onPick,
  onUpdateMeta,
  onRemove,
  onAbsent,
  onClearAbsent,
  onClose,
}: {
  x: number;
  y: number;
  grades: GridGrade[];
  absent: boolean;
  studentName: string;
  onPick: (value: number, slot: number, kind: GradeKind, comment?: string) => void;
  onUpdateMeta: (kind: GradeKind, comment: string) => void;
  onRemove: (slot: number) => void;
  onAbsent: () => void;
  onClearAbsent: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [showSecond, setShowSecond] = useState(grades.length > 1);
  const [kind, setKind] = useState<GradeKind>(grades[0]?.kind ?? "regular");
  const [comment, setComment] = useState(grades[0]?.comment ?? "");

  /* Свежие значения для обработчиков закрытия: слушатели окна вешаются один
     раз, а комментарий к моменту закрытия уже другой. */
  const draft = useRef({ kind, comment, hasGrades: grades.length > 0 });
  draft.current = { kind, comment, hasGrades: grades.length > 0 };

  /** Досохранить тип и комментарий у уже выставленной оценки. */
  const commitMeta = useCallback(() => {
    const { kind: currentKind, comment: currentComment, hasGrades } = draft.current;
    if (hasGrades) onUpdateMeta(currentKind, currentComment);
  }, [onUpdateMeta]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    /* Закрытие любым способом сначала досохраняет комментарий: учитель мог
       напечатать текст и просто кликнуть мимо окна. */
    function finish() {
      commitMeta();
      onClose();
    }
    function handlePointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) finish();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") finish();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", finish, true);
    window.addEventListener("resize", finish);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", finish, true);
      window.removeEventListener("resize", finish);
    };
  }, [commitMeta, onClose]);

  if (!mounted) return null;

  const saved = grades.length > 0;
  const left = Math.min(Math.max(x, 150), window.innerWidth - 150);
  const top = Math.max(8, Math.min(y, window.innerHeight - 400));

  /** Смена типа: если цифра уже стоит — правим сохранённую оценку немедленно. */
  const pickKind = (next: GradeKind) => {
    setKind(next);
    if (saved) onUpdateMeta(next, comment);
  };

  const digits = (slot: number) => (
    <div className="grid grid-cols-5 gap-1">
      {GRADE_BUTTONS.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onPick(value, slot, kind, comment)}
          className={cn(
            "focus-ring h-9 w-9 rounded text-sm font-bold tabular-nums transition-transform hover:scale-110",
            gradeColorClasses(value),
            grades[slot]?.value === value && "ring-2 ring-primary",
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
      className="animate-pop-in fixed z-50 w-[16.5rem] -translate-x-1/2 rounded-lg border border-rule-strong bg-card p-2.5 shadow-lg"
      style={{ left, top }}
    >
      {studentName && (
        <p className="mb-1.5 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {shortName(studentName)}
        </p>
      )}

      {digits(0)}

      {saved && !showSecond && (
        <button
          type="button"
          onClick={() => setShowSecond(true)}
          className="focus-ring mt-1.5 w-full rounded px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
        >
          + вторая оценка за урок («10/9»)
        </button>
      )}

      {showSecond && (
        <div className="mt-2 border-t border-rule pt-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Вторая оценка
          </p>
          {digits(1)}
        </div>
      )}

      {/* Тип работы — ПОД цифрами: сначала оценка, потом уточняем, за что она */}
      <div className="mt-2 border-t border-rule pt-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          За что
        </p>
        <div className="flex flex-wrap gap-1">
          {GRADE_KIND_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => pickKind(k)}
              className={cn(
                "focus-ring rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                kind === k
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {GRADE_KINDS[k].label}
            </button>
          ))}
        </div>
      </div>

      <input
        type="text"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onBlur={commitMeta}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitMeta();
            onClose();
          }
        }}
        placeholder="Комментарий ученику"
        maxLength={300}
        className="focus-ring mt-2 h-8 w-full rounded-md border border-input bg-card px-2 text-xs text-foreground placeholder:text-muted-foreground"
      />

      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
        {saved
          ? "Тип и комментарий сохраняются сразу — окно можно просто закрыть."
          : "Поставьте оценку — тип и комментарий сохранятся вместе с ней."}
      </p>

      <div className="mt-2 flex items-center gap-1.5 border-t border-rule pt-2">
        {saved && (
          <button
            type="button"
            onClick={() => onRemove(grades.length - 1)}
            className="focus-ring flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden />
            Убрать
          </button>
        )}
        <button
          type="button"
          onClick={absent ? onClearAbsent : onAbsent}
          className={cn(
            "focus-ring flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-xs font-medium",
            absent
              ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          <UserX className="h-3.5 w-3.5" aria-hidden />
          {absent ? "Был" : "Н (нет)"}
        </button>
        <button
          type="button"
          onClick={() => {
            commitMeta();
            onClose();
          }}
          className="focus-ring flex flex-1 items-center justify-center rounded bg-secondary px-2 py-1.5 text-xs font-semibold hover:bg-accent"
        >
          Готово
        </button>
      </div>
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
      title="Переместить урок в корзину"
      loading={pending}
      onClick={() => {
        if (
          !window.confirm(
            "Переместить урок в корзину? Оценки сохранятся и вернутся при восстановлении.",
          )
        )
          return;
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

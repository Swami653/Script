"use client";

import { ClipboardCopy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import type { GridLesson } from "@/app/(app)/journal/journal-grid";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { setLessonHomeworkAction, setLessonPlanAction } from "@/lib/actions/lessons";
import {
  averageColorClasses,
  formatAverage,
  gradeColorClasses,
  MAX_GRADE,
  MIN_GRADE,
  PASSING_MIN_GRADE,
  QUALITY_MIN_GRADE,
  type LessonAnalysis,
} from "@/lib/grades";
import { cn, formatDateShort, shortName } from "@/lib/utils";

/**
 * Единая панель урока, открывается кликом по дате столбца (десктоп) или
 * кнопкой «Анализ урока» (телефон). Сверху блок «Урок»: тема (чтение),
 * «Что задано» и переключатель «Планируется контрольная»; ниже — анализ
 * столбца по live-данным грида (видит оптимистичные оценки).
 *
 * Разметка и правила закрытия — те же, что у AttendanceSheet: origin задан —
 * панель у столбца, null — нижний лист; закрытие «Готово»/Escape/pointerdown
 * вне; на scroll НЕ закрывается.
 */
export function LessonInsight({
  lesson,
  subjectName,
  canEdit,
  origin,
  analysis,
  onFlash,
  onClose,
}: {
  lesson: GridLesson;
  subjectName: string;
  canEdit: boolean;
  /** Координаты якоря у столбца (десктоп) или null — нижний лист (телефон). */
  origin: { x: number; y: number } | null;
  /** Анализ столбца по live-данным грида (analyzeLessonColumn). */
  analysis: LessonAnalysis;
  onFlash: (tone: "success" | "error", text: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  const [draft, setDraft] = useState(lesson.homework ?? "");
  const [homeworkPending, startHomeworkTransition] = useTransition();
  const [planned, setPlanned] = useState(lesson.plannedKind === "control");
  const [planPending, startPlanTransition] = useTransition();

  useEffect(() => setMounted(true), []);

  /* Свежий черновик для обработчиков закрытия: слушатели вешаются один раз,
     а текст задания к моменту закрытия уже другой. */
  const draftRef = useRef({ text: draft, saved: lesson.homework ?? "", id: lesson.id });
  draftRef.current = { text: draft, saved: lesson.homework ?? "", id: lesson.id };

  /**
   * Закрытие любым способом сначала досохраняет задание.
   *
   * Учитель печатает «§12, №431» и кликает мимо панели — текст обязан
   * сохраниться, а не исчезнуть. Кнопка «Сохранить» остаётся для явного
   * подтверждения, но не является единственным способом не потерять работу.
   */
  const closeWithSave = useCallback(() => {
    const { text, saved, id } = draftRef.current;
    if (text.trim() !== saved) {
      void setLessonHomeworkAction({ lessonId: id, homework: text }).then((result) => {
        if (!result.ok) onFlash("error", `${result.status}: ${result.error}`);
        else router.refresh();
      });
    }
    onClose();
  }, [onClose, onFlash, router]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) closeWithSave();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeWithSave();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [closeWithSave]);

  if (!mounted) return null;

  const total = analysis.gradedCount + analysis.absentNames.length + analysis.emptyNames.length;
  const homeworkUnchanged = draft.trim() === (lesson.homework ?? "");

  function saveHomework() {
    startHomeworkTransition(async () => {
      const result = await setLessonHomeworkAction({ lessonId: lesson.id, homework: draft });
      if (!result.ok) {
        onFlash("error", `${result.status}: ${result.error}`);
        return;
      }
      onFlash("success", result.message ?? "Сохранено");
      router.refresh();
    });
  }

  /** Немедленное переключение с откатом при ошибке сервера. */
  function togglePlanned() {
    const next = !planned;
    setPlanned(next);
    startPlanTransition(async () => {
      const result = await setLessonPlanAction({
        lessonId: lesson.id,
        plannedKind: next ? "control" : null,
      });
      if (!result.ok) {
        setPlanned(!next);
        onFlash("error", `${result.status}: ${result.error}`);
        return;
      }
      router.refresh();
    });
  }

  function buildSummary(): string {
    const distributionParts: string[] = [];
    for (let value = MAX_GRADE; value >= MIN_GRADE; value -= 1) {
      const count = analysis.distribution[value - 1] ?? 0;
      if (count > 0) distributionParts.push(`${value}×${count}`);
    }
    return (
      `${subjectName} — ${formatDateShort(lesson.date)}` +
      (lesson.topic ? ` («${lesson.topic}»)` : "") +
      (lesson.plannedKind === "control" ? ", контрольная" : "") +
      `: писали ${analysis.gradedCount} из ${total}, ` +
      `средний ${formatAverage(analysis.average)}, ` +
      `качество (${QUALITY_MIN_GRADE}–${MAX_GRADE}) ${analysis.qualityPercent ?? "—"} %, ` +
      `успеваемость (${PASSING_MIN_GRADE}–${MAX_GRADE}) ${analysis.passingPercent ?? "—"} %, ` +
      `распределение: ${distributionParts.join(", ")}; ` +
      `«Н»: ${analysis.absentNames.map(shortName).join(", ") || "нет"}; ` +
      `без оценки: ${analysis.emptyNames.map(shortName).join(", ") || "нет"}. ` +
      `Проценты — по ученикам.`
    );
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(buildSummary());
      onFlash("success", "Сводка скопирована");
    } catch {
      onFlash("error", "Не удалось скопировать — разрешите доступ к буферу обмена");
    }
  }

  const maxCount = Math.max(...analysis.distribution, 1);

  const content = (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* ── Блок «Урок»: тема, домашнее задание, пометка контрольной ────── */}
        <div className="space-y-2.5 border-b border-rule px-3 py-2.5">
          <p className="text-sm font-semibold">
            {formatDateShort(lesson.date)}
            <span className="font-normal text-muted-foreground">
              {" · "}
              {lesson.topic ?? "тема не указана"}
            </span>
          </p>

          {canEdit && (
            <>
              <div className="space-y-1">
                <label
                  htmlFor={`lesson-homework-${lesson.id}`}
                  className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Что задано
                </label>
                <Textarea
                  id={`lesson-homework-${lesson.id}`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="№431–433, повторить §12"
                  className="min-h-[3.25rem] px-2 py-1.5 text-xs"
                />
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[10px] leading-tight text-muted-foreground">
                    Задание к этому уроку — ученик готовится к этой дате.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={saveHomework}
                    loading={homeworkPending}
                    disabled={homeworkUnchanged}
                  >
                    Сохранить
                  </Button>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={planned}
                onClick={togglePlanned}
                disabled={planPending}
                className="focus-ring flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-sm font-medium transition-opacity disabled:opacity-60"
              >
                Планируется контрольная
                <span
                  aria-hidden
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                    planned ? "bg-primary" : "bg-input",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-card shadow transition-transform",
                      planned ? "translate-x-[1.125rem]" : "translate-x-0.5",
                    )}
                  />
                </span>
              </button>
            </>
          )}
        </div>

        {/* ── Блок «Анализ»: распределение, средний, качество/успеваемость ── */}
        <div className="space-y-2.5 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Анализ урока
          </p>

          {analysis.gradedCount === 0 ? (
            <p className="text-xs text-muted-foreground">
              На этом уроке ещё нет оценок — поставьте первую, и появится распределение.
            </p>
          ) : (
            <>
              <div>
                <div className="flex items-end gap-[3px]">
                  {analysis.distribution.map((count, index) => {
                    const value = index + 1;
                    return (
                      <div key={value} className="flex flex-1 flex-col items-center gap-0.5">
                        <span
                          className={cn(
                            "text-[9px] leading-none tabular-nums",
                            count > 0 ? "text-muted-foreground" : "text-transparent",
                          )}
                        >
                          {count}
                        </span>
                        <div
                          className={cn(
                            "w-full rounded-sm",
                            count > 0 ? gradeColorClasses(value) : "bg-secondary",
                          )}
                          style={{
                            height: count > 0 ? `${8 + Math.round((count / maxCount) * 40)}px` : "3px",
                          }}
                        />
                        <span className="text-[9px] leading-none tabular-nums text-muted-foreground">
                          {value}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
                  Гистограмма и проценты — по ученикам (первая оценка клетки)
                </p>
              </div>

              <div className="space-y-1 text-xs">
                <p>
                  Средний:{" "}
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      averageColorClasses(analysis.average),
                    )}
                  >
                    {formatAverage(analysis.average)}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    — по всем оценкам, как в строке итогов
                  </span>
                </p>
                <p>
                  Качество ({QUALITY_MIN_GRADE}–{MAX_GRADE}):{" "}
                  <span className="font-semibold tabular-nums">{analysis.qualityPercent} %</span>
                  <span aria-hidden> · </span>
                  Успеваемость ({PASSING_MIN_GRADE}–{MAX_GRADE}):{" "}
                  <span className="font-semibold tabular-nums">{analysis.passingPercent} %</span>
                </p>
                <p>
                  Писали <span className="font-semibold tabular-nums">{analysis.gradedCount}</span>{" "}
                  из <span className="font-semibold tabular-nums">{total}</span>
                </p>
                {analysis.absentNames.length > 0 && (
                  <p className="text-muted-foreground">
                    «Н»: {analysis.absentNames.map(shortName).join(", ")}
                  </p>
                )}
                {analysis.emptyNames.length > 0 && (
                  <p className="text-muted-foreground">
                    Без оценки: {analysis.emptyNames.map(shortName).join(", ")}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={copySummary}
                className="focus-ring flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-input bg-card text-xs font-medium transition-colors hover:bg-accent"
              >
                <ClipboardCopy className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                Скопировать сводку
              </button>
            </>
          )}
        </div>
      </div>

      <div className="border-t border-rule p-2">
        <button
          type="button"
          onClick={closeWithSave}
          className="focus-ring flex h-10 w-full items-center justify-center rounded-md bg-secondary text-sm font-semibold transition-colors hover:bg-accent"
        >
          Готово
        </button>
      </div>
    </>
  );

  if (origin) {
    const left = Math.min(Math.max(origin.x, 170), window.innerWidth - 170);
    const top = Math.max(8, Math.min(origin.y, window.innerHeight * 0.3 - 8));
    return createPortal(
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Панель урока"
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
      <div className="fixed inset-0 z-40 bg-black/20" aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Панель урока"
        className="animate-fade-in fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-lg border-t border-rule-strong bg-card shadow-lg"
      >
        {content}
      </div>
    </>,
    document.body,
  );
}

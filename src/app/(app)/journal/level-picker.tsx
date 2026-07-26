"use client";

import { Eraser, UserX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  MASTERY_LEVEL_KEYS,
  MASTERY_LEVELS,
  MAX_STAMPS_PER_LESSON,
  masteryColorClasses,
  STAMP_KIND_KEYS,
  STAMP_KINDS,
  type MasteryLevel,
  type StampKind,
} from "@/lib/gradeless";
import { cn, shortName } from "@/lib/utils";

/**
 * Окно клетки БЕЗОТМЕТОЧНОЙ строки — пара к GradePicker (тот же портал в body,
 * то же позиционирование и закрытие с досохранением комментария).
 *
 * Вместо цифр 1–10 — три уровня освоения (клик не закрывает окно: учитель
 * дописывает комментарий и печати следом) и ряд печатей-тоглов. Уровень
 * НИКОГДА не отображается буквой «Н» — она зарезервирована за отсутствием.
 */
export function LevelPicker({
  x,
  y,
  studentName,
  mastery,
  stamps,
  absent,
  onPickLevel,
  onCommitComment,
  onToggleStamp,
  onClearLevel,
  onAbsent,
  onClearAbsent,
  onClose,
}: {
  x: number;
  y: number;
  studentName: string;
  mastery: { level: MasteryLevel; comment: string | null } | null;
  /** Печати клетки; null — неизвестный вид (не рисуется активным тоглом). */
  stamps: (StampKind | null)[];
  absent: boolean;
  /** Отметить уровень (окно остаётся открытым). */
  onPickLevel: (level: MasteryLevel, comment: string) => void;
  /** Досохранить комментарий у уже отмеченного уровня. */
  onCommitComment: (comment: string) => void;
  onToggleStamp: (kind: StampKind, active: boolean) => void;
  onClearLevel: () => void;
  onAbsent: () => void;
  onClearAbsent: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [comment, setComment] = useState(mastery?.comment ?? "");

  /* Свежие значения для обработчиков закрытия: слушатели окна вешаются один
     раз, а комментарий к моменту закрытия уже другой (паттерн GradePicker). */
  const draft = useRef({ comment, saved: mastery?.comment ?? "", hasLevel: mastery !== null });
  draft.current = { comment, saved: mastery?.comment ?? "", hasLevel: mastery !== null };

  const commitComment = useCallback(() => {
    const { comment: current, saved, hasLevel } = draft.current;
    if (hasLevel && current.trim() !== (saved ?? "")) onCommitComment(current);
  }, [onCommitComment]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function finish() {
      commitComment();
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
  }, [commitComment, onClose]);

  if (!mounted) return null;

  const left = Math.min(Math.max(x, 150), window.innerWidth - 150);
  const top = Math.max(8, Math.min(y, window.innerHeight - 420));

  const activeKinds = new Set(stamps.filter((kind): kind is StampKind => kind !== null));
  const stampLimitReached = activeKinds.size >= MAX_STAMPS_PER_LESSON;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Уровень освоения и печати"
      className="animate-pop-in fixed z-50 w-[17rem] -translate-x-1/2 rounded-lg border border-rule-strong bg-card p-2.5 shadow-lg"
      style={{ left, top }}
    >
      {studentName && (
        <p className="mb-1.5 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {shortName(studentName)}
        </p>
      )}

      {/* Три уровня — слово + глиф, клавиши 1·2·3; выбор окно не закрывает */}
      <div className="space-y-1">
        {MASTERY_LEVEL_KEYS.map((level, index) => (
          <button
            key={level}
            type="button"
            onClick={() => onPickLevel(level, comment)}
            className={cn(
              "focus-ring flex h-11 w-full items-center gap-2 rounded-md px-2.5 text-sm font-semibold transition-transform active:scale-[0.98]",
              masteryColorClasses(level),
              mastery?.level === level && "ring-2 ring-primary",
            )}
          >
            <span aria-hidden className="text-base leading-none">
              {MASTERY_LEVELS[level].glyph}
            </span>
            <span className="flex-1 text-left">{MASTERY_LEVELS[level].label}</span>
            <span className="text-[10px] font-medium opacity-60">{index + 1}</span>
          </button>
        ))}
      </div>

      {/* Печати-поощрения: тоглы, до MAX_STAMPS_PER_LESSON за урок */}
      <div className="mt-2 border-t border-rule pt-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Печати
        </p>
        <div className="flex flex-wrap gap-1">
          {STAMP_KIND_KEYS.map((kind) => {
            const active = activeKinds.has(kind);
            const disabled = absent || (!active && stampLimitReached);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => onToggleStamp(kind, active)}
                disabled={disabled}
                aria-pressed={active}
                title={
                  absent
                    ? "Ученик отмечен отсутствующим — сначала снимите «Н»"
                    : !active && stampLimitReached
                      ? `Не больше ${MAX_STAMPS_PER_LESSON} печатей за урок`
                      : STAMP_KINDS[kind].label
                }
                className={cn(
                  "focus-ring rounded-full border px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  active
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-input bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {STAMP_KINDS[kind].label}
              </button>
            );
          })}
        </div>
      </div>

      <input
        type="text"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onBlur={commitComment}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitComment();
            onClose();
          }
        }}
        placeholder="Комментарий к уровню"
        maxLength={300}
        className="focus-ring mt-2 h-8 w-full rounded-md border border-input bg-card px-2 text-xs text-foreground placeholder:text-muted-foreground"
      />

      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
        {mastery
          ? "Комментарий сохраняется сразу — окно можно просто закрыть."
          : "Отметьте уровень — комментарий сохранится вместе с ним."}
      </p>

      <div className="mt-2 flex items-center gap-1.5 border-t border-rule pt-2">
        {mastery && (
          <button
            type="button"
            onClick={onClearLevel}
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
            commitComment();
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

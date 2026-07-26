"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { MASTERY_LEVELS, masteryColorClasses, type MasteryLevel } from "@/lib/gradeless";
import { cn } from "@/lib/utils";

/** Задержка открытия попапа по наведению — как у GradeChip. */
const HOVER_OPEN_DELAY = 120;

/**
 * Чип уровня освоения в дневнике (безотметочные 1–2 классы): слово-уровень
 * в цветах данных (masteryColorClasses), НИКОГДА не одиночная буква «Н» —
 * она зарезервирована за отсутствием.
 *
 * Механика комментария — та же, что у GradeChip: без комментария — простой
 * span; с комментарием — кнопка с точкой --primary в правом верхнем углу и
 * попапом (hover с задержкой, focus-visible, тап на таче), текст продублирован
 * sr-only для скринридера.
 */
export function LevelChip({
  level,
  comment,
  className,
}: {
  level: MasteryLevel;
  comment: string | null;
  className?: string;
}) {
  const chipClasses = cn(
    "relative inline-flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs font-semibold",
    masteryColorClasses(level),
    className,
  );
  const label = MASTERY_LEVELS[level].label;
  const glyph = MASTERY_LEVELS[level].glyph;

  if (!comment) {
    return (
      <span className={chipClasses} title={MASTERY_LEVELS[level].teacherLabel}>
        <span aria-hidden>{glyph}</span>
        {label}
      </span>
    );
  }

  return <CommentedLevelChip level={level} comment={comment} chipClasses={chipClasses} />;
}

function CommentedLevelChip({
  level,
  comment,
  chipClasses,
}: {
  level: MasteryLevel;
  comment: string;
  chipClasses: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredByMouse = useRef(false);
  const [popup, setPopup] = useState<{ x: number; y: number } | null>(null);

  const open = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPopup({ x: rect.left + rect.width / 2, y: rect.bottom + 6 });
  }, []);

  const close = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setPopup(null);
  }, []);

  useEffect(() => () => void (hoverTimer.current && clearTimeout(hoverTimer.current)), []);

  useEffect(() => {
    if (!popup) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      close();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [popup, close]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Уровень: ${MASTERY_LEVELS[level].label}, есть комментарий`}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") return;
          hoveredByMouse.current = true;
          if (hoverTimer.current) clearTimeout(hoverTimer.current);
          hoverTimer.current = setTimeout(open, HOVER_OPEN_DELAY);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse") return;
          hoveredByMouse.current = false;
          close();
        }}
        onFocus={(event) => {
          if (event.target.matches(":focus-visible")) open();
        }}
        onBlur={close}
        onClick={() => {
          if (hoveredByMouse.current) return;
          if (popup) close();
          else open();
        }}
        className={cn(chipClasses, "focus-ring after:absolute after:-inset-2 after:content-['']")}
      >
        <span aria-hidden>{MASTERY_LEVELS[level].glyph}</span>
        {MASTERY_LEVELS[level].label}
        <span className="sr-only">Комментарий: {comment}</span>
        {/* Точка комментария — правый верхний угол, цвет --primary */}
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-card"
        />
      </button>

      {popup &&
        createPortal(
          <div
            ref={popupRef}
            aria-hidden
            className="animate-pop-in fixed z-50 w-max max-w-[16rem] -translate-x-1/2 rounded-lg border border-rule-strong bg-card p-2.5 shadow-lg"
            style={{
              left: Math.min(Math.max(popup.x, 136), window.innerWidth - 136),
              top: Math.min(popup.y, window.innerHeight - 120),
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {MASTERY_LEVELS[level].label}
            </p>
            <p className="mt-0.5 text-xs">{comment}</p>
          </div>,
          document.body,
        )}
    </>
  );
}

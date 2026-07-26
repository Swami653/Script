"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { gradeColorClasses, GRADE_KINDS, type GradeKind } from "@/lib/grades";
import { cn } from "@/lib/utils";

/** Задержка открытия попапа по наведению — чтобы не мигал при проносе мыши. */
const HOVER_OPEN_DELAY = 120;

/**
 * Чип оценки в дневнике ученика. Язык данных чипа — ТРИ метки (см. DESIGN.md),
 * палитрой интерфейса они не переопределяются:
 *  * точка снизу по центру токовым цветом — «контрольная»;
 *  * точка в правом верхнем углу цветом --primary — «есть комментарий учителя»;
 *  * галочка-подпись в правом НИЖНЕМ углу (muted, ~7px) — «семья видела».
 * Все три могут стоять одновременно — углы не пересекаются.
 *
 * acked/ackStale приходят с сервера (GradeAck): stale означает «оценка
 * изменена после подписи» — галочка меняется на полую, чтобы не выдавать
 * старую подпись за свежую.
 *
 * Без комментария — обычный span (не фокусируемый, title с типом работы).
 * С комментарием — кнопка с попапом: hover (задержка) и focus на десктопе,
 * тап-переключение на таче; текст комментария продублирован sr-only —
 * скринридер получает всё без попапа.
 */
export function GradeChip({
  value,
  kind,
  comment,
  acked = false,
  ackStale = false,
  className,
}: {
  value: number;
  kind: GradeKind;
  comment: string | null;
  /** Есть штамп «Ознакомлен» (в родительском UI — подпись зрителя). */
  acked?: boolean;
  /** Подпись есть, но оценка изменена после неё (seenValue !== value). */
  ackStale?: boolean;
  className?: string;
}) {
  const chipClasses = cn(
    "relative flex h-8 w-9 shrink-0 items-center justify-center rounded text-[15px] font-bold tabular-nums",
    gradeColorClasses(value),
    className,
  );
  const controlDot =
    kind === "control" ? (
      <span
        aria-hidden
        className="absolute bottom-0.5 left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-current opacity-70"
      />
    ) : null;
  const ackMark = acked ? <AckSignature stale={ackStale} /> : null;

  if (!comment) {
    return (
      <span
        className={chipClasses}
        title={`${GRADE_KINDS[kind].label}${
          acked ? (ackStale ? " · изменена после просмотра семьёй" : " · семья видела") : ""
        }`}
      >
        {value}
        {controlDot}
        {ackMark}
      </span>
    );
  }

  return (
    <CommentedChip
      value={value}
      kind={kind}
      comment={comment}
      chipClasses={chipClasses}
      controlDot={controlDot}
      ackMark={ackMark}
    />
  );
}

/**
 * Галочка-подпись «семья видела» — правый нижний угол чипа, ~7px,
 * muted-foreground с opacity 0.6 (не конкурирует с точками КР и комментария).
 * stale — полая (stroke без заливки фона «прочитано свежее»).
 */
function AckSignature({ stale }: { stale: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 8 8"
      className={cn(
        "absolute bottom-0 right-0 h-[7px] w-[7px] text-muted-foreground",
        stale ? "opacity-40" : "opacity-60",
      )}
    >
      <path
        d="M1 4.5 L3 6.5 L7 1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={stale ? 1 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CommentedChip({
  value,
  kind,
  comment,
  chipClasses,
  controlDot,
  ackMark,
}: {
  value: number;
  kind: GradeKind;
  comment: string;
  chipClasses: string;
  controlDot: React.ReactNode;
  ackMark: React.ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Открыт ли попап наведением мыши: тогда клик не должен его переключать. */
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
    // capture: попап через портал, а скроллиться может любой контейнер списка.
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
        aria-label={`Оценка ${value}, есть комментарий`}
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
          /* Тап на Android ставит фокус на кнопку, и открытие по фокусу
             схлопывалось бы последующим click-переключением — попап мигал
             и закрывался, комментарий читался только со второго тапа.
             Клавиатурный фокус (:focus-visible) такого конфликта не даёт. */
          if (event.target.matches(":focus-visible")) open();
        }}
        onBlur={close}
        onClick={() => {
          // Мышь уже открыла попап наведением — клик его не переключает.
          if (hoveredByMouse.current) return;
          if (popup) close();
          else open();
        }}
        className={cn(
          chipClasses,
          // Увеличенная тап-цель вокруг маленького чипа
          "focus-ring after:absolute after:-inset-2 after:content-['']",
        )}
      >
        {value}
        <span className="sr-only">
          {GRADE_KINDS[kind].label}. Комментарий: {comment}
        </span>
        {controlDot}
        {ackMark}
        {/* Точка комментария — правый верхний угол, цвет --primary */}
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-card"
        />
      </button>

      {popup &&
        createPortal(
          // Визуальный дубль sr-only-текста — от чтения скрыт
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
              {GRADE_KINDS[kind].label}
            </p>
            <p className="mt-0.5 text-xs">{comment}</p>
          </div>,
          document.body,
        )}
    </>
  );
}

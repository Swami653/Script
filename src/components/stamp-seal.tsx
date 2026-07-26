import { stampLabel, type StampKind } from "@/lib/gradeless";
import { cn } from "@/lib/utils";

/**
 * Оттиск печати-поощрения (безотметочные 1–2 классы).
 *
 * Визуальный язык — «чернильный штамп» (см. DESIGN.md): скруглённый
 * прямоугольник border-2, uppercase, лёгкий детерминированный наклон.
 * Цвет — чернильный `--primary` через text-primary: печать — мотивационный
 * артефакт интерфейса, ей уместен акцент (масштабирует существующий штамп
 * «спросить»). Появление — существующая animate-ink-settle; глобальный
 * prefers-reduced-motion её глушит (globals.css).
 *
 * kind === null — неизвестный вид из БД (словарь только расширяется):
 * рисуется нейтральная «Печать», ничего не падает.
 */

/** Детерминированный наклон −3..3° по id: лента печатей выглядит «проштампованной», а не сгенерированной. */
function seededRotation(seed: string | undefined): number {
  if (!seed) return -2;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return (Math.abs(hash) % 7) - 3;
}

/** Полный оттиск — лента «Листа печатей» в дневнике. */
export function StampSeal({
  kind,
  seed,
  muted = false,
  className,
}: {
  kind: StampKind | null;
  /** Источник детерминированного наклона (обычно id записи). */
  seed?: string;
  /** Полупрозрачный образец для пустого состояния. */
  muted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "animate-ink-settle inline-flex select-none items-center justify-center rounded border-2 border-primary/60 px-2 py-1 text-center text-[10px] font-bold uppercase leading-tight tracking-wide text-primary",
        muted && "border-primary/30 text-primary/40",
        className,
      )}
      style={{ transform: `rotate(${seededRotation(seed)}deg)` }}
    >
      {stampLabel(kind)}
    </span>
  );
}

/**
 * Мини-оттиск 12 px — уголок клетки журнала и счётчики. Текст в 12 px
 * нечитаем, поэтому рисуется рамка-оттиск с первой буквой вида;
 * полное название — в title.
 */
export function StampSealMini({
  kind,
  seed,
  className,
}: {
  kind: StampKind | null;
  seed?: string;
  className?: string;
}) {
  const label = stampLabel(kind);
  return (
    <span
      aria-hidden
      title={label}
      className={cn(
        "inline-flex h-3 w-3 shrink-0 select-none items-center justify-center rounded-[3px] border border-primary/60 text-[7px] font-bold uppercase leading-none text-primary",
        className,
      )}
      style={{ transform: `rotate(${seededRotation(seed)}deg)` }}
    >
      {label.charAt(0)}
    </span>
  );
}

import { cn } from "@/lib/utils";

/**
 * Штамп «ЗАКРЫТА» — знак закрытой четверти (журнал, мастер «Итоги четверти»).
 *
 * Рисуется как чернильная печать: двойное кольцо, лёгкий наклон (-rotate-6),
 * цвет — currentColor в обёртке text-primary/80 (чернильный, НЕ --destructive:
 * закрытие — норма процесса, а не тревога; см. DESIGN.md). Оба размера из
 * дизайн-конвенции: sm ≈ 44 px для строки-статуса, md ≈ 72 px для мастера.
 */
export function ClosedStamp({
  dateLabel,
  size = "md",
  className,
}: {
  /** Дата закрытия в готовом виде («05.11») — попадает в печать и aria-label. */
  dateLabel: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const px = size === "sm" ? 44 : 72;
  return (
    <span
      role="img"
      aria-label={`Четверть закрыта ${dateLabel}`}
      className={cn("inline-flex shrink-0 -rotate-6 select-none text-primary/80", className)}
    >
      <svg width={px} height={px} viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="4" />
        <circle cx="50" cy="50" r="39" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <text
          x="50"
          y="49"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="currentColor"
          style={{ fontSize: 14, fontWeight: 800, letterSpacing: 1.2 }}
        >
          ЗАКРЫТА
        </text>
        <text
          x="50"
          y="66"
          textAnchor="middle"
          fill="currentColor"
          style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
        >
          {dateLabel}
        </text>
      </svg>
    </span>
  );
}

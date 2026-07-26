"use client";

import { HelpCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  clearTopicConfusionAction,
  markTopicConfusionAction,
} from "@/lib/actions/confusion";
import { cn } from "@/lib/utils";

/**
 * Тихая кнопка ученика «не разобрался в теме» — переключатель: нажал — попросил
 * объяснить ещё раз, нажал снова — снял просьбу.
 *
 * Формулировки БЕЗ СТЫДА: это просьба, а не жалоба и не признание вины,
 * поэтому никакого красного, никаких «ошибка/плохо» — в покое кнопка
 * muted-toned, отмеченная — спокойный чернильный --primary (язык действий,
 * DESIGN.md). Подпись прямо обещает приватность («видит только учитель»):
 * без этого обещания на кнопку не нажмут.
 *
 * Для безотметочного класса (1–2, ребёнок 7 лет) — свои короткие слова:
 * «Мне непонятно» / «Учитель объяснит ещё раз».
 *
 * Состояние оптимистичное с откатом (прецедент toggleStamp в журнале):
 * override поверх серверного значения, ошибка возвращает как было.
 */
export function ConfusionToggle({
  lessonId,
  confused,
  gradeless,
}: {
  lessonId: string;
  /** Серверное значение: отметка уже стоит. */
  confused: boolean;
  /** Безотметочный ученик (1–2 класс) — слова для семилетки. */
  gradeless: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** Оптимистичное значение поверх серверного; null — верим серверу. */
  const [override, setOverride] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const marked = override ?? confused;

  function toggle() {
    const next = !marked;
    setOverride(next);
    setError(null);
    startTransition(async () => {
      const result = next
        ? await markTopicConfusionAction({ lessonId })
        : await clearTopicConfusionAction({ lessonId });
      if (!result.ok) {
        setOverride(!next);
        setError(`${result.status}: ${result.error}`);
        return;
      }
      router.refresh();
    });
  }

  const label = gradeless
    ? marked
      ? "Учитель объяснит ещё раз"
      : "Мне непонятно"
    : marked
      ? "Попросили объяснить ещё раз"
      : "Не разобрался в теме";

  const title = gradeless
    ? marked
      ? "Уже понятно? Нажми ещё раз — отметка исчезнет."
      : "Нажми, если тема непонятна, — учитель увидит и объяснит ещё раз. Это видит только учитель."
    : marked
      ? "Уже разобрались? Нажмите ещё раз — просьба снимется."
      : "Попросить учителя объяснить эту тему ещё раз. Видит только учитель — не одноклассники и не родители.";

  return (
    <span className="mt-1 block">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={marked}
        title={title}
        className={cn(
          "focus-ring inline-flex min-h-7 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-60",
          marked
            ? "font-medium text-primary hover:bg-primary/10"
            : "text-muted-foreground/80 hover:bg-accent hover:text-foreground",
        )}
      >
        <HelpCircle className="h-3 w-3 shrink-0" aria-hidden />
        {label}
      </button>
      {error && (
        <span className="block pl-1.5 text-[11px] text-destructive">{error}</span>
      )}
    </span>
  );
}

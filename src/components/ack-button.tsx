"use client";

import { Check, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Flash, useFlash } from "@/components/flash";
import { ackGradesAction } from "@/lib/actions/family";
import { cn } from "@/lib/utils";

/**
 * Кнопка «Ознакомлен» — подпись родителя под оценкой. Тап-цель ≥44px
 * (родитель читает с телефона). После подписи — «чернила легли»
 * (animate-ink-settle) и router.refresh(): состояние приходит с сервера.
 *
 * acked/stale приходят с сервера: подписанная и не изменившаяся оценка
 * рисуется тихой галочкой, изменённая после подписи — кнопкой «Ознакомлен»
 * с пометкой (повторная подпись переподписывает снимок seenValue).
 */
export function AckButton({
  gradeIds,
  acked = false,
  stale = false,
  className,
}: {
  gradeIds: string[];
  acked?: boolean;
  stale?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const { flash, show, clear } = useFlash();
  const [pending, startTransition] = useTransition();
  const [justAcked, setJustAcked] = useState(false);

  const done = justAcked || (acked && !stale);

  function handleAck() {
    startTransition(async () => {
      const result = await ackGradesAction({ gradeIds });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      setJustAcked(true);
      router.refresh();
    });
  }

  if (done) {
    return (
      <span
        className={cn(
          "animate-ink-settle inline-flex min-h-11 items-center gap-1 px-2 text-xs font-medium text-muted-foreground",
          className,
        )}
        title="Вы отметили, что видели эту оценку"
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
        Ознакомлен
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleAck}
        disabled={pending}
        className={cn(
          "focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-md border border-primary/40 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50",
          className,
        )}
        title={
          stale
            ? "Оценка изменена после вашей подписи — подпишите заново"
            : "Отметить, что вы видели эту оценку"
        }
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
        Ознакомлен
        {stale && <span className="font-normal text-muted-foreground">заново</span>}
      </button>
      <Flash message={flash} onClose={clear} />
    </>
  );
}

/** «Ознакомлен со всем новым»: одна подпись на все непросмотренные оценки. */
export function AckAllButton({
  gradeIds,
  className,
}: {
  gradeIds: string[];
  className?: string;
}) {
  const router = useRouter();
  const { flash, show, clear } = useFlash();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  if (gradeIds.length === 0 || done) return null;

  function handleAckAll() {
    startTransition(async () => {
      const result = await ackGradesAction({ gradeIds });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      setDone(true);
      show("success", result.message ?? "Отмечено");
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleAckAll}
        disabled={pending}
        className={cn(
          "focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50",
          className,
        )}
      >
        <CheckCheck className="h-4 w-4" aria-hidden />
        Ознакомлен со всем новым ({gradeIds.length})
      </button>
      <Flash message={flash} onClose={clear} />
    </>
  );
}

"use client";

import { CheckCircle2, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type FlashMessage = { tone: "success" | "error"; text: string } | null;

/** Простые всплывающие уведомления без внешних зависимостей. */
export function useFlash(timeout = 4000) {
  const [flash, setFlash] = useState<FlashMessage>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (tone: "success" | "error", text: string) => {
      setFlash({ tone, text });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFlash(null), tone === "error" ? timeout * 2 : timeout);
    },
    [timeout],
  );

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setFlash(null);
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return { flash, show, clear };
}

export function Flash({ message, onClose }: { message: FlashMessage; onClose: () => void }) {
  if (!message) return null;

  const Icon = message.tone === "success" ? CheckCircle2 : ShieldAlert;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "animate-fade-in fixed bottom-5 right-5 z-[60] flex max-w-sm items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg",
        message.tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950 dark:text-emerald-100"
          : "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-950 dark:text-rose-100",
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1">{message.text}</span>
      <button
        type="button"
        onClick={onClose}
        className="focus-ring rounded p-0.5 opacity-60 hover:opacity-100"
        aria-label="Закрыть уведомление"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

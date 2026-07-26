"use client";

import { useEffect, useState } from "react";

/** 12.09.2025, 14:35 — в часовом поясе БРАУЗЕРА. */
function formatLocal(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** То же, но в UTC — одинаково на сервере и при первом рендере клиента. */
function formatUtc(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}, ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}

/**
 * Момент действия в журнале изменений. createdAt — настоящий момент времени
 * (а не «полночь UTC», как даты уроков), поэтому серверный рендер показывает
 * UTC, а после гидратации значение заменяется на местное время пользователя.
 */
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState(() => formatUtc(iso));

  useEffect(() => {
    setText(formatLocal(iso));
  }, [iso]);

  return <time dateTime={iso}>{text}</time>;
}

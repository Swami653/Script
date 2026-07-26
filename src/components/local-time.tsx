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

/** «05.11.2025» — только дата, в поясе БРАУЗЕРА. */
function formatLocalDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** То же в UTC — совпадает на сервере и при первом рендере клиента. */
function formatUtcDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/**
 * Дата настоящего момента (закрытие четверти, снятие долга) строкой — там,
 * где компонент не вставить: например, внутрь SVG-штампа.
 *
 * Двухфазность та же, что у LocalTime: первый рендер — UTC (сервер и клиент
 * совпадают, гидратация не рушится), после эффекта — местный пояс. Без этого
 * закрытие четверти в час ночи по Москве датировалось бы вчерашним днём.
 */
export function LocalDate({ iso }: { iso: string }) {
  const text = useLocalDateLabel(iso);
  return <time dateTime={iso}>{text}</time>;
}

export function useLocalDateLabel(iso: string): string {
  const [text, setText] = useState(() => formatUtcDate(iso));

  useEffect(() => {
    setText(formatLocalDate(iso));
  }, [iso]);

  return text;
}

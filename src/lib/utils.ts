import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

/**
 * Даты уроков хранятся как полночь UTC (см. src/lib/actions/lessons.ts),
 * поэтому форматируем их тоже в UTC — иначе в браузере с отрицательным
 * смещением 05.09 превратилось бы в 04.09.
 */

/** 05.09 — компактная подпись столбца журнала. */
export function formatDateShort(date: Date | string): string {
  const d = new Date(date);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 5 сен 2025 */
export function formatDateLong(date: Date | string): string {
  const d = new Date(date);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Дата в формате input[type=date] — YYYY-MM-DD. */
export function toDateInputValue(date: Date | string): string {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** Строка "YYYY-MM-DD" -> Date в полночь UTC. Бросает ошибку на некорректном вводе. */
export function parseDateInputValue(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("Некорректная дата (ожидается формат ГГГГ-ММ-ДД)");
  const date = new Date(`${value.trim()}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Некорректная дата");
  return date;
}

/** "Иванов Иван Иванович" -> "ИИ" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

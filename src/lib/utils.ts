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

/** Короткие названия дней недели. Индексация совпадает с Date.getUTCDay(): 0 — вс. */
export const WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"] as const;

/** «пт» — день недели UTC-датой (локальные getDay() запрещены — дата поедет). */
export function formatWeekdayShort(date: Date | string): string {
  return WEEKDAYS_SHORT[new Date(date).getUTCDay()]!;
}

/** date + days суток (полуночи UTC остаются полуночами UTC). */
export function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Целых суток между полуночами UTC: a − b. */
export function diffUtcDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/**
 * Сегодняшняя полночь UTC — единый предикат «прошедший урок» для всего
 * интерфейса. Осознанная норма проекта: границу «сегодня» считаем по UTC,
 * как и даты уроков, а не по локальному времени браузера.
 */
export function todayUtcMidnight(): Date {
  return parseDateInputValue(toDateInputValue(new Date()));
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

/**
 * Русские числительные: 1 ученик, 2 ученика, 5 учеников.
 * Без этого интерфейс говорит «1 администраторов».
 */
export function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

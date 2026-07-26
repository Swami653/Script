/**
 * Экспорт таблиц в CSV, который корректно открывается в Excel:
 *  * разделитель «;» (европейская локаль Excel),
 *  * BOM в начале файла — чтобы кириллица не превращалась в «????».
 */

const SEPARATOR = ";";

function escapeCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[";\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(
  headers: readonly (string | number)[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const lines = [headers.map(escapeCell).join(SEPARATOR)];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(SEPARATOR));
  }
  return lines.join("\r\n");
}

/** Добавляет BOM — без него Excel неверно определяет кодировку. */
export function withBom(csv: string): string {
  return `﻿${csv}`;
}

/** Скачивание CSV в браузере (только для клиентских компонентов). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([withBom(csv)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

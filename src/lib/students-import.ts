/**
 * Утилиты массового импорта учеников: разбор списка ФИО и транслитерация в логин.
 *
 * ВАЖНО: модуль изоморфный — он импортируется и в Server Action, и в клиентском
 * компоненте (живой предпросмотр списка), поэтому здесь НЕ должно быть
 * серверных зависимостей (node:crypto и т.п.). Генерация паролей — в src/lib/password.ts.
 */

const TRANSLIT_MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  // белорусские и украинские буквы
  і: "i", ў: "u", ї: "yi", є: "ye", ґ: "g",
};

export function transliterate(input: string): string {
  return input
    .toLowerCase()
    .split("")
    .map((char) => {
      if (char in TRANSLIT_MAP) return TRANSLIT_MAP[char];
      if (/[a-z0-9]/.test(char)) return char;
      return "";
    })
    .join("");
}

/**
 * Разбирает произвольный текст со списком ФИО.
 * Поддерживает разделители: перевод строки, запятая, точка с запятой, табуляция.
 * Убирает нумерацию («1.», «2)», «-») и лишние пробелы, отбрасывает дубликаты.
 */
export function parseStudentNames(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const chunk of raw.split(/[\n\r,;\t]+/)) {
    const name = chunk
      .replace(/^\s*[-–—•*]\s*/, "")
      .replace(/^\s*\d+\s*[.)]\s*/, "")
      .replace(/\s+/g, " ")
      .trim();

    if (name.length < 2) continue;
    if (!/[A-Za-zА-Яа-яЁёІіЎўЇїЄє]/.test(name)) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }

  return result;
}

/**
 * Логин из ФИО: «Иванов Иван Иванович» -> «ivanov.i.i@school.com».
 * `taken` — множество уже занятых e-mail (в нижнем регистре); при конфликте
 * добавляется числовой суффикс.
 */
export function buildStudentEmail(
  fullName: string,
  taken: Set<string>,
  domain = "school.com",
): string {
  const parts = fullName.split(/\s+/).filter(Boolean);
  const surname = transliterate(parts[0] ?? "") || "student";
  const initials = parts
    .slice(1, 3)
    .map((part) => transliterate(part).charAt(0))
    .filter(Boolean);

  const base = [surname, ...initials].filter(Boolean).join(".");
  let candidate = `${base}@${domain}`;
  let counter = 2;

  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base}${counter}@${domain}`;
    counter += 1;
  }

  taken.add(candidate.toLowerCase());
  return candidate;
}

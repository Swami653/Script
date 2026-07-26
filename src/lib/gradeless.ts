import { z } from "zod";

/**
 * Безотметочное обучение в 1–2 классах.
 *
 * Изоморфный модуль (без prisma, React и server-only импортов — прецеденты
 * students-import.ts и audit-actions.ts): признак безотметочного класса,
 * словари печатей и уровней освоения, zod-схемы и чистые функции анализа.
 * Единственный источник правды для сервера, клиента и мастера итогов.
 *
 * ПРАВИЛА ДАННЫХ (нарушение — ошибка ревью):
 *  * Уровень освоения — НЕ оценка. Он НИКОГДА не конвертируется в балл
 *    (никаких high→8): в MASTERY_LEVELS нет и не будет числового значения
 *    или веса, а таблицы LessonStamp/MasteryMark/QuarterNote не попадают
 *    в weightedAverage / yearGrade / quarterMark / classSummary.
 *  * Уровень НИКОГДА не отображается одиночной буквой «Н» — эта буква в
 *    клетке зарезервирована за отсутствием (Absence). В интерфейсе уровень —
 *    глиф ●/◐/○ или слово, в CSV — полное слово («нужна помощь», не «Н»).
 *  * Словари печатей и уровней в v1 зафиксированы; в будущем виды печатей
 *    только ДОБАВЛЯЮТСЯ (правило GRADE_KINDS), с защитным чтением неизвестных.
 */

/** Классы с ведущим номером 1..GRADELESS_MAX_CLASS_NUMBER ведутся без отметок. */
export const GRADELESS_MAX_CLASS_NUMBER = 2;

/**
 * Ведущее число названия класса: «1А» → 1, «2-Б» → 2, «10А» → 10, «11Б» → 11.
 * Читается ВСЯ ведущая группа цифр, а не первый символ — иначе «10А» дал бы 1
 * и старшие классы стали бы безотметочными. NFKC приводит полноширинные цифры
 * («１А») к обычным. null — пусто, не строка или не начинается с цифры.
 *
 * Таблица тестов (фиксируется здесь до появления тест-раннера):
 *   «1А» → 1 · «2-Б» → 2 · «1 А» → 1 · « 2б » → 2 · «01А» → 1 ·
 *   «１А» (полноширинная) → 1 · «3В» → 3 · «10А» → 10 · «11Б» → 11 ·
 *   «0» → 0 · «» / «   » → null · null / undefined → null ·
 *   «первый» → null · «К1» → null · строка из 20+ цифр → null (не safe integer).
 */
export function classLeadingNumber(className: string | null | undefined): number | null {
  if (typeof className !== "string") return null;
  const match = className.normalize("NFKC").trim().match(/^(\d+)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Безотметочный ли класс. Неразборчивое название (null, «», «первый», «К1»)
 * считается ОБЫЧНЫМ классом: система по умолчанию оценочная, безотметочность
 * включается только явным ведущим номером 1 или 2. Ложная безотметочность
 * ЗАПРЕТИЛА бы учителю ставить оценки (сервер отклонит запись) — ложная
 * оценочность лишь показывает прочерки; асимметрия ущерба диктует дефолт.
 *
 * По той же таблице тестов: true — «1А», «2-Б», «1 А», « 2б », «01А», «１А»;
 * false — «3В», «10А», «11Б», «0», «», null, «первый», «К1».
 */
export function isGradelessClassName(className: string | null | undefined): boolean {
  const leading = classLeadingNumber(className);
  return leading !== null && leading >= 1 && leading <= GRADELESS_MAX_CLASS_NUMBER;
}

/**
 * Печати-поощрения за урок. Ключ хранится в LessonStamp.kind (без CHECK в БД:
 * словарь расширяемый, прецедент Grade.kind). Порядок ключей = порядок
 * отображения. Виды только добавляются — удаление осиротило бы старые записи.
 */
export const STAMP_KINDS = {
  well_done: { label: "Молодец" },
  diligence: { label: "Старание" },
  breakthrough: { label: "Прорыв" },
  helper: { label: "Помог однокласснику" },
  curiosity: { label: "Любознательность" },
  neatness: { label: "Аккуратность" },
} as const;

export type StampKind = keyof typeof STAMP_KINDS;

export const STAMP_KIND_KEYS = Object.keys(STAMP_KINDS) as StampKind[];

/**
 * Сколько печатей помещается в клетку журнала. Прецедент MAX_GRADES_PER_LESSON:
 * клетка обязана оставаться читаемой, а награда — редкой, иначе обесценится.
 */
export const MAX_STAMPS_PER_LESSON = 2;

export function isStampKind(value: unknown): value is StampKind {
  return typeof value === "string" && value in STAMP_KINDS;
}

/** Защитное чтение из БД: неизвестный вид → null, UI рисует нейтральную «Печать». */
export function asStampKind(value: unknown): StampKind | null {
  return isStampKind(value) ? value : null;
}

/** Подпись печати для интерфейса; для неизвестного вида — нейтральная «Печать». */
export function stampLabel(kind: StampKind | null): string {
  return kind ? STAMP_KINDS[kind].label : "Печать";
}

/**
 * Уровни освоения. Порядок ключей = порядок отображения и клавиши 1·2·3.
 * label — язык ученика, teacherLabel — язык учителя, glyph — знак в клетке.
 * Числового значения НЕТ НАМЕРЕННО — уровень не конвертируется в балл.
 */
export const MASTERY_LEVELS = {
  high: { label: "Усвоил", teacherLabel: "Высокий", glyph: "●" },
  medium: { label: "Усваивает", teacherLabel: "Средний", glyph: "◐" },
  low: { label: "Нужна помощь", teacherLabel: "Низкий", glyph: "○" },
} as const;

export type MasteryLevel = keyof typeof MASTERY_LEVELS;

export const MASTERY_LEVEL_KEYS = Object.keys(MASTERY_LEVELS) as MasteryLevel[];

export function isMasteryLevel(value: unknown): value is MasteryLevel {
  return typeof value === "string" && value in MASTERY_LEVELS;
}

/** Защитное чтение из БД: неизвестный уровень → null (клетка рисуется пустой). */
export function asMasteryLevel(value: unknown): MasteryLevel | null {
  return isMasteryLevel(value) ? value : null;
}

export const stampKindSchema = z.string().refine(isStampKind, "Неизвестная печать");

export const masteryLevelSchema = z
  .string()
  .refine(isMasteryLevel, "Неизвестный уровень освоения");

export const QUARTER_NOTE_MAX_LENGTH = 600;

export const quarterNoteTextSchema = z
  .string()
  .trim()
  .max(
    QUARTER_NOTE_MAX_LENGTH,
    `Характеристика — не длиннее ${QUARTER_NOTE_MAX_LENGTH} символов`,
  );

/** Банк готовых фраз характеристики — чипы в мастере, клик дописывает через «; ». */
export const PHRASE_BANK: readonly string[] = [
  "читает уверенно",
  "читает по слогам",
  "считает в пределах 20 без ошибок",
  "считает с ошибками в пределах 20",
  "пишет аккуратно",
  "пишет аккуратно, но медленно",
  "активно работает на уроке",
  "нуждается в помощи при самостоятельной работе",
  "старается, виден прогресс",
  "легко пересказывает текст",
];

/**
 * Цвета уровней — язык ДАННЫХ (как gradeColorClasses), палитрой интерфейса
 * не переопределяются: high — emerald, medium — amber, low — rose; те же
 * цветовые семьи и подложки прозрачности 20 в тёмной теме, что у шкалы
 * оценок. gradeColorClasses НЕ переиспользуется и НЕ меняется: шкала
 * уровней — не подмножество шкалы 1–10.
 */
export function masteryColorClasses(level: MasteryLevel | null): string {
  if (level === "high")
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200";
  if (level === "medium")
    return "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-100";
  if (level === "low")
    return "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200";
  return "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500";
}

/** Итог анализа столбца безотметочного урока (панель «Анализ урока»). */
export type GradelessColumnAnalysis = {
  /** Сколько учеников на каком уровне. */
  levelCounts: Record<MasteryLevel, number>;
  /** Учеников с отмеченным уровнем. */
  markedCount: number;
  /** Всего печатей за урок. */
  stampCount: number;
  /** ФИО с отметкой «Н». */
  absentNames: string[];
  /** ФИО без уровня и без «Н». */
  emptyNames: string[];
};

/**
 * Анализ столбца безотметочного урока — аналог analyzeLessonColumn, но без
 * средних и процентов: уровни не числа, «средний уровень класса» не существует.
 * Чистая функция; живёт здесь, а не в grades.ts (grades.ts — только баллы).
 */
export function analyzeGradelessColumn(
  students: readonly {
    name: string;
    level: MasteryLevel | null;
    absent: boolean;
    stamps: number;
  }[],
): GradelessColumnAnalysis {
  const levelCounts: Record<MasteryLevel, number> = { high: 0, medium: 0, low: 0 };
  const absentNames: string[] = [];
  const emptyNames: string[] = [];
  let markedCount = 0;
  let stampCount = 0;

  for (const student of students) {
    stampCount += student.stamps;
    if (student.level !== null) {
      markedCount += 1;
      levelCounts[student.level] += 1;
    } else if (student.absent) {
      absentNames.push(student.name);
    } else {
      emptyNames.push(student.name);
    }
  }

  return { levelCounts, markedCount, stampCount, absentNames, emptyNames };
}

/** Компактная сводка уровней: «●7 ◐3 ○1» (нулевые уровни пропускаются). */
export function formatLevelCounts(counts: Record<MasteryLevel, number>): string {
  const parts = MASTERY_LEVEL_KEYS.filter((level) => counts[level] > 0).map(
    (level) => `${MASTERY_LEVELS[level].glyph}${counts[level]}`,
  );
  return parts.join(" ");
}

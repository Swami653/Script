import { z } from "zod";

/**
 * Правила предметной области «Электронный журнал».
 *
 *  1. Система оценок — 10-балльная: допустимы ТОЛЬКО целые числа от 1 до 10.
 *  2. Учебный год состоит из 4 четвертей: 1, 2, 3, 4.
 *  3. Средний балл за четверть округляется до сотых (например, 7.45).
 *  4. Годовая оценка = среднее арифметическое средних баллов четвертей,
 *     округлённое до целого от 1 до 10 (0.5 округляется вверх).
 *
 * Эти константы и схемы — единственный источник правды. Любая валидация
 * оценки на сервере обязана проходить через gradeValueSchema.
 */

export const MIN_GRADE = 1;
export const MAX_GRADE = 10;
export const QUARTERS = [1, 2, 3, 4] as const;

/**
 * Сколько оценок помещается в одну клетку журнала.
 * За контрольную учитель иногда ставит две оценки — «10/9». Это ДВЕ отдельные
 * оценки за один урок, а не дробная: каждая по-прежнему целая от 1 до 10
 * и каждая отдельно участвует в среднем балле.
 */
export const MAX_GRADES_PER_LESSON = 2;

/**
 * Сколько оценок можно выставить за одно массовое действие («оценка всему классу»).
 *
 * Константа общая для сервера и интерфейса намеренно: панель массового
 * выставления обязана знать тот же предел, что и схема проверки, иначе она
 * предлагала бы учителю действие, заведомо обречённое на отказ сервера.
 */
export const MAX_BULK_GRADES = 100;

export type Quarter = (typeof QUARTERS)[number];

/**
 * Типы работ — пометка «за что выставлена оценка». В средний балл ВСЕ типы
 * входят с одинаковым весом 1, то есть средний — обычное арифметическое.
 * Поле Grade.weight и функция weightedAverage оставлены как механизм на
 * будущее: вес по-прежнему денормализуется при выставлении, а при равных
 * весах взвешенная формула даёт то же обычное среднее.
 */
export const GRADE_KINDS = {
  regular: { label: "Текущая", short: "Тек", weight: 1 },
  oral: { label: "Устный ответ", short: "Устн", weight: 1 },
  homework: { label: "Домашняя работа", short: "Дом", weight: 1 },
  control: { label: "Контрольная", short: "КР", weight: 1 },
} as const;

export type GradeKind = keyof typeof GRADE_KINDS;

export const GRADE_KIND_KEYS = Object.keys(GRADE_KINDS) as GradeKind[];

export function isGradeKind(value: unknown): value is GradeKind {
  return typeof value === "string" && value in GRADE_KINDS;
}

/** Безопасно приводит строку из БД к типу работы (по умолчанию — текущая). */
export function asGradeKind(value: unknown): GradeKind {
  return isGradeKind(value) ? value : "regular";
}

/** Вес по типу работы — единственный источник правды при записи оценки. */
export function weightForKind(kind: GradeKind): number {
  return GRADE_KINDS[kind].weight;
}

export const gradeKindSchema = z
  .string()
  .refine(isGradeKind, "Неизвестный тип работы");

/** Оценка: целое число строго 1..10. */
export const gradeValueSchema = z
  .number({ invalid_type_error: "Оценка должна быть числом" })
  .int("Оценка должна быть целым числом")
  .min(MIN_GRADE, `Минимальная оценка — ${MIN_GRADE}`)
  .max(MAX_GRADE, `Максимальная оценка — ${MAX_GRADE}`);

/** Позиция оценки в клетке: 0 — первая, 1 — вторая. */
export const gradeSlotSchema = z
  .number({ invalid_type_error: "Позиция оценки должна быть числом" })
  .int("Позиция оценки должна быть целым числом")
  .min(0, "Позиция оценки должна быть от 0")
  .max(MAX_GRADES_PER_LESSON - 1, `За один урок можно поставить не больше ${MAX_GRADES_PER_LESSON} оценок`);

/** Четверть: целое число строго 1..4. */
export const quarterSchema = z
  .number({ invalid_type_error: "Четверть должна быть числом" })
  .int("Четверть должна быть целым числом")
  .min(1, "Четверть должна быть от 1 до 4")
  .max(4, "Четверть должна быть от 1 до 4");

export function isValidGradeValue(value: unknown): value is number {
  return gradeValueSchema.safeParse(value).success;
}

export function isValidQuarter(value: unknown): value is Quarter {
  return quarterSchema.safeParse(value).success;
}

/** Округление до нужного числа знаков без ошибок плавающей точки. */
export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Средний балл за четверть — среднее арифметическое оценок,
 * округлённое до сотых. Возвращает null, если оценок нет.
 */
export function averageGrade(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return roundTo(sum / values.length, 2);
}

/**
 * Взвешенный средний балл: sum(оценка × вес) / sum(вес), округление до сотых.
 * Сейчас все веса равны 1, поэтому формула даёт обычное среднее арифметическое;
 * механизм оставлен на случай возврата разных весов. Возвращает null, если
 * оценок нет.
 */
export function weightedAverage(
  items: readonly { value: number; weight: number }[],
): number | null {
  if (items.length === 0) return null;
  let weighted = 0;
  let total = 0;
  for (const { value, weight } of items) {
    const w = weight > 0 ? weight : 1;
    weighted += value * w;
    total += w;
  }
  if (total === 0) return null;
  return roundTo(weighted / total, 2);
}

/** «% качества» — доля писавших учеников с оценкой QUALITY_MIN_GRADE..10. */
export const QUALITY_MIN_GRADE = 7;
/** «% успеваемости» — доля писавших учеников с оценкой PASSING_MIN_GRADE..10. */
export const PASSING_MIN_GRADE = 4;

/** Итог анализа одного столбца журнала (панель «Анализ урока»). */
export type LessonAnalysis = {
  /** Длина 10, индекс = оценка − 1. По оценке СЛОТА 0 каждого писавшего ученика. */
  distribution: number[];
  /** По ВСЕМ оценкам столбца (обе половинки «10/9») — совпадает со строкой итогов. */
  average: number | null;
  /** Целые проценты (roundTo(x, 0)); null, если никто не писал. База — gradedCount. */
  qualityPercent: number | null;
  passingPercent: number | null;
  /** Писавших: учеников с хотя бы одной оценкой за урок. */
  gradedCount: number;
  /** ФИО с отметкой «Н». */
  absentNames: string[];
  /** ФИО без оценки и без «Н». */
  emptyNames: string[];
};

/**
 * Анализ одного столбца журнала. grades каждого ученика — по возрастанию слота.
 *
 * Две базы подсчёта — намеренно разные:
 *  * средний — по ВСЕМ оценкам столбца (иначе он разошёлся бы со строкой
 *    итогов журнала, которая считает обе половинки «10/9»);
 *  * гистограмма и проценты качества/успеваемости — по УЧЕНИКАМ (оценка
 *    слота 0): вторая половинка «10/9» не должна удваивать одного ученика.
 * Средний — делегированием weightedAverage (формула не дублируется).
 */
export function analyzeLessonColumn(
  students: readonly {
    name: string;
    grades: readonly { value: number; weight: number }[];
    absent: boolean;
  }[],
): LessonAnalysis {
  const distribution = Array.from({ length: MAX_GRADE }, () => 0);
  const allGrades: { value: number; weight: number }[] = [];
  const absentNames: string[] = [];
  const emptyNames: string[] = [];
  let gradedCount = 0;
  let qualityCount = 0;
  let passingCount = 0;

  for (const student of students) {
    if (student.grades.length > 0) {
      gradedCount += 1;
      allGrades.push(...student.grades);
      const first = student.grades[0]!.value;
      if (first >= MIN_GRADE && first <= MAX_GRADE) distribution[first - 1]! += 1;
      if (first >= QUALITY_MIN_GRADE) qualityCount += 1;
      if (first >= PASSING_MIN_GRADE) passingCount += 1;
    } else if (student.absent) {
      absentNames.push(student.name);
    } else {
      emptyNames.push(student.name);
    }
  }

  return {
    distribution,
    average: weightedAverage(allGrades),
    qualityPercent: gradedCount > 0 ? roundTo((100 * qualityCount) / gradedCount, 0) : null,
    passingPercent: gradedCount > 0 ? roundTo((100 * passingCount) / gradedCount, 0) : null,
    gradedCount,
    absentNames,
    emptyNames,
  };
}

/**
 * Прогноз среднего: каким станет средний балл, если добавить оценку value.
 * Чистая функция, ничего не пишет. Вес гипотетической оценки —
 * weightForKind("regular"), не литерал: прогноз переживёт возврат неравных весов.
 */
export function projectedAverage(
  items: readonly { value: number; weight: number }[],
  value: number,
): number | null {
  return weightedAverage([...items, { value, weight: weightForKind("regular") }]);
}

/**
 * Годовая оценка по предмету — целое число 1..10.
 * Считается как среднее средних баллов четвертей (учитываются только
 * четверти, где есть оценки) с округлением до целого (0.5 -> вверх).
 * Возвращает null, если за год нет ни одной оценки.
 */
export function yearGrade(quarterAverages: readonly (number | null)[]): number | null {
  const filled = quarterAverages.filter((v): v is number => v !== null);
  if (filled.length === 0) return null;
  const avg = filled.reduce((acc, v) => acc + v, 0) / filled.length;
  const rounded = Math.round(roundTo(avg, 4));
  return Math.min(MAX_GRADE, Math.max(MIN_GRADE, rounded));
}

/** Клетка журнала: «10/9» для двух оценок, «8» для одной, «—» если пусто. */
export function formatCellGrades(values: readonly number[]): string {
  if (values.length === 0) return "—";
  return values.join("/");
}

/** Красивый вывод среднего балла: 7.45 -> "7.45", null -> "—". */
export function formatAverage(value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(2);
}

/**
 * Цветовая шкала оценок (единая для всего приложения):
 * 1–3 — красный (неудовлетворительно), 4–5 — оранжевый (удовлетворительно),
 * 6–7 — жёлтый (достаточно), 8–9 — зелёный (хорошо), 10 — синий (отлично).
 */
export function gradeColorClasses(value: number | null): string {
  if (value === null) return "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500";
  if (value >= 10) return "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200";
  if (value >= 8) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200";
  if (value >= 6) return "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-100";
  if (value >= 4) return "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-100";
  return "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200";
}

/** Та же шкала, но для средних баллов (нецелых). */
export function averageColorClasses(value: number | null): string {
  if (value === null) return "text-slate-400";
  if (value >= 9) return "text-sky-600 dark:text-sky-300";
  if (value >= 7.5) return "text-emerald-600 dark:text-emerald-300";
  if (value >= 5.5) return "text-amber-600 dark:text-amber-300";
  if (value >= 3.5) return "text-orange-600 dark:text-orange-300";
  return "text-rose-600 dark:text-rose-300";
}

/**
 * Подсказка «текущая четверть» по календарю (сен–окт — 1, ноя–дек — 2,
 * янв–мар — 3, апр–авг — 4). Используется только как значение по умолчанию.
 */
export function guessCurrentQuarter(date = new Date()): Quarter {
  const month = date.getMonth() + 1;
  if (month >= 9 && month <= 10) return 1;
  if (month >= 11) return 2;
  if (month <= 3) return 3;
  return 4;
}

/**
 * Четверть, которую показываем «по умолчанию»: текущая по календарю, но если
 * в ней ещё нет оценок — последняя заполненная. Иначе в каникулы ученик видит
 * на самом видном месте прочерк.
 */
export function displayQuarter(
  quarterAverages: readonly (number | null)[],
  today = new Date(),
): Quarter {
  const guess = guessCurrentQuarter(today);
  if (quarterAverages[guess - 1] !== null && quarterAverages[guess - 1] !== undefined) {
    return guess;
  }
  for (let quarter = 4; quarter >= 1; quarter -= 1) {
    if (quarterAverages[quarter - 1] !== null && quarterAverages[quarter - 1] !== undefined) {
      return quarter as Quarter;
    }
  }
  return guess;
}

/** Учебный год по дате: сентябрь начинает новый год. */
export function academicYearLabel(date = new Date()): string {
  const start = date.getMonth() + 1 >= 9 ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}/${start + 1}`;
}

export const QUARTER_LABELS: Record<Quarter, string> = {
  1: "1 четверть",
  2: "2 четверть",
  3: "3 четверть",
  4: "4 четверть",
};

/**
 * Эвристика «Кого спросить?» и накопляемость оценок.
 *
 * Изоморфный модуль без prisma и React: считается на клиенте поверх live-данных
 * журнала (с учётом оптимистичных оценок) и легко тестируется. Это эвристика
 * ИНТЕРФЕЙСА, а не правило предметной области, поэтому она живёт здесь,
 * а не в src/lib/grades.ts.
 *
 * «Прошедший урок» везде означает date <= сегодняшней полуночи UTC —
 * будущие уроки, созданные «Сеткой на четверть», в окно НЕ входят, иначе
 * после генерации сетки весь класс разом стал бы «давно не спрошенным».
 */

/** Меньше стольких оценок за четверть — счётчик подсвечивается. */
export const LOW_GRADE_COUNT = 3;
/** Нет оценок за столько ПРОШЕДШИХ уроков подряд — «давно не спрашивали». */
export const NOT_ASKED_WINDOW = 5;
/** Сколько кандидатов подсвечивает «Кого спросить?». */
export const ASK_CANDIDATES_LIMIT = 5;

export type AskRowStats = {
  /** Оценок за четверть (все клетки строки, с учётом оптимистичных). */
  gradeCount: number;
  /** Прошедших уроков подряд без оценки, считая с конца. Нет оценок вообще — pastLessonIds.length. */
  lessonsSinceAsked: number;
  /** «Н» на последнем прошедшем уроке (на нём и спрашивали бы). */
  absentOnReferenceLesson: boolean;
};

/**
 * Статистика одной строки журнала. pastLessonIds — id уроков с date <= сегодня
 * (UTC), по возрастанию даты; будущие уроки сетки в окно НЕ входят.
 */
export function buildAskStats(input: {
  pastLessonIds: readonly string[];
  /** lessonId -> число оценок в клетке этой строки (нулевые можно опускать). */
  cellGradeCounts: Readonly<Record<string, number>>;
  absentLessonIds: readonly string[];
}): AskRowStats {
  const { pastLessonIds, cellGradeCounts, absentLessonIds } = input;

  let gradeCount = 0;
  for (const count of Object.values(cellGradeCounts)) gradeCount += count;

  let lessonsSinceAsked = 0;
  for (let index = pastLessonIds.length - 1; index >= 0; index -= 1) {
    if ((cellGradeCounts[pastLessonIds[index]!] ?? 0) > 0) break;
    lessonsSinceAsked += 1;
  }

  const referenceLessonId = pastLessonIds[pastLessonIds.length - 1];
  const absentOnReferenceLesson =
    referenceLessonId !== undefined && absentLessonIds.includes(referenceLessonId);

  return { gradeCount, lessonsSinceAsked, absentOnReferenceLesson };
}

/**
 * До limit кандидатов на опрос. Подсвечиваются только ученики с дефицитом
 * (gradeCount < LOW_GRADE_COUNT или lessonsSinceAsked >= NOT_ASKED_WINDOW) —
 * если дефицита нет ни у кого, честно не подсвечивается никто. Отсутствующие
 * на опорном (последнем прошедшем) уроке пропускаются: их не спросишь.
 *
 * Сортировка детерминированная, никакой случайности:
 * gradeCount asc -> lessonsSinceAsked desc -> name asc (localeCompare "ru").
 * Возвращает studentId.
 */
export function pickAskCandidates(
  stats: readonly ({ studentId: string; name: string } & AskRowStats)[],
  limit: number = ASK_CANDIDATES_LIMIT,
): string[] {
  return stats
    .filter(
      (row) =>
        !row.absentOnReferenceLesson &&
        (row.gradeCount < LOW_GRADE_COUNT || row.lessonsSinceAsked >= NOT_ASKED_WINDOW),
    )
    .sort(
      (a, b) =>
        a.gradeCount - b.gradeCount ||
        b.lessonsSinceAsked - a.lessonsSinceAsked ||
        a.name.localeCompare(b.name, "ru"),
    )
    .slice(0, limit)
    .map((row) => row.studentId);
}

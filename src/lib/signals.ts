import { roundTo, weightedAverage } from "@/lib/grades";
import { addUtcDays, diffUtcDays } from "@/lib/utils";

/**
 * Сигналы «Требует внимания» — чистый изоморфный движок без prisma
 * (аналог grades.ts). Терминология в коде и интерфейсе — «требует
 * внимания»; словосочетание «группа риска» не употребляется нигде.
 *
 * ПРАВИЛА ДАННЫХ:
 *  * Сигналы НЕ хранятся в БД — считаются при рендере и гаснут сами.
 *    Они не попадают в QuarterResult, CSV, аудит, Telegram и никогда
 *    не показываются ученику.
 *  * Все датовые сравнения — по дате УРОКА (полночь UTC), не по createdAt:
 *    оценку за вторник учитель мог выставить в пятницу.
 *  * Средние — ТОЛЬКО через weightedAverage (формулы не дублируются).
 *  * «silence» (нет оценок 3 недели) — сигнал о невыставлении, он для
 *    учителя и администратора; родителю НЕ показывается
 *    (parentVisibleSignals отфильтровывает).
 */

export const SIGNAL_RULES = {
  /** Падение среднего по предмету: окно 14 дней против четверти до окна. */
  avgDrop: { delta: 1.5, windowDays: 14, minPriorGrades: 4, minWindowGrades: 2 },
  /** Серия из 3 оценок подряд ниже СВОЕГО среднего по предмету. */
  belowOwnAverage: { streak: 3, minPriorGrades: 4 },
  /** «Н» по всем предметам за календарное окно. */
  absences: { count: 4, windowDays: 30 },
  /** Нет ни одной оценки со времени последней (или с начала четверти). */
  silence: { days: 21 },
  /** Первые дни четверти правила по оценкам молчат. */
  graceDays: 14,
  /** Столько «Н» в окне avgDrop понижают его до watch («данные неполные»). */
  absenceContext: 3,
} as const;

export type SignalLevel = "ok" | "watch" | "act";

export type Signal =
  | {
      kind: "avg-drop";
      subjectId: string;
      subjectName: string;
      delta: number;
      /** Ребёнок много отсутствовал в окне — данные неполные, уровень watch. */
      absentContext: boolean;
    }
  | { kind: "below-own-average"; subjectId: string; subjectName: string; streak: number }
  | { kind: "absences"; count: number }
  | { kind: "silence"; days: number };

export type SignalInput = {
  /** «Сегодня» — полночь UTC (инъекция для тестов). */
  today: Date;
  /** Начало ТЕКУЩЕЙ четверти; null — сегодня каникулы (quarterForDate = null). */
  quarterStart: Date | null;
  /** Оценки текущего ГОДА (живые уроки); движок сам режет по четверти. */
  grades: { value: number; date: Date; subjectId: string; subjectName: string }[];
  /** Отметки «Н» — достаточно последних 30 дней. */
  absences: { date: Date }[];
  hasAnyGradeThisYear: boolean;
};

/** Серьёзность одного сигнала (avg-drop при «Н»-контексте понижается). */
export function signalSeverity(signal: Signal): Exclude<SignalLevel, "ok"> {
  switch (signal.kind) {
    case "avg-drop":
      return signal.absentContext ? "watch" : "act";
    case "absences":
      return "act";
    case "below-own-average":
    case "silence":
      return "watch";
  }
}

/** Итоговый уровень: есть act → act; есть сигналы → watch; пусто → ok. */
export function signalLevel(signals: readonly Signal[]): SignalLevel {
  if (signals.some((signal) => signalSeverity(signal) === "act")) return "act";
  return signals.length > 0 ? "watch" : "ok";
}

/**
 * Фильтр родительской витрины: без "silence" (это сигнал о невыставлении,
 * семья на него повлиять не может), максимум 2, act раньше watch.
 */
export function parentVisibleSignals(signals: readonly Signal[]): Signal[] {
  return signals
    .filter((signal) => signal.kind !== "silence")
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 2);
}

function rank(signal: Signal): number {
  return signalSeverity(signal) === "act" ? 0 : 1;
}

/**
 * Все правила разом. Предохранители от ложных срабатываний:
 *  1) каникулы (quarterStart null) — активно только absences;
 *  2) первые graceDays четверти молчат avg-drop и silence;
 *  3) окна не пересекают границу четверти;
 *  4) минимумы выборки встроены в правила — две оценки сигналов не порождают;
 *  5) безотметочный первоклассник: правила по оценкам не срабатывают без
 *     оценок, silence требует hasAnyGradeThisYear — остаётся только absences
 *     (осознанно: посещаемость в 1–2 классах ведётся).
 */
export function detectSignals(input: SignalInput): Signal[] {
  const { today, quarterStart } = input;
  const signals: Signal[] = [];

  // «Н» за календарное окно — единственное правило, живущее и в каникулы.
  const absencesFrom = addUtcDays(today, -SIGNAL_RULES.absences.windowDays);
  const recentAbsences = input.absences.filter(
    (absence) => absence.date > absencesFrom && absence.date <= today,
  ).length;
  if (recentAbsences >= SIGNAL_RULES.absences.count) {
    signals.push({ kind: "absences", count: recentAbsences });
  }

  if (quarterStart === null) return signals;
  const grace = diffUtcDays(today, quarterStart) < SIGNAL_RULES.graceDays;

  // Оценки ТЕКУЩЕЙ четверти по предметам (окно не пересекает её границу).
  const quarterGrades = input.grades.filter(
    (grade) => grade.date >= quarterStart && grade.date <= today,
  );
  const bySubject = new Map<
    string,
    { subjectName: string; grades: { value: number; date: Date }[] }
  >();
  for (const grade of quarterGrades) {
    const entry = bySubject.get(grade.subjectId) ?? {
      subjectName: grade.subjectName,
      grades: [],
    };
    entry.grades.push({ value: grade.value, date: grade.date });
    bySubject.set(grade.subjectId, entry);
  }

  const windowStart = addUtcDays(today, -SIGNAL_RULES.avgDrop.windowDays);
  const absentContext =
    input.absences.filter((absence) => absence.date > windowStart && absence.date <= today)
      .length >= SIGNAL_RULES.absenceContext;

  for (const [subjectId, subject] of bySubject) {
    const sorted = [...subject.grades].sort((a, b) => a.date.getTime() - b.date.getTime());

    // avg-drop: среднее окна против среднего четверти ДО окна.
    if (!grace) {
      const inWindow = sorted.filter((grade) => grade.date > windowStart);
      const before = sorted.filter((grade) => grade.date <= windowStart);
      if (
        inWindow.length >= SIGNAL_RULES.avgDrop.minWindowGrades &&
        before.length >= SIGNAL_RULES.avgDrop.minPriorGrades
      ) {
        const windowAverage = weightedAverage(
          inWindow.map((grade) => ({ value: grade.value, weight: 1 })),
        );
        const priorAverage = weightedAverage(
          before.map((grade) => ({ value: grade.value, weight: 1 })),
        );
        if (windowAverage !== null && priorAverage !== null) {
          const delta = roundTo(priorAverage - windowAverage, 2);
          if (delta >= SIGNAL_RULES.avgDrop.delta) {
            signals.push({
              kind: "avg-drop",
              subjectId,
              subjectName: subject.subjectName,
              delta,
              absentContext,
            });
          }
        }
      }
    }

    // Серия ниже СВОЕГО среднего (сравнений с классом нет и не будет).
    const { streak, minPriorGrades } = SIGNAL_RULES.belowOwnAverage;
    if (sorted.length >= streak + minPriorGrades) {
      const ownAverage = weightedAverage(
        sorted.map((grade) => ({ value: grade.value, weight: 1 })),
      );
      const tail = sorted.slice(-streak);
      if (ownAverage !== null && tail.every((grade) => grade.value < ownAverage)) {
        signals.push({
          kind: "below-own-average",
          subjectId,
          subjectName: subject.subjectName,
          streak,
        });
      }
    }
  }

  // Тишина: от МАКСИМУМА из даты последней оценки года и начала четверти —
  // прошлогодний хвост не даёт сигналу молчать вечно, а начало четверти
  // не наказывает за честные каникулы.
  if (!grace && input.hasAnyGradeThisYear) {
    const lastGradeTime = input.grades.reduce(
      (max, grade) => Math.max(max, grade.date.getTime()),
      0,
    );
    const anchor = new Date(Math.max(lastGradeTime, quarterStart.getTime()));
    const days = diffUtcDays(today, anchor);
    if (days >= SIGNAL_RULES.silence.days) {
      signals.push({ kind: "silence", days });
    }
  }

  return signals;
}

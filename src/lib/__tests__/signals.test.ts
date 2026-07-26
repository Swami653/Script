import { describe, expect, it } from "vitest";

import {
  detectSignals,
  parentVisibleSignals,
  signalLevel,
  SIGNAL_RULES,
  type Signal,
  type SignalInput,
} from "@/lib/signals";

/**
 * Табличные тесты движка сигналов. Все даты — полночь UTC, «сегодня»
 * инъецируется. Сценарии — из линзы рисков спецификации фазы «Семья».
 */

const D = (value: string) => new Date(`${value}T00:00:00.000Z`);

/** Сегодня — середина четверти: grace-период (14 дней) заведомо позади. */
const TODAY = D("2025-11-10");
const QUARTER_START = D("2025-10-01");

const MATH = { subjectId: "m", subjectName: "Математика" };
const RUS = { subjectId: "r", subjectName: "Русский язык" };

function input(partial: Partial<SignalInput>): SignalInput {
  return {
    today: TODAY,
    quarterStart: QUARTER_START,
    grades: [],
    absences: [],
    hasAnyGradeThisYear: false,
    ...partial,
  };
}

/** N оценок value по предмету, разложенных по дням от start. */
function series(
  subject: { subjectId: string; subjectName: string },
  values: number[],
  startIso: string,
  stepDays = 2,
) {
  const start = D(startIso);
  return values.map((value, index) => ({
    ...subject,
    value,
    date: new Date(start.getTime() + index * stepDays * 86_400_000),
  }));
}

function kinds(signals: Signal[]): string[] {
  return signals.map((signal) => signal.kind).sort();
}

describe("detectSignals: avg-drop", () => {
  it("падение среднего на 1.5+ после 4 старых и 2 свежих оценок — act", () => {
    const grades = [
      // База до окна (окно = 14 дней от TODAY, т.е. с 27.10): 9,9,9,9 в начале октября
      ...series(MATH, [9, 9, 9, 9], "2025-10-02"),
      // Свежие в окне: 5, 5 → падение 4.0
      ...series(MATH, [5, 5], "2025-11-05"),
    ];
    const signals = detectSignals(input({ grades, hasAnyGradeThisYear: true }));
    const drop = signals.find((signal) => signal.kind === "avg-drop");
    expect(drop).toBeDefined();
    expect(drop && drop.kind === "avg-drop" && drop.delta).toBe(4);
    expect(signalLevel(signals)).toBe("act");
  });

  it("мало старых оценок (3 < minPriorGrades) — тишина", () => {
    const grades = [
      ...series(MATH, [9, 9, 9], "2025-10-02"),
      ...series(MATH, [5, 5], "2025-11-05"),
    ];
    expect(kinds(detectSignals(input({ grades, hasAnyGradeThisYear: true })))).toEqual([]);
  });

  it("болезнь: ≥3 «Н» в окне понижают до watch с пометкой absentContext", () => {
    const grades = [
      ...series(MATH, [9, 9, 9, 9], "2025-10-02"),
      ...series(MATH, [5, 5], "2025-11-05"),
    ];
    const absences = [{ date: D("2025-11-03") }, { date: D("2025-11-04") }, { date: D("2025-11-06") }];
    const signals = detectSignals(input({ grades, absences, hasAnyGradeThisYear: true }));
    const drop = signals.find((signal) => signal.kind === "avg-drop");
    expect(drop && drop.kind === "avg-drop" && drop.absentContext).toBe(true);
    expect(signalLevel([drop!])).toBe("watch");
  });
});

describe("detectSignals: below-own-average", () => {
  it("3 последние строго ниже своего среднего при ≥7 оценках — watch", () => {
    // 9,9,9,9 затем 6,6,6: среднее 7.71, хвост ниже
    const grades = series(MATH, [9, 9, 9, 9, 6, 6, 6], "2025-10-02");
    const signals = detectSignals(input({ grades, hasAnyGradeThisYear: true }));
    expect(kinds(signals)).toContain("below-own-average");
    expect(signalLevel(signals)).toBe("watch");
  });

  it("6 оценок (меньше streak+minPrior) — тишина", () => {
    const grades = series(MATH, [9, 9, 9, 6, 6, 6], "2025-10-02");
    const signals = detectSignals(input({ grades, hasAnyGradeThisYear: true }));
    expect(kinds(signals)).not.toContain("below-own-average");
  });

  it("сравнение только с СОБСТВЕННЫМ средним: ровные 7,7,7… не сигналят", () => {
    // Свежая серия (последняя оценка — вчера), чтобы silence не примешивался.
    const grades = series(MATH, [7, 7, 7, 7, 7, 7, 7], "2025-10-28", 1);
    expect(kinds(detectSignals(input({ grades, hasAnyGradeThisYear: true })))).toEqual([]);
  });
});

describe("detectSignals: absences", () => {
  it("4 «Н» за 30 дней — act", () => {
    const absences = [
      { date: D("2025-10-20") },
      { date: D("2025-10-27") },
      { date: D("2025-11-03") },
      { date: D("2025-11-07") },
    ];
    const signals = detectSignals(input({ absences }));
    expect(kinds(signals)).toEqual(["absences"]);
    expect(signalLevel(signals)).toBe("act");
  });

  it("старые «Н» (за пределами 30 дней) не считаются", () => {
    const absences = [
      { date: D("2025-09-20") },
      { date: D("2025-09-21") },
      { date: D("2025-09-22") },
      { date: D("2025-11-07") },
    ];
    expect(detectSignals(input({ absences }))).toEqual([]);
  });
});

describe("detectSignals: silence", () => {
  it("нет оценок 21 день от последней — watch (только учителю)", () => {
    const grades = series(MATH, [8, 8, 8, 8, 8], "2025-10-01");
    // последняя — 09.10; до 10.11 — 32 дня
    const signals = detectSignals(input({ grades, hasAnyGradeThisYear: true }));
    const silence = signals.find((signal) => signal.kind === "silence");
    expect(silence).toBeDefined();
    expect(silence && silence.kind === "silence" && silence.days).toBeGreaterThanOrEqual(
      SIGNAL_RULES.silence.days,
    );
  });

  it("первоклассник без единой оценки за год: silence не рождается", () => {
    const signals = detectSignals(input({ hasAnyGradeThisYear: false }));
    expect(kinds(signals)).not.toContain("silence");
  });

  it("первоклассник: 4 «Н» за месяц — сигнал есть (осознанно)", () => {
    const absences = [
      { date: D("2025-10-20") },
      { date: D("2025-10-27") },
      { date: D("2025-11-03") },
      { date: D("2025-11-07") },
    ];
    const signals = detectSignals(input({ absences, hasAnyGradeThisYear: false }));
    expect(kinds(signals)).toEqual(["absences"]);
  });
});

describe("предохранители: каникулы и начало четверти", () => {
  it("каникулы (quarterStart null): активен только absences", () => {
    const grades = [
      ...series(MATH, [9, 9, 9, 9], "2025-10-02"),
      ...series(MATH, [5, 5], "2025-11-05"),
    ];
    const absences = [
      { date: D("2025-10-20") },
      { date: D("2025-10-27") },
      { date: D("2025-11-03") },
      { date: D("2025-11-07") },
    ];
    const signals = detectSignals(
      input({ grades, absences, quarterStart: null, hasAnyGradeThisYear: true }),
    );
    expect(kinds(signals)).toEqual(["absences"]);
  });

  it("первые 14 дней четверти: avg-drop и silence молчат", () => {
    const today = D("2025-10-10"); // 9-й день четверти
    const grades = [
      ...series(MATH, [9, 9, 9, 9], "2025-08-20"), // прошлая четверть — вне окна текущей
      ...series(MATH, [5, 5], "2025-10-06"),
    ];
    const signals = detectSignals(
      input({ today, grades, hasAnyGradeThisYear: true }),
    );
    expect(kinds(signals)).not.toContain("avg-drop");
    expect(kinds(signals)).not.toContain("silence");
  });

  it("окно не пересекает границу: прошлая четверть не участвует в avg-drop", () => {
    // Все «старые» оценки — до начала четверти: базы minPriorGrades нет.
    const grades = [
      ...series(MATH, [9, 9, 9, 9], "2025-09-01"),
      ...series(MATH, [5, 5], "2025-11-05"),
    ];
    const signals = detectSignals(input({ grades, hasAnyGradeThisYear: true }));
    expect(kinds(signals)).not.toContain("avg-drop");
  });

  it("ученик с 2 оценками в четверти — ни одного сигнала (малые выборки)", () => {
    const grades = series(MATH, [3, 2], "2025-11-05");
    expect(detectSignals(input({ grades, hasAnyGradeThisYear: true }))).toEqual([]);
  });
});

describe("signalLevel и родительская витрина", () => {
  it("act перекрывает watch; пусто — ok", () => {
    expect(signalLevel([])).toBe("ok");
    expect(
      signalLevel([
        { kind: "below-own-average", ...MATH, streak: 3 },
        { kind: "absences", count: 5 },
      ]),
    ).toBe("act");
  });

  it("parentVisibleSignals: без silence, максимум 2, act раньше watch", () => {
    const signals: Signal[] = [
      { kind: "silence", days: 30 },
      { kind: "below-own-average", ...MATH, streak: 3 },
      { kind: "absences", count: 5 },
      { kind: "below-own-average", ...RUS, streak: 3 },
    ];
    const visible = parentVisibleSignals(signals);
    expect(visible).toHaveLength(2);
    expect(visible[0]!.kind).toBe("absences");
    expect(visible.every((signal) => signal.kind !== "silence")).toBe(true);
  });
});

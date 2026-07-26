import { Award, ChevronRight } from "lucide-react";
import Link from "next/link";

import { LevelChip } from "@/components/level-chip";
import { StampSeal, StampSealMini } from "@/components/stamp-seal";
import {
  MASTERY_LEVEL_KEYS,
  MASTERY_LEVELS,
  masteryColorClasses,
  STAMP_KIND_KEYS,
  STAMP_KINDS,
  stampLabel,
  type MasteryLevel,
} from "@/lib/gradeless";
import { displayQuarter, QUARTERS } from "@/lib/grades";
import type { GradelessFeedItem, StampSheet, StudentSubjectReport } from "@/lib/queries";
import { cn, formatDateShort, pluralize } from "@/lib/utils";

/** Сколько полных оттисков показывает лента «Листа печатей». */
const STAMP_FEED_LIMIT = 60;

/**
 * Безотметочный дневник (1–2 классы) — серверные секции вместо таблицы
 * средних: герой-«Лист печатей», уровни и характеристики по предметам,
 * лента последних отметок и печати по четвертям. Средних баллов здесь НЕТ
 * и не будет: уровень — не число (правило gradeless.ts).
 *
 * Рендерится по ДАННЫМ, а не только по текущему классу: у переведённого
 * посреди года ученика (2→3) история печатей и уровней остаётся видимой.
 */
export function GradelessDiary({
  stampSheet,
  subjects,
  feed,
  primary = true,
}: {
  stampSheet: StampSheet;
  subjects: StudentSubjectReport[];
  feed: GradelessFeedItem[];
  /**
   * true — это ОСНОВНОЙ дневник (класс безотметочный сейчас): секции рисуют
   * пустые состояния-приглашения. false — исторический блок переведённого
   * ученика (2→3): пустые секции прячутся, обещания «появятся» не даются.
   */
  primary?: boolean;
}) {
  const kindsLine = STAMP_KIND_KEYS.filter((kind) => (stampSheet.byKind[kind] ?? 0) > 0)
    .map((kind) => `${STAMP_KINDS[kind].label} ×${stampSheet.byKind[kind]}`)
    .join(" · ");
  const shownStamps = stampSheet.items.slice(0, STAMP_FEED_LIMIT);
  const restStamps = stampSheet.items.length - shownStamps.length;

  /** У предмета есть безотметочный след в четверти: уровень или характеристика. */
  const subjectQuarterValues = (subject: StudentSubjectReport): (number | null)[] =>
    QUARTERS.map((quarter) => {
      const counts = subject.masteryByQuarter[quarter - 1];
      const hasMastery = counts && counts.high + counts.medium + counts.low > 0;
      return hasMastery || subject.notes[quarter - 1] ? 1 : null;
    });

  const hasAnySubjectData = subjects.some((subject) =>
    subjectQuarterValues(subject).some((value) => value !== null),
  );

  return (
    <>
      {/* ── Лист печатей — герой страницы ─────────────────────────────────── */}
      {(primary || stampSheet.total > 0) && (
      <section className="ledger-paper rounded-lg border border-rule-strong p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Лист печатей
        </h2>

        {stampSheet.total === 0 ? (
          <div className="rounded-lg border border-dashed border-rule-strong p-8 text-center">
            <StampSeal kind="well_done" muted seed="sample" className="mb-3 text-sm" />
            <p className="text-sm font-medium">
              Здесь появятся печати — награды учителя за твои успехи
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              «Молодец», «Старание», «Прорыв» — учитель ставит их прямо на уроке.
            </p>
          </div>
        ) : (
          <>
            {kindsLine && <p className="text-sm">{kindsLine}</p>}
            <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-4">
              {shownStamps.map((stamp) => (
                <li key={stamp.id} className="flex w-24 flex-col items-center gap-1 text-center">
                  <StampSeal kind={stamp.kind} seed={stamp.id} />
                  <span className="text-[10px] leading-tight text-muted-foreground">
                    {formatDateShort(stamp.date)}
                    <span className="block truncate" title={stamp.subjectName}>
                      {stamp.subjectName}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {restStamps > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                и ещё {restStamps} {pluralize(restStamps, "печать", "печати", "печатей")}
              </p>
            )}
          </>
        )}
      </section>
      )}

      {/* ── По предметам: уровни отображаемой четверти и характеристика ───── */}
      {(primary || hasAnySubjectData) && (
      <section>
        <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          По предметам
        </h2>
        {!hasAnySubjectData ? (
          <p className="rounded-lg border border-dashed border-rule-strong bg-card p-6 text-center text-sm text-muted-foreground">
            Учитель ещё не отмечал уровни. Загляни после уроков!
          </p>
        ) : (
          <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
            {subjects.map((subject) => {
              const values = subjectQuarterValues(subject);
              const hasData = values.some((value) => value !== null);
              /* Отображаемая четверть: текущая по календарю, а если в ней пусто —
                 последняя с данными (тот же принцип, что displayQuarter у оценок) */
              const quarter = displayQuarter(values);
              const counts = subject.masteryByQuarter[quarter - 1] ?? {
                high: 0,
                medium: 0,
                low: 0,
              };
              const note = subject.notes[quarter - 1] ?? null;

              return (
                <li key={subject.subjectId}>
                  <Link
                    href={`/student/subject/${subject.subjectId}`}
                    className="focus-ring block px-3 py-2.5 hover:bg-primary/[0.05]"
                  >
                    <span className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-sm font-medium">{subject.subjectName}</span>
                          {hasData && (
                            <span className="text-xs text-muted-foreground">
                              {quarter} четверть
                            </span>
                          )}
                          {subject.absences > 0 && (
                            <span
                              className="text-xs tabular-nums text-muted-foreground"
                              title="Пропусков за год"
                            >
                              Н: {subject.absences}
                            </span>
                          )}
                        </span>
                        {hasData ? (
                          <span className="mt-1 flex flex-wrap items-center gap-1">
                            {MASTERY_LEVEL_KEYS.filter(
                              (level) => (counts[level] ?? 0) > 0,
                            ).map((level) => (
                              <MiniLevelCount
                                key={level}
                                level={level}
                                count={counts[level] ?? 0}
                              />
                            ))}
                            {counts.high + counts.medium + counts.low === 0 && (
                              <span className="text-xs text-muted-foreground">
                                уровней в этой четверти нет
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            отметок пока нет
                          </span>
                        )}
                        {note && (
                          <span className="mt-1.5 block rounded bg-secondary/50 px-2 py-1 text-xs italic">
                            <span className="not-italic text-muted-foreground">от учителя: </span>
                            {note}
                          </span>
                        )}
                      </span>
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      )}

      {/* ── Последние отметки: уровни и печати вперемешку по дате ─────────── */}
      {(primary || feed.length > 0) && (
      <section>
        <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Последние отметки
        </h2>
        {feed.length === 0 ? (
          <p className="rounded-lg border border-dashed border-rule-strong bg-card p-6 text-center text-sm text-muted-foreground">
            Отметок пока нет. Как только учитель отметит уровень или поставит печать, они
            появятся здесь.
          </p>
        ) : (
          <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
            {feed.map((item) => (
              <li
                key={`${item.type}-${item.id}`}
                className="flex items-center gap-3 px-3 py-2 hover:bg-primary/[0.05]"
              >
                {/* Чип — вне ссылки: у чипа с комментарием собственный попап */}
                {item.type === "mastery" && item.level ? (
                  <LevelChip level={item.level} comment={item.comment} />
                ) : (
                  <span className="inline-flex h-7 items-center gap-1 rounded border border-primary/40 px-2 text-xs font-semibold text-primary">
                    <Award className="h-3.5 w-3.5" aria-hidden />
                    {stampLabel(item.kind)}
                  </span>
                )}
                <Link
                  href={`/student/subject/${item.subject.id}`}
                  className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {item.subject.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {formatDateShort(item.lesson.date)} · {item.quarter} четверть
                      {item.lesson.topic ? ` · ${item.lesson.topic}` : ""}
                    </span>
                  </span>
                  {item.teacherName && (
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                      {item.teacherName}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {/* ── Печати по четвертям — вместо спарклайна средних ───────────────── */}
      {stampSheet.total > 0 && (
        <section className="rounded-lg border border-rule-strong bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Печати по четвертям
          </h2>
          <dl className="grid grid-cols-4 gap-2 text-center">
            {QUARTERS.map((quarter) => (
              <div key={quarter}>
                <dt className="text-[11px] text-muted-foreground">{quarter} четв.</dt>
                <dd className="mt-0.5 flex items-center justify-center gap-1 text-xl font-bold tabular-nums">
                  <StampSealMini kind={null} seed={`q${quarter}`} />
                  {stampSheet.byQuarter[quarter - 1] ?? 0}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
}

/** Мини-счётчик уровня: «● 7» в цветах данных (masteryColorClasses — чипом). */
function MiniLevelCount({ level, count }: { level: MasteryLevel; count: number }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-0.5 rounded px-1.5 text-[11px] font-semibold tabular-nums",
        masteryColorClasses(level),
      )}
      title={`${MASTERY_LEVELS[level].label}: ${count}`}
    >
      <span aria-hidden>{MASTERY_LEVELS[level].glyph}</span>
      {count}
    </span>
  );
}

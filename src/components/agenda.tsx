import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { GRADE_KINDS, isGradeKind } from "@/lib/grades";
import type { AgendaLesson } from "@/lib/queries";
import {
  diffUtcDays,
  formatDateShort,
  formatWeekdayShort,
  pluralize,
} from "@/lib/utils";

/**
 * Серверные презентационные секции дневника: «Впереди» (запланированные
 * работы) и «Что задано» (домашние задания). Данные — getStudentAgenda,
 * today — сегодняшняя полночь UTC (передаёт страница).
 */

/** Сколько запланированных работ показывается без свёртки. */
const PLANNED_SHOWN_LIMIT = 5;
/** Больше стольких строк заданий — дальние дни сворачиваются в details. */
const HOMEWORK_OPEN_LIMIT = 8;

/** Подпись типа планируемой работы; незнакомый словарю kind — «Работа». */
function plannedLabel(kind: AgendaLesson["plannedKind"]): string {
  return kind && isGradeKind(kind) ? GRADE_KINDS[kind].label : "Работа";
}

/** «сегодня» / «завтра» / «через 4 дня» — всегда рядом с явной датой. */
function relativeDay(date: Date, today: Date): string {
  const diff = diffUtcDays(new Date(date), today);
  if (diff <= 0) return "сегодня";
  if (diff === 1) return "завтра";
  return `через ${diff} ${pluralize(diff, "день", "дня", "дней")}`;
}

/**
 * «Впереди»: запланированные работы ближайших двух недель. Пустое состояние —
 * тишина: секция не рендерится вовсе («контрольных не запланировано» давало
 * бы ложную безопасность — учитель мог просто не отметить план).
 */
export function PlannedAheadSection({ items, today }: { items: AgendaLesson[]; today: Date }) {
  if (items.length === 0) return null;

  const shown = items.slice(0, PLANNED_SHOWN_LIMIT);
  const moreCount = items.length - shown.length;

  return (
    <section>
      <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Впереди
      </h2>
      <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
        {shown.map((item) => (
          <li key={item.lessonId}>
            <Link
              href={`/student/subject/${item.subject.id}`}
              className="focus-ring flex items-center gap-3 px-3 py-2.5 hover:bg-primary/[0.05]"
            >
              <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatWeekdayShort(item.date)} {formatDateShort(item.date)}
              </span>
              <Badge tone="warning" className="shrink-0">
                {plannedLabel(item.plannedKind)}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {item.subject.name}
                {item.topic && (
                  <span className="font-normal text-muted-foreground"> — {item.topic}</span>
                )}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {relativeDay(item.date, today)}
              </span>
            </Link>
          </li>
        ))}
        {moreCount > 0 && (
          <li className="px-3 py-2 text-xs text-muted-foreground">
            и ещё {moreCount} {pluralize(moreCount, "работа", "работы", "работ")} позже
          </li>
        )}
      </ul>
    </section>
  );
}

/** «сегодня · пн 26.01», «завтра · вт 27.01», дальше просто «чт 29.01». */
function homeworkDayLabel(date: Date, today: Date): string {
  const diff = diffUtcDays(new Date(date), today);
  const base = `${formatWeekdayShort(date)} ${formatDateShort(date)}`;
  if (diff <= 0) return `сегодня · ${base}`;
  if (diff === 1) return `завтра · ${base}`;
  return base;
}

type HomeworkDay = { time: number; date: Date; items: AgendaLesson[] };

/**
 * «Что задано»: задания на ближайшую неделю, сгруппированные по дням.
 * Матрица пустых состояний:
 *  * inUse === false — секции нет вовсе: школа без домашек видит дневник
 *    ровно как раньше;
 *  * inUse === true, окно пустое — стабильный заголовок и одна тихая строка;
 *  * иначе — список; при длинном списке дальние дни в нативном details.
 */
export function HomeworkSection({
  items,
  inUse,
  today,
}: {
  items: AgendaLesson[];
  inUse: boolean;
  today: Date;
}) {
  if (!inUse) return null;

  // Группировка по дням: уроки уже отсортированы по дате, скан подряд.
  const days: HomeworkDay[] = [];
  for (const item of items) {
    const time = new Date(item.date).getTime();
    const last = days[days.length - 1];
    if (last && last.time === time) last.items.push(item);
    else days.push({ time, date: item.date, items: [item] });
  }

  const collapse = items.length > HOMEWORK_OPEN_LIMIT;
  const visibleDays = collapse ? days.slice(0, 2) : days;
  const hiddenDays = collapse ? days.slice(2) : [];
  const hiddenCount = hiddenDays.reduce((sum, day) => sum + day.items.length, 0);
  const lastHiddenDate = hiddenDays[hiddenDays.length - 1]?.date;

  return (
    <section>
      <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Что задано
      </h2>
      <div className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
        {items.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            На ближайшую неделю ничего не записано — задания появляются здесь, когда учитель
            добавит их к уроку.
          </p>
        ) : (
          <>
            {visibleDays.map((day) => (
              <HomeworkDayGroup key={day.time} day={day} today={today} />
            ))}
            {hiddenDays.length > 0 && (
              <details>
                <summary className="focus-ring cursor-pointer list-none px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-accent [&::-webkit-details-marker]:hidden">
                  Ещё {hiddenCount} {pluralize(hiddenCount, "задание", "задания", "заданий")}
                  {lastHiddenDate && ` до ${formatDateShort(lastHiddenDate)}`}
                </summary>
                <div className="divide-y divide-rule border-t border-rule">
                  {hiddenDays.map((day) => (
                    <HomeworkDayGroup key={day.time} day={day} today={today} />
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function HomeworkDayGroup({ day, today }: { day: HomeworkDay; today: Date }) {
  return (
    <div>
      <p className="bg-secondary/40 px-3 py-1 text-[11px] font-semibold uppercase text-muted-foreground">
        {homeworkDayLabel(day.date, today)}
      </p>
      <ul className="divide-y divide-rule">
        {day.items.map((item) => (
          <li key={item.lessonId}>
            <Link
              href={`/student/subject/${item.subject.id}`}
              className="focus-ring flex gap-3 px-3 py-2 hover:bg-primary/[0.05]"
            >
              <span className="w-28 shrink-0 truncate text-sm font-medium">
                {item.subject.name}
              </span>
              <span className="line-clamp-2 min-w-0 flex-1 text-sm text-muted-foreground">
                {item.homework}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { BookOpen, ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { JournalGrid, type GridMode } from "@/app/(app)/journal/journal-grid";
import { JournalToolbar } from "@/app/(app)/journal/journal-toolbar";
import { signalTextTeacher } from "@/components/attention";
import { ClosedStamp } from "@/components/closed-stamp";
import { requirePageRole } from "@/lib/auth-guards";
import {
  averageColorClasses,
  formatAverage,
  isValidQuarter,
  QUARTER_LABELS,
  type Quarter,
} from "@/lib/grades";
import {
  getClassNames,
  getJournalData,
  getQuarterLocksForYear,
  getQuartersWithLessons,
  getSubjects,
  getTopicSuggestions,
} from "@/lib/queries";
import { currentQuarter } from "@/lib/quarters";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";
import { formatYear, getActiveYear, getKnownYears, getQuarterPeriods } from "@/lib/school-year";
import { formatDateLong, formatDateShort, pluralize, todayUtcMidnight } from "@/lib/utils";

export const metadata: Metadata = { title: "Журнал класса" };

type SearchParams = Promise<{
  subject?: string;
  quarter?: string;
  class?: string;
  year?: string;
  /** «Кого спросить?»: ask=1 включает подсветку кандидатов на опрос. */
  ask?: string;
}>;

export default async function JournalPage({ searchParams }: { searchParams: SearchParams }) {
  // Серверная проверка роли: ученик сюда не попадёт даже по прямой ссылке.
  const user = await requirePageRole(GRADE_EDITOR_ROLES);

  const params = await searchParams;
  const [subjects, classNames, knownYears, activeYear] = await Promise.all([
    getSubjects(),
    getClassNames(),
    getKnownYears(),
    getActiveYear(),
  ]);

  if (subjects.length === 0) {
    return (
      <EmptyState
        title="Пока нет ни одного предмета"
        description="Чтобы начать вести журнал, добавьте первый учебный предмет."
      />
    );
  }

  const requestedYear = Number(params.year);
  const year = knownYears.includes(requestedYear) ? requestedYear : activeYear;

  const subjectId =
    subjects.find((subject) => subject.id === params.subject)?.id ?? subjects[0]!.id;
  const subjectName = subjects.find((subject) => subject.id === subjectId)!.name;

  // Темы прошлых уроков предмета — подсказки в форме создания урока.
  const [periods, topicSuggestions] = await Promise.all([
    getQuarterPeriods(year),
    getTopicSuggestions(subjectId),
  ]);

  const requestedQuarter = Number(params.quarter);
  const quarter: Quarter = isValidQuarter(requestedQuarter)
    ? (requestedQuarter as Quarter)
    : await defaultQuarter(subjectId, year, periods);

  const className = params.class && classNames.includes(params.class) ? params.class : null;
  const askMode = params.ask === "1";

  // Границы выбранной четверти — для вкладки «Сетка на четверть» в тулбаре.
  const period = periods.find((item) => item.quarter === quarter);
  const currentPeriod = period
    ? { startDate: period.startDate.toISOString(), endDate: period.endDate.toISOString() }
    : null;

  const [data, locks] = await Promise.all([
    getJournalData(subjectId, quarter, year, className),
    getQuarterLocksForYear(year),
  ]);

  // Замок выбранной четверти предмета: сетка и тулбар уходят в «только чтение».
  const lock =
    locks.find((item) => item.subjectId === subjectId && item.quarter === quarter) ?? null;
  const lockedQuarters = locks
    .filter((item) => item.subjectId === subjectId)
    .map((item) => item.quarter);
  const canEdit = GRADE_EDITOR_ROLES.includes(user.role) && !lock;

  const resultsHref = `/journal/results?subject=${encodeURIComponent(subjectId)}&quarter=${quarter}&year=${year}${
    className ? `&class=${encodeURIComponent(className)}` : ""
  }`;

  /**
   * Режим экрана по составу строк: чисто оценочный, чисто безотметочный
   * (1–2 класс) или смешанный (без фильтра класса). Каждая строка сетки всё
   * равно рендерится по СВОЕМУ assessment — режим управляет только общими
   * элементами: шапкой, подсказками, итоговыми графами и подвалом.
   */
  const hasGraded = data.rows.some((row) => row.assessment === "graded");
  const hasGradeless = data.rows.some((row) => row.assessment === "gradeless");
  const mode: GridMode = hasGraded && hasGradeless ? "mixed" : hasGradeless ? "gradeless" : "graded";

  /** Печатей за выбранную четверть — сводка шапки безотметочного класса. */
  const quarterStamps = data.rows.reduce(
    (sum, row) => sum + Object.values(row.stamps).reduce((n, list) => n + list.length, 0),
    0,
  );

  // «Четверть закончилась — пора подвести итоги»: период прошёл, замка нет, уроки есть.
  const quarterEnded = Boolean(period && period.endDate < todayUtcMidnight());
  const showCloseBanner = !lock && quarterEnded && data.lessons.length > 0;

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {formatYear(year)} учебный год
          {year !== activeYear && " · архив"}
        </p>
        <h1 className="mt-1 text-[1.75rem] font-extrabold leading-tight tracking-tight">
          {subjectName}
          <span className="ml-2 align-middle text-base font-medium text-muted-foreground">
            {QUARTER_LABELS[quarter]}
            {className ? ` · ${className}` : ""}
          </span>
        </h1>
        {/* Итоги строкой, а не рядом одинаковых карточек-метрик */}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>
            <span className="font-semibold tabular-nums text-foreground">{data.rows.length}</span>{" "}
            {pluralize(data.rows.length, "ученик", "ученика", "учеников")}
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="font-semibold tabular-nums text-foreground">
              {data.lessons.length}
            </span>{" "}
            {pluralize(data.lessons.length, "урок", "урока", "уроков")}
          </span>
          <span aria-hidden>·</span>
          {mode === "gradeless" ? (
            /* У безотметочного класса среднего не существует — считаем печати */
            <span>
              безотметочный класс · печатей за четверть:{" "}
              <span className="font-semibold tabular-nums text-foreground">{quarterStamps}</span>
            </span>
          ) : (
            <span>
              {mode === "mixed" ? "средний по оценочным ученикам" : "средний балл класса"}{" "}
              <span
                className={`font-semibold tabular-nums ${averageColorClasses(data.classAverage)}`}
              >
                {formatAverage(data.classAverage)}
              </span>
            </span>
          )}
          <span aria-hidden>·</span>
          <Link
            href={resultsHref}
            className="focus-ring rounded font-medium text-primary hover:underline"
          >
            Итоги четверти →
          </Link>
        </p>
        {lock && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <ClosedStamp dateLabel={formatDateShort(lock.closedAt)} size="sm" />
            <span className="font-medium">Закрыта {formatDateLong(lock.closedAt)}</span>
            <span className="text-muted-foreground">
              · {lock.closedByName} · только чтение ·{" "}
              <Link href={resultsHref} className="focus-ring rounded font-medium text-primary hover:underline">
                ведомость
              </Link>
            </span>
          </p>
        )}
      </header>

      {showCloseBanner && period && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-primary/30 bg-primary/[0.04] px-4 py-2.5 text-sm">
          <ClipboardList className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">
            {quarter} четверть закончилась {formatDateLong(period.endDate)} — пора подвести итоги
            и поставить штамп «Закрыта».
          </span>
          <Link
            href={resultsHref}
            className="focus-ring rounded font-semibold text-primary hover:underline"
          >
            Итоги четверти →
          </Link>
        </div>
      )}

      <JournalToolbar
        subjects={subjects.map((subject) => ({ id: subject.id, name: subject.name }))}
        subjectId={subjectId}
        quarter={quarter}
        classNames={classNames}
        className={className}
        years={knownYears}
        year={year}
        hasPeriods={periods.length > 0}
        currentPeriod={currentPeriod}
        locked={Boolean(lock)}
        lockedQuarters={lockedQuarters}
        askMode={askMode}
        mode={mode}
        topicSuggestions={topicSuggestions}
        lessons={data.lessons.map((lesson) => ({
          id: lesson.id,
          date: lesson.date.toISOString(),
          topic: lesson.topic,
        }))}
        students={data.rows
          /* Массовое выставление — только оценочным: батч с безотметочным
             сервер отклоняет целиком (409), предлагать его бессмысленно */
          .filter((row) => row.assessment === "graded")
          .map((row) => ({
            id: row.student.id,
            name: row.student.name,
          }))}
      />

      <JournalGrid
        canEdit={canEdit}
        quarter={quarter}
        subjectName={subjectName}
        askMode={askMode}
        mode={mode}
        lessons={data.lessons.map((lesson) => ({
          id: lesson.id,
          date: lesson.date.toISOString(),
          topic: lesson.topic,
          homework: lesson.homework,
          plannedKind: lesson.plannedKind,
        }))}
        rows={data.rows.map((row) => ({
          studentId: row.student.id,
          name: row.student.name,
          className: row.student.className,
          assessment: row.assessment,
          hasFamily: row.hasFamily,
          attention: row.attention,
          attentionTitle: row.signals.map(signalTextTeacher).join("; "),
          cells: Object.fromEntries(
            Object.entries(row.cells).map(([lessonId, grades]) => [
              lessonId,
              grades
                .sort((a, b) => a.slot - b.slot)
                .map((grade) => ({
                  value: grade.value,
                  weight: grade.weight,
                  kind: grade.kind,
                  comment: grade.comment,
                  acks: grade.acks.map((ack) => ({
                    parentName: ack.parentName,
                    seenValue: ack.seenValue,
                    updatedAt: ack.updatedAt.toISOString(),
                  })),
                })),
            ]),
          ),
          mastery: row.mastery,
          stamps: row.stamps,
          stampsYearTotal: row.stampsYearTotal,
          absentLessons: row.absentLessons,
          openDebts: Object.fromEntries(
            row.openDebts.map((debt) => [debt.lessonId, debt.debtId]),
          ),
          quarterAverages: row.quarterAverages,
        }))}
      />
    </div>
  );
}

/**
 * Четверть по умолчанию: та, что идёт сейчас по заданным учителем границам.
 * Если границы не заданы или в четверти нет уроков — последняя четверть с уроками.
 */
async function defaultQuarter(
  subjectId: string,
  year: number,
  periods: { quarter: number; startDate: Date; endDate: Date }[],
): Promise<Quarter> {
  const filled = await getQuartersWithLessons(subjectId, year);
  const byCalendar = currentQuarter(periods);

  if (byCalendar && (filled.length === 0 || filled.includes(byCalendar))) return byCalendar;
  if (filled.length > 0) {
    const last = filled[filled.length - 1]!;
    if (isValidQuarter(last)) return last as Quarter;
  }
  return byCalendar ?? 1;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-dashed border-rule-strong bg-card p-10 text-center">
      <BookOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <Link
        href="/journal/subjects"
        className="focus-ring mt-4 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Управление предметами
      </Link>
    </div>
  );
}

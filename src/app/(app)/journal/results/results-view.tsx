"use client";

import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Lock,
  LockOpen,
  Stamp,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { ClosedStamp } from "@/components/closed-stamp";
import { LocalDate, useLocalDateLabel } from "@/components/local-time";
import { Flash, useFlash } from "@/components/flash";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import {
  closeQuarterAction,
  closeQuartersBulkAction,
  reopenQuarterAction,
} from "@/lib/actions/quarters";
import {
  averageColorClasses,
  formatAverage,
  gradeColorClasses,
  QUARTER_MIN_GRADES,
  QUARTERS,
  type ClassSummary,
  type Quarter,
} from "@/lib/grades";
import { MAX_BULK_QUARTER_CLOSE } from "@/lib/quarters";
import { cn, formatDateLong, formatDateShort, pluralize, shortName } from "@/lib/utils";

/* ── Типы данных, сериализованных страницей (даты — ISO-строки) ───────────── */

export type ReviewRowView = {
  student: { id: string; name: string; className: string | null };
  average: number | null;
  proposed: number | null;
  gradeCount: number;
  absenceCount: number;
  borderline: boolean;
  belowMinGrades: boolean;
  missedControls: { lessonId: string; date: string; topic: string | null; absent: boolean }[];
  openDebts: number;
};

export type ReviewView = {
  locked: { closedAt: string; closedByName: string } | null;
  results:
    | {
        studentId: string;
        studentName: string;
        className: string | null;
        average: number | null;
        finalGrade: number | null;
        gradeCount: number;
        absenceCount: number;
      }[]
    | null;
  lessonsTotal: number;
  lessonsWithoutTopic: { lessonId: string; date: string }[];
  controlCount: number;
  trashedCount: number;
  totalStudents: number;
  rows: ReviewRowView[];
  classAverage: number | null;
  summary: ClassSummary;
};

export type OverviewRowView = {
  subjectId: string;
  subjectName: string;
  locked: { closedAt: string; closedByName: string } | null;
  lessonsTotal: number;
  lessonsWithoutTopic: number;
  students: number;
  unassessed: number;
  borderline: number;
};

type ChipKey = "borderline" | "unassessed" | "few" | "control" | "debts";

/**
 * Мастер «Итоги четверти». Пока четверть открыта — живой расчёт с чипами-
 * фильтрами и панелью закрытия; после закрытия экран рисуется ИЗ СНИМКА
 * (ведомость переживает удаление ученика — в этом её смысл). Внизу — пакетное
 * закрытие всех предметов четверти: один учитель ведёт все предметы двух
 * классов, закрывать 12–16 раз по одному — неприемлемо.
 */
export function ResultsView({
  subjects,
  subjectId,
  subjectName,
  quarter,
  years,
  year,
  classNames,
  className,
  isAdmin,
  isCurrentQuarter,
  review,
  overview,
}: {
  subjects: { id: string; name: string }[];
  subjectId: string;
  subjectName: string;
  quarter: Quarter;
  years: number[];
  year: number;
  classNames: string[];
  className: string | null;
  isAdmin: boolean;
  isCurrentQuarter: boolean;
  review: ReviewView;
  overview: OverviewRowView[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { flash, show, clear } = useFlash();

  const [chip, setChip] = useState<ChipKey | null>(null);

  function navigate(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    router.push(`/journal/results?${params.toString()}`);
  }

  const counts = useMemo(
    () => ({
      borderline: review.rows.filter((row) => row.borderline && row.proposed !== null).length,
      unassessed: review.summary.unassessed,
      few: review.rows.filter((row) => row.belowMinGrades).length,
      control: review.rows.filter((row) => row.missedControls.length > 0).length,
      debts: review.rows.filter((row) => row.openDebts > 0).length,
    }),
    [review],
  );

  const shownRows = useMemo(() => {
    if (!chip) return review.rows;
    switch (chip) {
      case "borderline":
        return review.rows.filter((row) => row.borderline && row.proposed !== null);
      case "unassessed":
        return review.rows.filter((row) => row.proposed === null);
      case "few":
        return review.rows.filter((row) => row.belowMinGrades);
      case "control":
        return review.rows.filter((row) => row.missedControls.length > 0);
      case "debts":
        return review.rows.filter((row) => row.openDebts > 0);
    }
  }, [chip, review.rows]);

  const journalHref = `/journal?subject=${encodeURIComponent(subjectId)}&quarter=${quarter}&year=${year}`;
  const noObstacles =
    counts.borderline === 0 &&
    counts.unassessed === 0 &&
    counts.few === 0 &&
    counts.control === 0 &&
    counts.debts === 0;

  return (
    <div className="space-y-4">
      {/* ── Фильтры-навигация ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-rule-strong bg-card p-3">
        <div className="min-w-[190px] flex-1 space-y-1.5 sm:max-w-xs">
          <Label htmlFor="results-subject">Предмет</Label>
          <Select
            id="results-subject"
            value={subjectId}
            onChange={(event) => navigate({ subject: event.target.value })}
          >
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
        </div>

        {years.length > 1 && (
          <div className="min-w-[140px] space-y-1.5">
            <Label htmlFor="results-year">Учебный год</Label>
            <Select
              id="results-year"
              value={String(year)}
              onChange={(event) => navigate({ year: event.target.value, quarter: null })}
            >
              {years.map((item) => (
                <option key={item} value={item}>
                  {item}/{item + 1}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Четверть</Label>
          <div
            className="flex rounded-md border border-input bg-card p-0.5"
            role="group"
            aria-label="Четверть"
          >
            {QUARTERS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => navigate({ quarter: String(item) })}
                aria-pressed={item === quarter}
                className={cn(
                  "focus-ring h-8 w-11 rounded text-sm font-medium transition-colors",
                  item === quarter
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                title={`${item} четверть`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {classNames.length > 0 && (
          <div className="min-w-[130px] space-y-1.5">
            <Label htmlFor="results-class">Класс</Label>
            <Select
              id="results-class"
              value={className ?? ""}
              onChange={(event) => navigate({ class: event.target.value || null })}
            >
              <option value="">Все классы</option>
              {classNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <Link
          href={journalHref}
          className="focus-ring ml-auto inline-flex h-10 items-center gap-1.5 rounded-md border border-input bg-card px-3 text-sm font-medium transition-colors hover:bg-accent"
        >
          <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="hidden sm:inline">Журнал</span>
        </Link>
      </div>

      {review.locked ? (
        <LockedSection
          review={review}
          subjectId={subjectId}
          subjectName={subjectName}
          quarter={quarter}
          year={year}
          isAdmin={isAdmin}
          filteredClassName={className}
          onFlash={show}
        />
      ) : review.lessonsTotal === 0 ? (
        <div className="ledger-paper rounded-lg border border-rule-strong p-10 text-center">
          <p className="text-base font-semibold">В этой четверти нет уроков — закрывать нечего</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
            Итоги подводятся по урокам и оценкам. Добавьте уроки в журнале — таблица появится
            здесь.
          </p>
          <Link
            href={journalHref}
            className="focus-ring mt-4 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Открыть журнал
          </Link>
        </div>
      ) : (
        <>
          {/* ── Сводка строкой ─────────────────────────────────────────────── */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm text-muted-foreground">
            <span>
              <span className="font-semibold tabular-nums text-foreground">
                {review.rows.length}
              </span>{" "}
              {pluralize(review.rows.length, "ученик", "ученика", "учеников")} в ведомости
              {review.rows.length !== review.totalStudents && ` из ${review.totalStudents}`}
            </span>
            <span aria-hidden>·</span>
            <span>
              средний{" "}
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  averageColorClasses(review.classAverage),
                )}
              >
                {formatAverage(review.classAverage)}
              </span>
            </span>
            <span aria-hidden>·</span>
            <span>
              качество{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {review.summary.qualityPercent === null ? "—" : `${review.summary.qualityPercent}%`}
              </span>
            </span>
            <span aria-hidden>·</span>
            <span>
              успеваемость{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {review.summary.passingPercent === null ? "—" : `${review.summary.passingPercent}%`}
              </span>
            </span>
            <span aria-hidden>·</span>
            <span>
              {review.lessonsTotal} {pluralize(review.lessonsTotal, "урок", "урока", "уроков")}
            </span>
          </p>

          {/* ── Чипы-фильтры ───────────────────────────────────────────────── */}
          <div className="flex items-center gap-1.5 overflow-x-auto px-1 pb-1">
            {noObstacles ? (
              /* Под фильтром класса чипы считаются по ОДНОМУ классу, а закрытие
                 фиксирует предмет целиком по всем. Обещать «можно закрывать»,
                 глядя на часть школы, — та же ложь умолчанием, что уже чинилась
                 в строке про размер ведомости. */
              <p
                className={cn(
                  "flex items-center gap-1.5 text-sm font-medium",
                  className
                    ? "text-muted-foreground"
                    : "text-emerald-700 dark:text-emerald-300",
                )}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {className
                  ? `В классе ${className} препятствий нет — но закрывается весь предмет`
                  : "Препятствий нет — можно закрывать"}
              </p>
            ) : (
              <>
                <FilterChip
                  label="Спорные"
                  count={counts.borderline}
                  active={chip === "borderline"}
                  onToggle={() => setChip(chip === "borderline" ? null : "borderline")}
                  title={`Средний в пределах ±0.25 от границы округления`}
                />
                <FilterChip
                  label="Неаттестованные"
                  count={counts.unassessed}
                  active={chip === "unassessed"}
                  onToggle={() => setChip(chip === "unassessed" ? null : "unassessed")}
                  title="Нет ни одной оценки за четверть — в ведомости «н/а»"
                />
                <FilterChip
                  label="Мало оценок"
                  count={counts.few}
                  active={chip === "few"}
                  onToggle={() => setChip(chip === "few" ? null : "few")}
                  title={`Меньше ${QUARTER_MIN_GRADES} оценок за четверть — отметка ставится, но опора слабая`}
                />
                {review.controlCount > 0 && (
                  <FilterChip
                    label="Без оценки за КР"
                    count={counts.control}
                    active={chip === "control"}
                    onToggle={() => setChip(chip === "control" ? null : "control")}
                    title="Есть прошедшая контрольная без оценки этого ученика"
                  />
                )}
                <FilterChip
                  label="Долги"
                  count={counts.debts}
                  active={chip === "debts"}
                  onToggle={() => setChip(chip === "debts" ? null : "debts")}
                  title="Открытые долги за работы — после закрытия пересдача в эти клетки станет невозможна"
                />
              </>
            )}
          </div>

          {review.controlCount === 0 && (
            <p className="px-1 text-xs text-muted-foreground">
              Контрольных работ в четверти не было.
            </p>
          )}

          {review.trashedCount > 0 && (
            <Alert tone="warning" title="В корзине лежат уроки этой четверти">
              {review.trashedCount}{" "}
              {pluralize(review.trashedCount, "урок", "урока", "уроков")} четверти в корзине — их
              оценки не входят в итоги. Восстановите их до закрытия или удалите навсегда, чтобы
              решение было осознанным.{" "}
              <Link href="/journal/trash" className="font-medium underline">
                Открыть корзину
              </Link>
            </Alert>
          )}

          {review.lessonsWithoutTopic.length > 0 && (
            <TopiclessLessons lessons={review.lessonsWithoutTopic} journalHref={journalHref} />
          )}

          {/* ── Таблица-ведомость (живой расчёт) ───────────────────────────── */}
          <ReviewTable rows={shownRows} filtered={chip !== null} />

          {/* ── Панель закрытия ────────────────────────────────────────────── */}
          <ClosePanel
            subjectId={subjectId}
            subjectName={subjectName}
            quarter={quarter}
            year={year}
            review={review}
            isCurrentQuarter={isCurrentQuarter}
            classFiltered={className !== null}
            onFlash={show}
          />
        </>
      )}

      {/* ── Пакетное закрытие всех предметов четверти ────────────────────────── */}
      <BulkClosePanel
        overview={overview}
        quarter={quarter}
        year={year}
        onFlash={show}
      />

      <p className="px-1 text-xs text-muted-foreground">
        Четвертная отметка рассчитывается по среднему баллу (округление до целого, 0.5 — вверх);
        закрывая четверть, учитель утверждает итоги. Годовая считается из средних баллов
        четвертей (правило 1.2) — четвертная отметка в неё не входит.
      </p>

      <Flash message={flash} onClose={clear} />
    </div>
  );
}

/* ── Чип-фильтр ───────────────────────────────────────────────────────────── */

function FilterChip({
  label,
  count,
  active,
  onToggle,
  title,
}: {
  label: string;
  count: number;
  active: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={count === 0}
      aria-pressed={active}
      title={title}
      className={cn(
        "focus-ring flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : count > 0
            ? "border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-400 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
            : "border-input bg-card text-muted-foreground opacity-60",
      )}
    >
      {label}
      <span className="tabular-nums">{count}</span>
      {active && <X className="h-3 w-3" aria-hidden />}
    </button>
  );
}

/* ── Свёрнутый список уроков без темы ─────────────────────────────────────── */

function TopiclessLessons({
  lessons,
  journalHref,
}: {
  lessons: { lessonId: string; date: string }[];
  journalHref: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-rule-strong bg-card px-3 py-2 text-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="focus-ring flex w-full items-center gap-1.5 rounded text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span>
          Уроков без темы: <span className="font-semibold tabular-nums">{lessons.length}</span>
          <span className="text-muted-foreground"> — при сдаче журнала темы обычно нужны</span>
        </span>
      </button>
      {open && (
        <p className="mt-1.5 flex flex-wrap gap-1.5 pl-5">
          {lessons.map((lesson) => (
            <Link
              key={lesson.lessonId}
              href={journalHref}
              className="focus-ring rounded bg-secondary px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground hover:text-foreground"
            >
              {formatDateShort(lesson.date)}
            </Link>
          ))}
        </p>
      )}
    </div>
  );
}

/* ── Отметка с пунктирным кольцом для спорных ─────────────────────────────── */

function ProposedMark({
  proposed,
  average,
  borderline,
}: {
  proposed: number | null;
  average: number | null;
  borderline: boolean;
}) {
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span
        className={cn(
          "inline-flex h-7 w-9 items-center justify-center rounded text-[15px] font-bold tabular-nums",
          gradeColorClasses(proposed),
          borderline && proposed !== null && "outline-dashed outline-1 outline-offset-2 outline-primary/70",
        )}
        title={
          proposed === null
            ? "Не аттестован: нет оценок за четверть"
            : borderline
              ? `Спорный средний ${formatAverage(average)} — у границы округления`
              : undefined
        }
      >
        {proposed ?? "н/а"}
      </span>
      {borderline && proposed !== null && (
        <span className="text-[10px] leading-none tabular-nums text-muted-foreground">
          {formatAverage(average)} → {proposed}
        </span>
      )}
    </span>
  );
}

/* ── Таблица живого расчёта + мобильные карточки ──────────────────────────── */

function ReviewTable({ rows, filtered }: { rows: ReviewRowView[]; filtered: boolean }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-rule-strong bg-card p-6 text-center text-sm text-muted-foreground">
        {filtered
          ? "Под выбранный фильтр никто не попадает."
          : "В ведомости пока никого: ни у одного ученика нет ни оценки, ни «Н» по предмету за год."}
      </p>
    );
  }

  return (
    <>
      {/* Разворот — с планшета и шире */}
      <div className="journal-scroll hidden overflow-x-auto rounded-lg border border-rule-strong shadow-sm md:block">
        <table className="ledger-paper w-full border-collapse text-sm">
          <thead>
            <tr className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="border-b-2 border-r border-rule-strong px-3 py-2 text-left">
                Ученик
              </th>
              <th scope="col" className="w-24 border-b-2 border-rule-strong px-3 py-2 text-center">
                Средний
              </th>
              <th
                scope="col"
                className="w-24 border-b-2 border-rule-strong bg-secondary/40 px-3 py-2 text-center"
                title="Предлагаемая четвертная отметка — по среднему баллу"
              >
                Отметка
              </th>
              <th scope="col" className="w-20 border-b-2 border-rule-strong px-2 py-2 text-center">
                Оценок
              </th>
              <th scope="col" className="w-14 border-b-2 border-rule-strong px-2 py-2 text-center" title="Отметок «Н» за четверть">
                Н
              </th>
              <th scope="col" className="border-b-2 border-rule-strong px-3 py-2 text-left">
                На что обратить внимание
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.student.id} className="hover:bg-primary/[0.04]">
                <th
                  scope="row"
                  className="border-b border-r border-rule px-3 py-1.5 text-left font-normal shadow-[inset_3px_0_0_hsl(var(--spine))]"
                >
                  <Link
                    href={`/journal/students/${row.student.id}`}
                    className="focus-ring rounded font-medium hover:underline"
                  >
                    {row.student.name}
                  </Link>
                  {row.student.className && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {row.student.className}
                    </span>
                  )}
                </th>
                <td className="border-b border-rule px-3 py-1.5 text-center">
                  <span
                    className={cn(
                      "text-[15px] font-semibold tabular-nums",
                      averageColorClasses(row.average),
                    )}
                  >
                    {formatAverage(row.average)}
                  </span>
                </td>
                <td className="border-b border-rule bg-secondary/30 px-3 py-1.5 text-center">
                  <ProposedMark
                    proposed={row.proposed}
                    average={row.average}
                    borderline={row.borderline}
                  />
                </td>
                <td className="border-b border-rule px-2 py-1.5 text-center tabular-nums">
                  {row.gradeCount}
                </td>
                <td className="border-b border-rule px-2 py-1.5 text-center tabular-nums text-muted-foreground">
                  {row.absenceCount > 0 ? row.absenceCount : "—"}
                </td>
                <td className="border-b border-rule px-3 py-1.5">
                  <RowFlags row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Телефон — карточки списком */}
      <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card md:hidden">
        {rows.map((row) => (
          <li key={row.student.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <Link
                href={`/journal/students/${row.student.id}`}
                className="focus-ring rounded text-sm font-medium"
              >
                {shortName(row.student.name)}
                {row.student.className && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {row.student.className}
                  </span>
                )}
              </Link>
              <p className="text-[11px] tabular-nums text-muted-foreground">
                средний {formatAverage(row.average)} · оценок {row.gradeCount}
                {row.absenceCount > 0 && ` · Н ${row.absenceCount}`}
              </p>
              <RowFlags row={row} className="mt-1" />
            </div>
            <ProposedMark proposed={row.proposed} average={row.average} borderline={row.borderline} />
          </li>
        ))}
      </ul>
    </>
  );
}

function RowFlags({ row, className }: { row: ReviewRowView; className?: string }) {
  const flags: { key: string; text: string; title?: string }[] = [];
  if (row.proposed === null) flags.push({ key: "na", text: "нет оценок" });
  if (row.belowMinGrades) {
    flags.push({ key: "few", text: `мало оценок (${row.gradeCount})` });
  }
  for (const control of row.missedControls) {
    flags.push({
      key: `control-${control.lessonId}`,
      text: `КР ${formatDateShort(control.date)}${control.absent ? " — «Н»" : " — без оценки"}`,
      title: control.topic ?? undefined,
    });
  }
  if (row.openDebts > 0) {
    flags.push({
      key: "debts",
      text: `${row.openDebts} ${pluralize(row.openDebts, "долг", "долга", "долгов")}`,
    });
  }
  if (flags.length === 0) return className ? null : <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {flags.map((flag) => (
        <span
          key={flag.key}
          title={flag.title}
          className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30"
        >
          {flag.text}
        </span>
      ))}
    </span>
  );
}

/* ── Закрытая четверть: штамп, ведомость из снимка, переоткрытие ──────────── */

/** Штамп строки списка: хук местной даты нельзя вызвать внутри map. */
function RowStamp({ iso }: { iso: string }) {
  return <ClosedStamp dateLabel={useLocalDateLabel(iso)} size="sm" className="shrink-0" />;
}

function LockedSection({
  review,
  subjectId,
  subjectName,
  quarter,
  year,
  isAdmin,
  filteredClassName,
  onFlash,
}: {
  review: ReviewView;
  subjectId: string;
  subjectName: string;
  quarter: Quarter;
  year: number;
  isAdmin: boolean;
  /** Выбранный в фильтре класс — ведомость его НЕ соблюдает, и это надо сказать. */
  filteredClassName: string | null;
  onFlash: (tone: "success" | "error", text: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reason, setReason] = useState("");
  const locked = review.locked!;
  const results = review.results ?? [];
  /* closedAt — настоящий момент, а не «полночь UTC» урока: закрытие в час ночи
     по Москве иначе датировалось бы вчерашним днём прямо на штампе. */
  const closedLabel = useLocalDateLabel(locked.closedAt);

  function reopen() {
    startTransition(async () => {
      const result = await reopenQuarterAction({
        subjectId,
        year,
        quarter,
        reason: reason.trim() || undefined,
      });
      if (!result.ok) {
        onFlash("error", `${result.status}: ${result.error}`);
        return;
      }
      onFlash("success", result.message ?? "Четверть переоткрыта");
      setReopenOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-rule-strong bg-card p-4">
        <ClosedStamp dateLabel={closedLabel} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {quarter} четверть по предмету «{subjectName}» закрыта
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <LocalDate iso={locked.closedAt} /> · {locked.closedByName} · оценки периода — только
            чтение. Ниже — официальная ведомость на момент закрытия.
          </p>
        </div>
        {isAdmin && !reopenOpen && (
          <Button variant="outline" onClick={() => setReopenOpen(true)}>
            <LockOpen className="h-4 w-4" aria-hidden />
            Переоткрыть…
          </Button>
        )}
      </div>

      {isAdmin && reopenOpen && (
        <div className="animate-fade-in space-y-3 rounded-lg border border-rule-strong bg-secondary/50 p-3">
          <p className="text-sm">
            Переоткрытие удалит официальную ведомость — итоги перестанут действовать до
            повторного закрытия. Действие попадёт в журнал изменений.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1 space-y-1.5">
              <Label htmlFor="reopen-reason">Причина (необязательно)</Label>
              <Input
                id="reopen-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Например: ошибка в оценке за 12.09"
                maxLength={200}
              />
            </div>
            <Button onClick={reopen} loading={pending}>
              <LockOpen className="h-4 w-4" aria-hidden />
              Переоткрыть четверть
            </Button>
            <Button variant="outline" onClick={() => setReopenOpen(false)} disabled={pending}>
              Отмена
            </Button>
          </div>
        </div>
      )}

      <p className="px-1 text-sm text-muted-foreground">
        В ведомости{" "}
        <span className="font-semibold tabular-nums text-foreground">{results.length}</span>{" "}
        {pluralize(results.length, "ученик", "ученика", "учеников")} — состав зафиксирован на
        момент закрытия и не меняется, даже если ученика потом удалили.
        {/* Снимок пишется без фильтра класса: молча показывать полную ведомость
            при выбранном классе — значит врать о том, что видит учитель */}
        {filteredClassName
          ? ` Ведомость всегда полная по всем классам — фильтр «${filteredClassName}» к ней не применяется.`
          : ""}
      </p>

      <div className="journal-scroll overflow-x-auto rounded-lg border border-rule-strong shadow-sm">
        <table className="ledger-paper w-full border-collapse text-sm">
          <thead>
            <tr className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="border-b-2 border-r border-rule-strong px-3 py-2 text-left">
                Ученик
              </th>
              <th scope="col" className="w-20 border-b-2 border-rule-strong px-2 py-2 text-center">
                Класс
              </th>
              <th scope="col" className="w-24 border-b-2 border-rule-strong px-3 py-2 text-center">
                Средний
              </th>
              <th
                scope="col"
                className="w-24 border-b-2 border-rule-strong bg-secondary/40 px-3 py-2 text-center"
              >
                Отметка
              </th>
              <th scope="col" className="w-20 border-b-2 border-rule-strong px-2 py-2 text-center">
                Оценок
              </th>
              <th scope="col" className="w-14 border-b-2 border-rule-strong px-2 py-2 text-center">
                Н
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr key={row.studentId} className="hover:bg-primary/[0.04]">
                <th
                  scope="row"
                  className="border-b border-r border-rule px-3 py-1.5 text-left font-medium shadow-[inset_3px_0_0_hsl(var(--spine))]"
                >
                  {row.studentName}
                </th>
                <td className="border-b border-rule px-2 py-1.5 text-center text-muted-foreground">
                  {row.className ?? "—"}
                </td>
                <td className="border-b border-rule px-3 py-1.5 text-center">
                  <span
                    className={cn(
                      "text-[15px] font-semibold tabular-nums",
                      averageColorClasses(row.average),
                    )}
                  >
                    {formatAverage(row.average)}
                  </span>
                </td>
                <td className="border-b border-rule bg-secondary/30 px-3 py-1.5 text-center">
                  <span
                    className={cn(
                      "inline-flex h-7 w-9 items-center justify-center rounded text-[15px] font-bold tabular-nums",
                      gradeColorClasses(row.finalGrade),
                    )}
                    title="Официальная четвертная отметка"
                  >
                    {row.finalGrade ?? "н/а"}
                  </span>
                </td>
                <td className="border-b border-rule px-2 py-1.5 text-center tabular-nums">
                  {row.gradeCount}
                </td>
                <td className="border-b border-rule px-2 py-1.5 text-center tabular-nums text-muted-foreground">
                  {row.absenceCount > 0 ? row.absenceCount : "—"}
                </td>
              </tr>
            ))}
            {results.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Ведомость пуста: на момент закрытия ни у кого не было ни оценки, ни «Н».
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Панель закрытия одного предмета ──────────────────────────────────────── */

function ClosePanel({
  subjectId,
  subjectName,
  quarter,
  year,
  review,
  isCurrentQuarter,
  classFiltered,
  onFlash,
}: {
  subjectId: string;
  subjectName: string;
  quarter: Quarter;
  year: number;
  review: ReviewView;
  isCurrentQuarter: boolean;
  classFiltered: boolean;
  onFlash: (tone: "success" | "error", text: string) => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const totalDebts = review.rows.reduce((sum, row) => sum + row.openDebts, 0);

  function close() {
    startTransition(async () => {
      const result = await closeQuarterAction({ subjectId, year, quarter });
      if (!result.ok) {
        onFlash("error", `${result.status}: ${result.error}`);
        return;
      }
      onFlash(
        "success",
        `Зафиксировано ${result.data.students} ` +
          `${pluralize(result.data.students, "отметка", "отметки", "отметок")}, ` +
          `средний ${formatAverage(result.data.classAverage)}`,
      );
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="sticky bottom-3 z-10 space-y-3 rounded-lg border border-rule-strong bg-card p-4 shadow-md md:static md:shadow-sm">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">
            Закрыть {quarter} четверть по предмету «{subjectName}»
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">
            <li>
              оценки и «Н» четверти станут только чтением — исправить их сможет лишь
              администратор через переоткрытие;
            </li>
            {classFiltered ? (
              <li>
                в официальную ведомость попадут ВСЕ ученики предмета — фильтр класса меняет
                только просмотр, на снимок он не влияет;
              </li>
            ) : (
              <li>
                в официальную ведомость попадут {review.rows.length}{" "}
                {pluralize(review.rows.length, "ученик", "ученика", "учеников")}
                {review.summary.unassessed > 0 &&
                  `, из них «н/а» — ${review.summary.unassessed}`}
                {review.summary.graded === 0 && " (оценок нет — вся ведомость будет «н/а»)"};
              </li>
            )}
            <li>ученики увидят четвертные отметки в дневнике, отметка появится и в CSV;</li>
            <li>закрывается весь предмет по всем классам;</li>
            {totalDebts > 0 && (
              <li className="text-amber-700 dark:text-amber-300">
                {/* Долги считаются по показанным строкам: под фильтром класса это
                    не все долги предмета, и молчать об этом нельзя */}
                открытых долгов{classFiltered ? " в выбранном классе" : ""}: {totalDebts} — после
                закрытия пересдача в клетки этой четверти станет невозможна (принимать уроком
                текущей четверти);
              </li>
            )}
            {isCurrentQuarter && (
              <li className="text-amber-700 dark:text-amber-300">
                эта четверть идёт сейчас по календарю — обычно закрывают после её окончания.
              </li>
            )}
          </ul>
        </div>
      </div>

      {!confirming ? (
        <Button onClick={() => setConfirming(true)} className="h-11 w-full sm:w-auto">
          <Stamp className="h-4 w-4" aria-hidden />
          Закрыть четверть…
        </Button>
      ) : (
        <div className="animate-fade-in flex flex-wrap items-center gap-2">
          <Button onClick={close} loading={pending} className="h-11">
            <Stamp className="h-4 w-4" aria-hidden />
            Поставить штамп «Закрыта»
          </Button>
          <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending} className="h-11">
            Отмена
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── Пакетное закрытие всех предметов четверти ────────────────────────────── */

function BulkClosePanel({
  overview,
  quarter,
  year,
  onFlash,
}: {
  overview: OverviewRowView[];
  quarter: Quarter;
  year: number;
  onFlash: (tone: "success" | "error", text: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const isReady = (row: OverviewRowView) =>
    !row.locked &&
    row.lessonsTotal > 0 &&
    row.unassessed === 0 &&
    row.borderline === 0 &&
    row.lessonsWithoutTopic === 0;

  // По умолчанию отмечены предметы без проблем; уже закрытые и пустые — недоступны.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(overview.filter(isReady).map((row) => row.subjectId)),
  );

  const selectable = overview.filter((row) => !row.locked && row.lessonsTotal > 0);
  const selected = selectable.filter((row) => checked.has(row.subjectId));
  const selectedWithIssues = selected.filter((row) => !isReady(row));
  const closedCount = overview.filter((row) => row.locked).length;

  function toggle(subjectId: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) next.delete(subjectId);
      else if (next.size < MAX_BULK_QUARTER_CLOSE) next.add(subjectId);
      return next;
    });
    setConfirming(false);
  }

  function closeAll() {
    startTransition(async () => {
      const result = await closeQuartersBulkAction({
        subjectIds: selected.map((row) => row.subjectId),
        year,
        quarter,
      });
      if (!result.ok) {
        onFlash("error", `${result.status}: ${result.error}`);
        return;
      }
      onFlash(
        "success",
        `Закрыто предметов: ${result.data.closed}, зафиксировано ${result.data.students} ` +
          pluralize(result.data.students, "отметка", "отметки", "отметок"),
      );
      setConfirming(false);
      router.refresh();
    });
  }

  if (overview.length < 2) return null;

  return (
    <section className="space-y-3 rounded-lg border border-rule-strong bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">
          Закрыть несколько предметов — {quarter} четверть {year}/{year + 1}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Один учитель ведёт все предметы — отметьте готовые и поставьте штамп разом, а не
          {" "}{overview.length} раз по одному. По умолчанию отмечены предметы без препятствий.
          {closedCount > 0 &&
            ` Уже закрыто: ${closedCount} из ${overview.length}.`}
        </p>
      </div>

      <ul className="divide-y divide-rule overflow-hidden rounded-md border border-rule">
        {overview.map((row) => {
          const disabled = Boolean(row.locked) || row.lessonsTotal === 0;
          const issues: string[] = [];
          if (row.unassessed > 0) issues.push(`без оценок: ${row.unassessed}`);
          if (row.borderline > 0) issues.push(`спорных: ${row.borderline}`);
          if (row.lessonsWithoutTopic > 0) issues.push(`без темы: ${row.lessonsWithoutTopic}`);

          return (
            <li key={row.subjectId} className={cn("flex items-center gap-3 px-3 py-2", disabled && "opacity-70")}>
              <input
                type="checkbox"
                id={`bulk-${row.subjectId}`}
                checked={checked.has(row.subjectId) && !disabled}
                disabled={disabled || pending}
                onChange={() => toggle(row.subjectId)}
                className="focus-ring h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
              />
              <label htmlFor={`bulk-${row.subjectId}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    href={`/journal/results?subject=${encodeURIComponent(row.subjectId)}&quarter=${quarter}&year=${year}`}
                    className="focus-ring rounded text-sm font-medium hover:underline"
                  >
                    {row.subjectName}
                  </Link>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {row.locked
                      ? <>закрыта <LocalDate iso={row.locked.closedAt} /></>
                      : row.lessonsTotal === 0
                        ? "уроков нет — закрывать нечего"
                        : `уроков ${row.lessonsTotal} · учеников ${row.students}`}
                  </span>
                </span>
                {!disabled &&
                  (issues.length > 0 ? (
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {issues.map((issue) => (
                        <span
                          key={issue}
                          className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30"
                        >
                          {issue}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-[11px] text-emerald-700 dark:text-emerald-300">
                      препятствий нет
                    </span>
                  ))}
              </label>
              {row.locked && (
                <RowStamp iso={row.locked.closedAt} />
              )}
            </li>
          );
        })}
      </ul>

      {selectedWithIssues.length > 0 && (
        <Alert tone="warning" title="Среди отмеченных есть предметы с препятствиями">
          {selectedWithIssues.map((row) => row.subjectName).join(", ")} — неаттестованные попадут
          в ведомость как «н/а», спорные средние округлятся по правилу «0.5 вверх». Закрывать
          так можно, но решение за вами.
        </Alert>
      )}

      {!confirming ? (
        <Button
          onClick={() => setConfirming(true)}
          disabled={selected.length === 0}
          className="h-11 w-full sm:w-auto"
        >
          <Stamp className="h-4 w-4" aria-hidden />
          Закрыть отмеченные предметы ({selected.length})
        </Button>
      ) : (
        <div className="animate-fade-in flex flex-wrap items-center gap-2">
          <Button onClick={closeAll} loading={pending} className="h-11">
            <Stamp className="h-4 w-4" aria-hidden />
            Поставить штамп «Закрыта» на {selected.length}{" "}
            {pluralize(selected.length, "предмет", "предмета", "предметов")}
          </Button>
          <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending} className="h-11">
            Отмена
          </Button>
        </div>
      )}
    </section>
  );
}

"use client";

import { CheckCircle2, ChevronDown, ChevronRight, HandCoins, Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { Flash, useFlash } from "@/components/flash";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/field";
import { setGradeAction } from "@/lib/actions/grades";
import { clearDebtAction } from "@/lib/actions/debts";
import { gradeColorClasses, MAX_GRADE, MIN_GRADE } from "@/lib/grades";
import { cn, formatDateLong, formatDateShort, pluralize, shortName } from "@/lib/utils";

export type DebtItemView = {
  id: string;
  origin: string;
  note: string | null;
  student: { id: string; name: string; className: string | null };
  lesson: { id: string; date: string; topic: string | null; quarter: number };
  status: "open" | "closedByGrade" | "cleared";
  daysOpen: number;
  closedGrade: number | null;
  clearedAt: string | null;
  quarterLocked: boolean;
};

const GRADE_BUTTONS = Array.from({ length: MAX_GRADE }, (_, index) => index + MIN_GRADE);

/** Долг «висит» дольше этого — счётчик дней подсвечивается. */
const STALE_DEBT_DAYS = 14;

/**
 * Список долгов: открытые сверху по давности, история — ниже. Пересдача
 * принимается рядом 1–10 прямо из строки: оценка уходит в setGradeAction и
 * закрывает долг САМА (статус выводится по EXISTS Grade, писать нечего).
 * Долг закрытой четверти пересдать в его клетку нельзя (сервер ответит 423) —
 * чип подсказывает принять пересдачу уроком текущей четверти и снять долг.
 */
export function DebtsList({
  subjects,
  subjectId,
  years,
  year,
  debts,
}: {
  subjects: { id: string; name: string }[];
  subjectId: string;
  years: number[];
  year: number;
  debts: DebtItemView[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { flash, show, clear } = useFlash();
  const [historyOpen, setHistoryOpen] = useState(false);

  function navigate(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    router.push(`/journal/debts?${params.toString()}`);
  }

  const open = debts.filter((debt) => debt.status === "open");
  const history = debts.filter((debt) => debt.status !== "open");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-rule-strong bg-card p-3">
        <div className="min-w-[190px] flex-1 space-y-1.5 sm:max-w-xs">
          <Label htmlFor="debts-subject">Предмет</Label>
          <Select
            id="debts-subject"
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
            <Label htmlFor="debts-year">Учебный год</Label>
            <Select
              id="debts-year"
              value={String(year)}
              onChange={(event) => navigate({ year: event.target.value })}
            >
              {years.map((item) => (
                <option key={item} value={item}>
                  {item}/{item + 1}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {open.length === 0 ? (
        <div className="rounded-lg border border-dashed border-rule-strong bg-card p-8 text-center">
          <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-600 dark:text-emerald-300" aria-hidden />
          <p className="text-sm font-medium">Открытых долгов по предмету нет</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Долг появляется сам — за «Н» на прошедшей контрольной, — или вручную: кнопка
            «Долг» в клетке журнала. Выставленная оценка закрывает долг автоматически.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
          {open.map((debt) => (
            <OpenDebtRow key={debt.id} debt={debt} onFlash={show} />
          ))}
        </ul>
      )}

      {history.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setHistoryOpen((value) => !value)}
            aria-expanded={historyOpen}
            className="focus-ring mb-2 flex items-center gap-1.5 rounded px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {historyOpen ? (
              <ChevronDown className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden />
            )}
            История: {history.length}{" "}
            {pluralize(history.length, "закрытый долг", "закрытых долга", "закрытых долгов")}
          </button>
          {historyOpen && (
            <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
              {history.map((debt) => (
                <li key={debt.id} className="flex items-center gap-3 px-3 py-2.5 opacity-80">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {shortName(debt.student.name)}
                      {debt.student.className && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          {debt.student.className}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      урок {formatDateShort(debt.lesson.date)} · {debt.lesson.quarter} четверть
                      {debt.lesson.topic ? ` · ${debt.lesson.topic}` : ""}
                      {debt.note ? ` · «${debt.note}»` : ""}
                    </span>
                  </span>
                  {debt.status === "closedByGrade" ? (
                    <span
                      className={cn(
                        "flex h-8 w-9 shrink-0 items-center justify-center rounded text-[15px] font-bold tabular-nums",
                        gradeColorClasses(debt.closedGrade),
                      )}
                      title="Закрыт оценкой — пересдача принята"
                    >
                      {debt.closedGrade}
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      снят{debt.clearedAt ? ` ${formatDateShort(debt.clearedAt)}` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="px-1 text-xs text-muted-foreground">
        «Висит N дней» считается со дня урока. Оценка в клетку долга закрывает его сама;
        «Снять долг» — прощение без оценки (остаётся в истории).
      </p>

      <Flash message={flash} onClose={clear} />
    </div>
  );
}

function OpenDebtRow({
  debt,
  onFlash,
}: {
  debt: DebtItemView;
  onFlash: (tone: "success" | "error", text: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [retakeOpen, setRetakeOpen] = useState(false);

  /** Принять пересдачу: оценка в клетку урока-долга закрывает долг сама. */
  function acceptRetake(value: number) {
    startTransition(async () => {
      const result = await setGradeAction({
        studentId: debt.student.id,
        lessonId: debt.lesson.id,
        value,
        slot: 0,
        // Авто-долг — это несданная контрольная, пересдача идёт тем же типом;
        // ручной долг мог быть за что угодно — тип «текущая», чтобы оценка
        // kind="control" не перекрасила обычный урок в контрольную.
        kind: debt.origin === "auto" ? "control" : "regular",
      });
      if (!result.ok) {
        onFlash("error", `${result.status}: ${result.error}`);
        return;
      }
      onFlash("success", `Пересдача принята: ${value} — долг закрыт`);
      setRetakeOpen(false);
      router.refresh();
    });
  }

  function clearDebt() {
    if (!window.confirm(`Снять долг с «${shortName(debt.student.name)}» без оценки?`)) return;
    startTransition(async () => {
      const result = await clearDebtAction({ debtId: debt.id });
      if (!result.ok) {
        onFlash("error", `${result.status}: ${result.error}`);
        return;
      }
      onFlash("success", result.message ?? "Долг снят");
      router.refresh();
    });
  }

  return (
    <li className="space-y-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {debt.student.name}
            {debt.student.className && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {debt.student.className}
              </span>
            )}
          </span>
          <span className="block text-xs text-muted-foreground">
            урок {formatDateLong(debt.lesson.date)} · {debt.lesson.quarter} четверть
            {debt.lesson.topic ? ` · ${debt.lesson.topic}` : ""}
            {debt.note ? ` · «${debt.note}»` : ""}
          </span>
        </span>

        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          <span
            className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
            title={
              debt.origin === "auto"
                ? "Создан автоматически: «Н» на контрольной"
                : "Отмечен учителем вручную"
            }
          >
            {debt.origin === "auto" ? "авто · КР" : "вручную"}
          </span>
          {debt.quarterLocked && (
            <span
              className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              title="Четверть долга закрыта: оценка в его клетку невозможна. Примите пересдачу уроком текущей четверти и снимите долг вручную."
            >
              <Lock className="h-3 w-3" aria-hidden />
              четверть закрыта
            </span>
          )}
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
              debt.daysOpen > STALE_DEBT_DAYS
                ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30"
                : "bg-secondary text-muted-foreground",
            )}
            title="Со дня урока"
          >
            {debt.daysOpen === 0
              ? "сегодня"
              : `висит ${debt.daysOpen} ${pluralize(debt.daysOpen, "день", "дня", "дней")}`}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRetakeOpen((value) => !value)}
            aria-expanded={retakeOpen}
            disabled={pending}
          >
            <HandCoins className="h-3.5 w-3.5" aria-hidden />
            Принять пересдачу
          </Button>
          <Button variant="ghost" size="sm" onClick={clearDebt} disabled={pending}>
            Снять долг
          </Button>
        </span>
      </div>

      {retakeOpen && (
        <div className="animate-fade-in rounded-md border border-rule bg-secondary/40 p-2">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Оценка за пересдачу — в клетку урока {formatDateShort(debt.lesson.date)}
          </p>
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
            {GRADE_BUTTONS.map((value) => (
              <button
                key={value}
                type="button"
                disabled={pending}
                onClick={() => acceptRetake(value)}
                className={cn(
                  "focus-ring h-11 rounded-md text-base font-bold tabular-nums transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50",
                  gradeColorClasses(value),
                )}
              >
                {value}
              </button>
            ))}
          </div>
          {debt.quarterLocked && (
            <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
              Четверть закрыта — сервер не примет оценку в эту клетку (423). Примите
              пересдачу уроком текущей четверти и снимите долг вручную.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

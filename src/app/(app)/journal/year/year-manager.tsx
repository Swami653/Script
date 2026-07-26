"use client";

import { CalendarCheck, CheckCircle2, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Flash, useFlash } from "@/components/flash";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import {
  deleteQuarterPeriodAction,
  saveQuarterPeriodAction,
  setActiveYearAction,
} from "@/lib/actions/quarters";
import { QUARTERS, QUARTER_LABELS, type Quarter } from "@/lib/grades";
import { cn, formatDateLong } from "@/lib/utils";

type PeriodInput = { quarter: number; startDate: string; endDate: string };

export function YearManager({
  year,
  activeYear,
  yearOptions,
  periods,
}: {
  year: number;
  activeYear: number;
  yearOptions: number[];
  periods: PeriodInput[];
}) {
  const router = useRouter();
  const { flash, show, clear } = useFlash();
  const [pending, startTransition] = useTransition();

  const [draft, setDraft] = useState<Record<number, PeriodInput>>(() => {
    const initial: Record<number, PeriodInput> = {};
    for (const quarter of QUARTERS) {
      const existing = periods.find((period) => period.quarter === quarter);
      initial[quarter] = existing ?? { quarter, startDate: "", endDate: "" };
    }
    return initial;
  });

  const today = new Date().toISOString().slice(0, 10);
  const currentQuarter = periods.find(
    (period) => period.startDate <= today && today <= period.endDate,
  );

  function update(quarter: number, patch: Partial<PeriodInput>) {
    setDraft((prev) => ({ ...prev, [quarter]: { ...prev[quarter]!, ...patch } }));
  }

  function save(quarter: number) {
    const period = draft[quarter]!;
    if (!period.startDate || !period.endDate) {
      show("error", "Укажите обе даты");
      return;
    }

    startTransition(async () => {
      const result = await saveQuarterPeriodAction({
        year,
        quarter,
        startDate: period.startDate,
        endDate: period.endDate,
      });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      show("success", result.message ?? "Сохранено");
      router.refresh();
    });
  }

  function remove(quarter: number) {
    if (!window.confirm(`Удалить границы ${quarter} четверти? Оценки останутся на месте.`)) return;

    startTransition(async () => {
      const result = await deleteQuarterPeriodAction({ year, quarter });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      update(quarter, { startDate: "", endDate: "" });
      show("success", result.message ?? "Удалено");
      router.refresh();
    });
  }

  function makeActive() {
    startTransition(async () => {
      const result = await setActiveYearAction({ year });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      show("success", result.message ?? "Год обновлён");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-rule-strong bg-card p-3">
        <div className="min-w-[170px] space-y-1.5">
          <Label htmlFor="year-picker">Учебный год</Label>
          <Select
            id="year-picker"
            value={String(year)}
            onChange={(event) => router.push(`/journal/year?year=${event.target.value}`)}
          >
            {yearOptions.map((item) => (
              <option key={item} value={item}>
                {item}/{item + 1}
              </option>
            ))}
          </Select>
        </div>

        {year === activeYear ? (
          <p className="flex h-10 items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Этот год сейчас активен
          </p>
        ) : (
          <Button onClick={makeActive} loading={pending}>
            <CalendarCheck className="h-4 w-4" aria-hidden />
            Сделать текущим
          </Button>
        )}
      </div>

      {currentQuarter ? (
        <Alert tone="success" title={`Сейчас идёт ${currentQuarter.quarter} четверть`}>
          с {formatDateLong(currentQuarter.startDate)} по {formatDateLong(currentQuarter.endDate)}
        </Alert>
      ) : (
        <Alert tone="info" title="Сегодня не попадает ни в одну четверть">
          Это нормально в каникулы. Журнал в таком случае откроет последнюю четверть с уроками.
        </Alert>
      )}

      <div className="space-y-3">
        {QUARTERS.map((quarter) => {
          const period = draft[quarter]!;
          const saved = periods.find((item) => item.quarter === quarter);
          const isCurrent = currentQuarter?.quarter === quarter;

          return (
            <div
              key={quarter}
              className={cn(
                "rounded-lg border bg-card p-3",
                isCurrent ? "border-primary/60" : "border-rule-strong",
              )}
            >
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  {QUARTER_LABELS[quarter as Quarter]}
                  {isCurrent && (
                    <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      идёт сейчас
                    </span>
                  )}
                </h2>
                {saved && (
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Удалить границы четверти"
                    className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => remove(quarter)}
                    disabled={pending}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`start-${quarter}`}>Начало</Label>
                  <Input
                    id={`start-${quarter}`}
                    type="date"
                    value={period.startDate}
                    onChange={(event) => update(quarter, { startDate: event.target.value })}
                    className="w-[170px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`end-${quarter}`}>Окончание</Label>
                  <Input
                    id={`end-${quarter}`}
                    type="date"
                    value={period.endDate}
                    onChange={(event) => update(quarter, { endDate: event.target.value })}
                    className="w-[170px]"
                  />
                </div>
                <Button
                  variant={saved ? "outline" : "primary"}
                  onClick={() => save(quarter)}
                  loading={pending}
                  disabled={!period.startDate || !period.endDate}
                >
                  <Save className="h-4 w-4" aria-hidden />
                  {saved ? "Обновить" : "Сохранить"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Flash message={flash} onClose={clear} />
    </div>
  );
}

"use client";

import { CalendarPlus, Download, Keyboard, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { Flash, useFlash } from "@/components/flash";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select } from "@/components/ui/field";
import { createLessonAction } from "@/lib/actions/lessons";
import { QUARTERS, type Quarter } from "@/lib/grades";
import { cn, toDateInputValue } from "@/lib/utils";

export function JournalToolbar({
  subjects,
  subjectId,
  quarter,
  classNames,
  className,
  years,
  year,
  hasPeriods,
}: {
  subjects: { id: string; name: string }[];
  subjectId: string;
  quarter: Quarter;
  classNames: string[];
  className: string | null;
  years: number[];
  year: number;
  hasPeriods: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { flash, show, clear } = useFlash();
  const [addOpen, setAddOpen] = useState(false);

  function navigate(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    router.push(`/journal?${params.toString()}`);
  }

  const exportHref = `/api/journal/export?subject=${encodeURIComponent(subjectId)}&quarter=${quarter}&year=${year}${
    className ? `&class=${encodeURIComponent(className)}` : ""
  }`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-rule-strong bg-card p-3">
        <div className="min-w-[190px] flex-1 space-y-1.5 sm:max-w-xs">
          <Label htmlFor="subject-select">Предмет</Label>
          <Select
            id="subject-select"
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
            <Label htmlFor="year-select">Учебный год</Label>
            <Select
              id="year-select"
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
          <div className="flex rounded-md border border-input bg-card p-0.5" role="group" aria-label="Четверть">
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
            <Label htmlFor="class-select">Класс</Label>
            <Select
              id="class-select"
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

        <div className="ml-auto flex items-center gap-2">
          <a
            href={exportHref}
            download
            title="Скачать журнал в CSV — открывается в Excel"
            className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md border border-input bg-card px-4 text-sm font-medium transition-colors hover:bg-accent"
          >
            <Download className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Экспорт</span>
          </a>
          <Button onClick={() => setAddOpen((value) => !value)}>
            {addOpen ? (
              <X className="h-4 w-4" aria-hidden />
            ) : (
              <CalendarPlus className="h-4 w-4" aria-hidden />
            )}
            {addOpen ? "Отмена" : "Добавить урок"}
          </Button>
        </div>
      </div>

      {addOpen && (
        <AddLessonForm
          subjectId={subjectId}
          quarter={quarter}
          hasPeriods={hasPeriods}
          onDone={(message) => {
            setAddOpen(false);
            show("success", message);
            router.refresh();
          }}
          onError={(message) => show("error", message)}
        />
      )}

      {/* Подсказка про клавиши бессмысленна там, где нет клавиатуры */}
      <p className="hidden flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground md:flex">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Keyboard className="h-3.5 w-3.5" aria-hidden />
          Горячие клавиши:
        </span>
        <span>
          <Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>↑</Kbd> <Kbd>↓</Kbd> — перемещение
        </span>
        <span>
          <Kbd>1</Kbd>…<Kbd>9</Kbd>, <Kbd>0</Kbd> = 10 — выставить оценку
        </span>
        <span>
          <Kbd>Enter</Kbd> — выбрать мышью
        </span>
        <span>
          <Kbd>Shift</Kbd>+цифра — вторая оценка за урок (10/9)
        </span>
        <span>
          <Kbd>Del</Kbd> — убрать оценку
        </span>
      </p>

      {!hasPeriods && (
        <p className="px-1 text-xs text-muted-foreground">
          Границы четвертей на {year}/{year + 1} не заданы — четверть у нового урока
          придётся выбирать вручную.{" "}
          <Link href="/journal/year" className="font-medium text-primary underline">
            Задать даты четвертей
          </Link>
        </p>
      )}

      <Flash message={flash} onClose={clear} />
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
      {children}
    </kbd>
  );
}

function AddLessonForm({
  subjectId,
  quarter,
  hasPeriods,
  onDone,
  onError,
}: {
  subjectId: string;
  quarter: Quarter;
  hasPeriods: boolean;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(() => toDateInputValue(new Date()));
  const [topic, setTopic] = useState("");
  const [lessonQuarter, setLessonQuarter] = useState<number>(quarter);

  return (
    <form
      className="animate-fade-in flex flex-wrap items-end gap-3 rounded-lg border border-rule-strong bg-secondary/50 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await createLessonAction({
            subjectId,
            date,
            // Если границы четвертей заданы, четверть определит сервер по дате.
            quarter: hasPeriods ? undefined : lessonQuarter,
            topic: topic.trim() || undefined,
          });
          if (!result.ok) {
            onError(`${result.status}: ${result.error}`);
            return;
          }
          setTopic("");
          onDone(result.message ?? "Урок добавлен");
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="lesson-date">Дата урока</Label>
        <Input
          id="lesson-date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
          className="w-[170px]"
        />
      </div>

      {!hasPeriods && (
        <div className="space-y-1.5">
          <Label htmlFor="lesson-quarter">Четверть</Label>
          <Select
            id="lesson-quarter"
            value={String(lessonQuarter)}
            onChange={(event) => setLessonQuarter(Number(event.target.value))}
            className="w-[130px]"
          >
            {QUARTERS.map((item) => (
              <option key={item} value={item}>
                {item} четверть
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="min-w-[200px] flex-1 space-y-1.5">
        <Label htmlFor="lesson-topic">Тема урока (необязательно)</Label>
        <Input
          id="lesson-topic"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="Квадратные уравнения"
          maxLength={120}
        />
      </div>

      <Button type="submit" loading={pending}>
        Добавить столбец
      </Button>

      <FieldHint className="w-full">
        На одну дату по предмету может быть только один урок.
        {hasPeriods && " Четверть определяется по дате автоматически."}
      </FieldHint>
    </form>
  );
}

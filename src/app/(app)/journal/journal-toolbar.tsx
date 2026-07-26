"use client";

import { CalendarPlus, Download, Keyboard, Lock, Sparkles, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import {
  BulkGradePanel,
  type BulkLesson,
  type BulkStudent,
} from "@/app/(app)/journal/bulk-grade-panel";
import { LessonGridForm } from "@/app/(app)/journal/lesson-grid-form";
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
  currentPeriod,
  locked,
  lockedQuarters,
  askMode,
  mode,
  topicSuggestions,
  lessons,
  students,
}: {
  subjects: { id: string; name: string }[];
  subjectId: string;
  quarter: Quarter;
  classNames: string[];
  className: string | null;
  years: number[];
  year: number;
  hasPeriods: boolean;
  /** Границы выбранной четверти (ISO-даты) — для вкладки «Сетка на четверть». */
  currentPeriod: { startDate: string; endDate: string } | null;
  /** Выбранная четверть закрыта замком: инструменты записи прячутся (сервер и так отобьёт 423). */
  locked: boolean;
  /** Закрытые четверти текущего предмета — значок замка на кнопках-переключателях. */
  lockedQuarters: number[];
  /** Включён ли режим «Кого спросить?» (?ask=1). */
  askMode: boolean;
  /**
   * Режим экрана: graded | gradeless | mixed (считает страница по классам
   * строк). Меняет подсказку клавиш и прячет «Кого спросить?» у чисто
   * безотметочного класса — спрашивать «на оценку» там некого.
   */
  mode: "graded" | "gradeless" | "mixed";
  /** Темы прошлых уроков предмета — подсказки в поле темы нового урока. */
  topicSuggestions: string[];
  /** Уроки выбранной четверти — для массового выставления и предпросмотра сетки. */
  lessons: BulkLesson[];
  /** ОЦЕНОЧНЫЕ ученики журнала (с учётом фильтра класса) — для массового выставления. */
  students: BulkStudent[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { flash, show, clear } = useFlash();
  /** Открытая вкладка панели добавления: один урок или сетка на четверть. */
  const [addTab, setAddTab] = useState<"one" | "grid" | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [askPending, startAskTransition] = useTransition();

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
            {QUARTERS.map((item) => {
              const isLocked = lockedQuarters.includes(item);
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => navigate({ quarter: String(item) })}
                  aria-pressed={item === quarter}
                  className={cn(
                    "focus-ring flex h-8 w-11 items-center justify-center gap-0.5 rounded text-sm font-medium transition-colors",
                    item === quarter
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  title={`${item} четверть${isLocked ? " — закрыта" : ""}`}
                >
                  {item}
                  {isLocked && <Lock className="h-2.5 w-2.5 opacity-70" aria-hidden />}
                </button>
              );
            })}
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
          {/* Экспорт — только иконка: текстовое место отдано «Кого спросить?» */}
          <a
            href={exportHref}
            download
            title="Скачать журнал в CSV — открывается в Excel"
            aria-label="Экспорт журнала в CSV"
            className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md border border-input bg-card transition-colors hover:bg-accent"
          >
            <Download className="h-4 w-4" aria-hidden />
          </a>
          {/* Инструменты записи в закрытой четверти прячутся: замок отобьёт их
              и на сервере (423), но предлагать обречённое действие незачем.
              В чисто безотметочном классе «Кого спросить?» не существует (v1). */}
          {!locked && mode !== "gradeless" && (
            <Button
              variant="outline"
              onClick={() => startAskTransition(() => navigate({ ask: askMode ? null : "1" }))}
              loading={askPending}
              aria-pressed={askMode}
              aria-busy={askPending}
              title="Подсветить учеников с малым числом оценок или давно не спрошенных"
              className={cn(askMode && "border-primary text-primary")}
            >
              {!askPending && <Sparkles className="h-4 w-4" aria-hidden />}
              <span className="hidden sm:inline">Кого спросить?</span>
            </Button>
          )}
          {!locked && lessons.length > 0 && students.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                setBulkOpen((value) => !value);
                setAddTab(null);
              }}
              title="Выставить оценку всем ученикам за один урок"
            >
              {bulkOpen ? (
                <X className="h-4 w-4" aria-hidden />
              ) : (
                <Users className="h-4 w-4" aria-hidden />
              )}
              <span className="hidden sm:inline">
                {bulkOpen ? "Отмена" : "Выставить всему классу"}
              </span>
            </Button>
          )}
          {!locked && (
            <Button
              onClick={() => {
                setAddTab((value) => (value ? null : "one"));
                setBulkOpen(false);
              }}
            >
              {addTab ? (
                <X className="h-4 w-4" aria-hidden />
              ) : (
                <CalendarPlus className="h-4 w-4" aria-hidden />
              )}
              {addTab ? "Отмена" : "Добавить урок"}
            </Button>
          )}
        </div>
      </div>

      {addTab && !locked && (
        <div className="animate-fade-in space-y-3 rounded-lg border border-rule-strong bg-secondary/50 p-3">
          {/* Сегмент: один столбец или сетка на всю четверть вперёд */}
          <div
            className="flex w-fit rounded-md border border-input bg-card p-0.5"
            role="group"
            aria-label="Способ добавления уроков"
          >
            {(
              [
                ["one", "Один урок"],
                ["grid", "Сетка на четверть"],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setAddTab(tab)}
                aria-pressed={addTab === tab}
                className={cn(
                  "focus-ring h-8 rounded px-3 text-sm font-medium transition-colors",
                  addTab === tab
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {addTab === "one" ? (
            <AddLessonForm
              subjectId={subjectId}
              quarter={quarter}
              hasPeriods={hasPeriods}
              topicSuggestions={topicSuggestions}
              onDone={(message) => {
                setAddTab(null);
                show("success", message);
                router.refresh();
              }}
              onError={(message) => show("error", message)}
            />
          ) : (
            <LessonGridForm
              /* key — чтобы при смене предмета/четверти выбор дней начинался заново */
              key={`${subjectId}-${quarter}-${year}`}
              subjectId={subjectId}
              year={year}
              quarter={quarter}
              currentPeriod={currentPeriod}
              lessons={lessons}
              onDone={(message) => {
                setAddTab(null);
                show("success", message);
                router.refresh();
              }}
              onError={(message) => show("error", message)}
            />
          )}
        </div>
      )}

      {/* Условие то же, что у кнопки-переключателя: панель не должна оставаться
          на экране, когда в четверти не осталось ни одного живого урока */}
      {bulkOpen && !locked && lessons.length > 0 && students.length > 0 && (
        <BulkGradePanel
          /* key — чтобы при смене урока/четверти панель начиналась с чистого выбора */
          key={`${subjectId}-${quarter}-${year}-${className ?? ""}`}
          lessons={lessons}
          students={students}
          onDone={(message) => {
            setBulkOpen(false);
            show("success", message);
            router.refresh();
          }}
          onError={(message) => show("error", message)}
        />
      )}

      {/* Смешанный журнал: оценочные и безотметочные классы в одной таблице —
          подсказываем сузить выбор, чтобы итоговые графы обрели один смысл */}
      {mode === "mixed" && (
        <p className="px-1 text-xs text-muted-foreground">
          Выберите класс — в журнале смешаны оценочные и безотметочные классы: строки ведутся
          каждая по своей системе, а итоги внизу считаются только по оценочным.
        </p>
      )}

      {/* Подсказка про клавиши бессмысленна там, где нет клавиатуры,
          и в закрытой четверти, где ввод оценок выключен. Набор клавиш
          зависит от режима: у безотметочного класса цифры — это уровни */}
      <p className={cn(
        "hidden flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground",
        !locked && "md:flex",
      )}>
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Keyboard className="h-3.5 w-3.5" aria-hidden />
          Горячие клавиши:
        </span>
        <span>
          <Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>↑</Kbd> <Kbd>↓</Kbd> — перемещение
        </span>
        {mode === "gradeless" ? (
          <>
            <span>
              <Kbd>1</Kbd> — усвоил, <Kbd>2</Kbd> — усваивает, <Kbd>3</Kbd> — нужна помощь
            </span>
            <span>
              <Kbd>Enter</Kbd> — уровень, печати и комментарий мышью
            </span>
            <span>
              <Kbd>Del</Kbd> — снять уровень
            </span>
          </>
        ) : (
          <>
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
            {mode === "mixed" && (
              <span>в безотметочных строках: 1·2·3 — уровни</span>
            )}
          </>
        )}
        <span>
          <Kbd>н</Kbd> — отметка «Н»
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
  topicSuggestions,
  onDone,
  onError,
}: {
  subjectId: string;
  quarter: Quarter;
  hasPeriods: boolean;
  topicSuggestions: string[];
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(() => toDateInputValue(new Date()));
  const [topic, setTopic] = useState("");
  const [lessonQuarter, setLessonQuarter] = useState<number>(quarter);

  return (
    // Контейнер (рамка, фон) — у общей панели с вкладками в JournalToolbar
    <form
      className="flex flex-wrap items-end gap-3"
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
          list="lesson-topic-suggestions"
        />
        {/* Подсказки — темы прошлых уроков этого предмета (все годы) */}
        <datalist id="lesson-topic-suggestions">
          {topicSuggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
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

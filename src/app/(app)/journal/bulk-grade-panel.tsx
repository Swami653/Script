"use client";

import { Eraser } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FieldHint, Label, Select } from "@/components/ui/field";
import { setGradesBulkAction } from "@/lib/actions/grades";
import {
  GRADE_KIND_KEYS,
  GRADE_KINDS,
  gradeColorClasses,
  MAX_BULK_GRADES,
  MAX_GRADE,
  MIN_GRADE,
  type GradeKind,
} from "@/lib/grades";
import { cn, formatDateShort, pluralize } from "@/lib/utils";

export type BulkLesson = { id: string; date: string; topic: string | null };
export type BulkStudent = { id: string; name: string };

const GRADE_BUTTONS = Array.from({ length: MAX_GRADE }, (_, index) => index + MIN_GRADE);

/**
 * Панель «Выставить всему классу»: выбор урока и типа работы, общая оценка
 * одним кликом всем, затем точечная правка отдельных учеников — и одна
 * отправка на сервер (setGradesBulkAction). «—» у ученика значит «не ставить».
 */
export function BulkGradePanel({
  lessons,
  students,
  onDone,
  onError,
}: {
  lessons: BulkLesson[];
  students: BulkStudent[];
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  // По умолчанию — последний урок четверти: обычно оценки ставят за него.
  const [lessonId, setLessonId] = useState(() => lessons[lessons.length - 1]?.id ?? "");
  const [kind, setKind] = useState<GradeKind>("regular");
  /** studentId -> оценка; отсутствие ключа = «не ставить». */
  const [values, setValues] = useState<Record<string, number>>({});

  /**
   * Действующий урок вычисляется на рендере, а не хранится вслепую: выбранный
   * урок могли отправить в корзину прямо из шапки журнала, и тогда состояние
   * указывало бы на урок, которого в списке уже нет.
   */
  const selectedLesson = lessons.some((lesson) => lesson.id === lessonId)
    ? lessonId
    : (lessons[lessons.length - 1]?.id ?? "");

  /** Список длиннее серверного лимита — выставить всем разом нельзя. */
  const tooManyStudents = students.length > MAX_BULK_GRADES;

  const count = useMemo(
    () => students.filter((student) => values[student.id] !== undefined).length,
    [students, values],
  );

  function setAll(value: number) {
    if (tooManyStudents) return;
    setValues(Object.fromEntries(students.map((student) => [student.id, value])));
  }

  function setOne(studentId: string, raw: string) {
    setValues((prev) => {
      const next = { ...prev };
      if (raw === "") delete next[studentId];
      else next[studentId] = Number(raw);
      return next;
    });
  }

  function submit() {
    const entries = students
      .filter((student) => values[student.id] !== undefined)
      .map((student) => ({ studentId: student.id, value: values[student.id]! }));
    if (entries.length === 0) {
      onError("Выберите хотя бы одну оценку");
      return;
    }
    if (entries.length > MAX_BULK_GRADES) {
      onError(
        `За один раз можно выставить не более ${MAX_BULK_GRADES} оценок — выберите класс в фильтре`,
      );
      return;
    }

    startTransition(async () => {
      const result = await setGradesBulkAction({ lessonId: selectedLesson, kind, entries });
      if (!result.ok) {
        onError(`${result.status}: ${result.error}`);
        return;
      }
      setValues({});
      onDone(result.message ?? "Оценки выставлены");
    });
  }

  return (
    <div className="animate-fade-in space-y-3 rounded-lg border border-rule-strong bg-secondary/50 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[210px] space-y-1.5">
          <Label htmlFor="bulk-lesson">Урок</Label>
          <Select
            id="bulk-lesson"
            value={selectedLesson}
            onChange={(event) => setLessonId(event.target.value)}
          >
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {formatDateShort(lesson.date)}
                {lesson.topic ? ` · ${lesson.topic}` : ""}
              </option>
            ))}
          </Select>
        </div>

        <div className="min-w-[170px] space-y-1.5">
          <Label htmlFor="bulk-kind">Тип работы</Label>
          <Select
            id="bulk-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as GradeKind)}
          >
            {GRADE_KIND_KEYS.map((item) => (
              <option key={item} value={item}>
                {GRADE_KINDS[item].label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Оценка всем сразу</Label>
          <div className="flex flex-wrap items-center gap-1">
            {GRADE_BUTTONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setAll(value)}
                disabled={tooManyStudents}
                title={
                  tooManyStudents
                    ? `В списке ${students.length} учеников — выберите класс в фильтре`
                    : `Поставить ${value} всем ученикам списка`
                }
                className={cn(
                  "focus-ring h-9 w-9 rounded text-sm font-bold tabular-nums transition-transform hover:scale-110",
                  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100",
                  gradeColorClasses(value),
                )}
              >
                {value}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setValues({})}
              title="Сбросить выбранные оценки"
              className="focus-ring ml-1 inline-flex h-9 items-center gap-1 rounded px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Eraser className="h-3.5 w-3.5" aria-hidden />
              Сброс
            </button>
          </div>
        </div>
      </div>

      {/* Точечная правка: у каждого ученика свою оценку можно поменять или снять */}
      <ul className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {students.map((student) => {
          const value = values[student.id];
          return (
            <li key={student.id} className="flex items-center gap-2">
              <label
                htmlFor={`bulk-grade-${student.id}`}
                className="min-w-0 flex-1 truncate text-sm"
              >
                {student.name}
              </label>
              <Select
                id={`bulk-grade-${student.id}`}
                value={value === undefined ? "" : String(value)}
                onChange={(event) => setOne(student.id, event.target.value)}
                className={cn(
                  "h-8 w-[4.6rem] py-0 text-center font-semibold tabular-nums",
                  value === undefined && "text-muted-foreground",
                )}
              >
                <option value="">—</option>
                {GRADE_BUTTONS.map((grade) => (
                  <option key={grade} value={grade}>
                    {grade}
                  </option>
                ))}
              </Select>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-3">
        <Button
          onClick={submit}
          loading={pending}
          disabled={count === 0 || !selectedLesson || count > MAX_BULK_GRADES}
        >
          Сохранить
          {count > 0 && (
            <span className="tabular-nums">
              — {count} {pluralize(count, "оценка", "оценки", "оценок")}
            </span>
          )}
        </Button>
        <FieldHint className="flex-1 basis-64">
          {tooManyStudents ? (
            <>
              В списке {students.length} учеников, а за один раз можно выставить не более{" "}
              {MAX_BULK_GRADES} оценок. Выберите класс в фильтре над журналом.
            </>
          ) : (
            <>
              Оценка встаёт в первую позицию клетки и заменяет уже стоящую, отметка «Н»
              у затронутых учеников снимается. «—» — ученику ничего не ставится.
            </>
          )}
        </FieldHint>
      </div>
    </div>
  );
}

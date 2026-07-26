import { signalSeverity, type Signal, type SignalLevel } from "@/lib/signals";
import { cn, pluralize } from "@/lib/utils";

/**
 * Единый рендер сигналов «требует внимания» для трёх витрин (журнал,
 * семейная карточка, /admin/attention). Тон различается словарём:
 *  * teacher — с цифрами («средний упал на 1.5»);
 *  * parent — формулировки-действия БЕЗ цифр и диагнозов.
 * Ученику сигналы не показываются нигде. Стиль по DESIGN.md: никакой
 * заливки и толстых полос — точка 8px + текст; спокойствие — типографская
 * норма, а не зелёный бейдж.
 */

/** Текст для учителя и администратора — с цифрами. */
export function signalTextTeacher(signal: Signal): string {
  switch (signal.kind) {
    case "avg-drop":
      return (
        `${signal.subjectName}: средний за две недели ниже прежнего на ${signal.delta.toFixed(2).replace(/\.?0+$/, "")}` +
        (signal.absentContext ? " (много пропусков — данные неполные)" : "")
      );
    case "below-own-average":
      return `${signal.subjectName}: ${signal.streak} последние оценки ниже собственного среднего`;
    case "absences":
      return `${signal.count} ${pluralize(signal.count, "пропуск", "пропуска", "пропусков")} за 30 дней`;
    case "silence":
      return `нет оценок ${signal.days} ${pluralize(signal.days, "день", "дня", "дней")} — возможно, журнал не заполняется`;
  }
}

/** Текст для родителя — действие без цифр. Имя — без фамилии. */
export function signalTextParent(signal: Signal, childFirstName: string): string {
  switch (signal.kind) {
    case "avg-drop":
      return signal.absentContext
        ? `${childFirstName} много пропускал(а), и последние оценки по предмету «${signal.subjectName}» ниже обычных — данные неполные. Спросите, всё ли догнали после пропусков.`
        : `По предмету «${signal.subjectName}» последние оценки ниже обычных для ${childFirstName}. Загляните в дневник и спросите, что сейчас проходят.`;
    case "below-own-average":
      return `По предмету «${signal.subjectName}» несколько оценок подряд ниже обычных. Возможно, тема даётся трудно — стоит спросить.`;
    case "absences":
      return `${childFirstName} пропустил(а) ${signal.count} ${pluralize(signal.count, "урок", "урока", "уроков")} за месяц — проверьте, всё ли записано и сдано.`;
    case "silence":
      // Родителю этот сигнал не показывается (parentVisibleSignals), текст — страховка.
      return "";
  }
}

const LEVEL_LABELS: Record<SignalLevel, string> = {
  ok: "Всё спокойно",
  watch: "Стоит взглянуть",
  act: "Поговорите с учителем",
};

/** Точка уровня, 8px: watch — amber, act — --destructive. Для ok не рисуется. */
export function AttentionDot({
  level,
  className,
  title,
}: {
  level: SignalLevel;
  className?: string;
  title?: string;
}) {
  if (level === "ok") return null;
  return (
    <span
      aria-hidden={title ? undefined : true}
      title={title}
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        level === "act" ? "bg-destructive" : "bg-amber-500 dark:bg-amber-400",
        className,
      )}
    />
  );
}

/** Статус-строка уровня: точка + подпись (спокойствие — muted-текст без точки). */
export function AttentionStatus({
  level,
  className,
}: {
  level: SignalLevel;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm",
        level === "ok" && "text-muted-foreground",
        level === "watch" && "font-medium text-amber-700 dark:text-amber-300",
        level === "act" && "font-medium text-destructive",
        className,
      )}
    >
      <AttentionDot level={level} />
      {LEVEL_LABELS[level]}
    </span>
  );
}

/**
 * Список формулировок. tone="parent" ожидает уже отфильтрованные
 * parentVisibleSignals (без silence, ≤2) и имя ребёнка без фамилии.
 */
export function SignalList({
  signals,
  tone,
  childFirstName = "",
  className,
}: {
  signals: readonly Signal[];
  tone: "teacher" | "parent";
  childFirstName?: string;
  className?: string;
}) {
  if (signals.length === 0) return null;
  return (
    <ul className={cn("space-y-1 text-sm", className)}>
      {signals.map((signal, index) => (
        <li key={index} className="flex items-start gap-1.5">
          <AttentionDot level={signalSeverity(signal)} className="mt-1.5" />
          <span className="min-w-0 flex-1">
            {tone === "teacher"
              ? signalTextTeacher(signal)
              : signalTextParent(signal, childFirstName)}
          </span>
        </li>
      ))}
    </ul>
  );
}

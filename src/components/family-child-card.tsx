import { Award, ChevronRight } from "lucide-react";
import Link from "next/link";

import { GradeChip } from "@/components/grade-chip";
import { LevelChip } from "@/components/level-chip";
import { QuarterSparkline } from "@/components/sparkline";
import { StampSealMini } from "@/components/stamp-seal";
import { stampLabel } from "@/lib/gradeless";
import { averageColorClasses, formatAverage } from "@/lib/grades";
import type { FamilyChildCard as CardData } from "@/lib/queries";
import { cn, formatDateShort, pluralize } from "@/lib/utils";

/**
 * Карточка ребёнка на /family. Два шаблона по assessment:
 *  * 3–4 класс — «что нового», свежие оценки чипами, средний + спарклайн;
 *  * 1–2 класс — ни одной цифры-оценки: печати, уровни, характеристика,
 *    посещаемость и текст «Оценок в 1–2 классах не ставят — так задумано».
 * Блок сигналов «Обратите внимание» передаётся снаружи (attention) —
 * карточка не знает о правилах, только рисует.
 */
export function FamilyChildCard({
  card,
  attention,
}: {
  card: CardData;
  attention?: React.ReactNode;
}) {
  const gradeless = card.assessment === "gradeless";
  const newTotal = gradeless
    ? card.newStamps + card.newMastery + card.newAbsences
    : card.newGrades + card.newAbsences;
  const sinceLabel = card.lastViewedAt === null ? "за последние две недели" : "с вашего визита";

  return (
    <article className="rounded-lg border border-rule-strong bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold tracking-tight">{card.student.name}</h2>
          <p className="text-xs text-muted-foreground">
            {card.student.className ?? "класс не указан"}
            {gradeless && " · безотметочное обучение"}
          </p>
        </div>
        {gradeless ? (
          <p className="flex items-center gap-1.5 text-sm font-semibold tabular-nums text-primary">
            <StampSealMini kind={null} seed={card.student.id} />
            {card.stampsYearTotal}{" "}
            {pluralize(card.stampsYearTotal, "печать", "печати", "печатей")}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            средний за {card.quarter} четверть{" "}
            <span
              className={cn(
                "text-lg font-extrabold tabular-nums",
                averageColorClasses(card.quarterAverage),
              )}
            >
              {formatAverage(card.quarterAverage)}
            </span>
          </p>
        )}
      </header>

      <div className="space-y-3 px-4 py-3">
        {/* «Что нового»: счётчики честно говорят, с какого момента считают */}
        {newTotal > 0 ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Новое {sinceLabel}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {gradeless
                ? card.recentGradeless.map((item) =>
                    item.type === "mastery" && item.level ? (
                      <LevelChip key={item.id} level={item.level} comment={null} />
                    ) : (
                      <span
                        key={item.id}
                        className="inline-flex h-7 items-center gap-1 rounded border border-primary/40 px-2 text-xs font-semibold text-primary"
                        title={`${stampLabel(item.kind)} · ${formatDateShort(item.date)}`}
                      >
                        <Award className="h-3.5 w-3.5" aria-hidden />
                        {stampLabel(item.kind)}
                      </span>
                    ),
                  )
                : card.recentChips.map((chip) => (
                    <GradeChip
                      key={chip.id}
                      value={chip.value}
                      kind={chip.kind}
                      comment={chip.comment}
                      acked={chip.acked}
                      ackStale={chip.ackStale}
                    />
                  ))}
              <span className="text-xs text-muted-foreground">
                {gradeless
                  ? [
                      card.newStamps > 0 &&
                        `${card.newStamps} ${pluralize(card.newStamps, "печать", "печати", "печатей")}`,
                      card.newMastery > 0 &&
                        `${card.newMastery} ${pluralize(card.newMastery, "уровень", "уровня", "уровней")}`,
                      card.newAbsences > 0 &&
                        `${card.newAbsences} ${pluralize(card.newAbsences, "пропуск", "пропуска", "пропусков")}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : [
                      `${card.newGrades} ${pluralize(card.newGrades, "оценка", "оценки", "оценок")}`,
                      card.newAbsences > 0 &&
                        `${card.newAbsences} ${pluralize(card.newAbsences, "пропуск", "пропуска", "пропусков")}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Нового {sinceLabel} нет
            {card.totalAbsences > 0 &&
              ` · пропусков за год: ${card.totalAbsences}`}
          </p>
        )}

        {gradeless ? (
          <>
            {card.quarterNote && (
              <p className="rounded-lg border border-rule-strong bg-secondary/40 px-3 py-2 text-sm italic">
                <span className="not-italic text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  От учителя за {card.quarter} четверть:{" "}
                </span>
                {card.quarterNote}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Оценок в 1–2 классах не ставят — так задумано: вместо баллов учитель
              отмечает уровни освоения, ставит печати-поощрения и пишет характеристику
              за четверть.
            </p>
          </>
        ) : (
          card.quarterAverages.some((value) => value !== null) && (
            <QuarterSparkline values={card.quarterAverages} width={280} height={56} />
          )
        )}

        {attention}
      </div>

      <footer className="border-t border-rule px-4 py-2.5">
        <Link
          href={`/family/child/${card.student.id}`}
          className="focus-ring flex min-h-11 items-center justify-between gap-2 rounded text-sm font-semibold text-primary hover:underline"
        >
          Открыть дневник
          {!gradeless && card.unackedCount > 0 && (
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              без вашей подписи: {card.unackedCount}
            </span>
          )}
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </Link>
      </footer>
    </article>
  );
}

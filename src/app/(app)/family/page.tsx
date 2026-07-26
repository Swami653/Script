import type { Metadata } from "next";

import { FamilyChildCard } from "@/components/family-child-card";
import { requirePageRole } from "@/lib/auth-guards";
import { getFamilyOverview } from "@/lib/queries";
import { formatYear, getActiveYear } from "@/lib/school-year";

export const metadata: Metadata = { title: "Мои дети" };

/**
 * Семейный экран — карточки детей родителя. Детей выводит ТОЛЬКО
 * getFamilyOverview по id родителя из СЕССИИ: параметра «какие дети»
 * не существует по построению, подменять нечего. Общешкольные выборки
 * (журнал, списки, агенда) сюда не импортируются — конвенция family-guards.
 */
export default async function FamilyPage() {
  const parent = await requirePageRole(["PARENT"]);
  const year = await getActiveYear();
  const cards = await getFamilyOverview(parent, year);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {formatYear(year)} учебный год
        </p>
        <h1 className="mt-1 text-[1.75rem] font-extrabold leading-tight tracking-tight">
          Мои дети
        </h1>
      </header>

      {cards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-rule-strong bg-card p-8 text-center text-sm text-muted-foreground">
          Ваша учётная запись пока не привязана к ученику. Скажите об этом учителю —
          привязку делает администратор школы.
        </p>
      ) : (
        <div className="space-y-4">
          {cards.map((card) => (
            <FamilyChildCard key={card.student.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}

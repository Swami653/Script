import type { Metadata } from "next";

import { requirePageRole } from "@/lib/auth-guards";
import { formatYear, getActiveYear } from "@/lib/school-year";

export const metadata: Metadata = { title: "Мои дети" };

/**
 * Семейный экран — карточки детей родителя. Каркас фазы «Семья»: детей
 * выводит ТОЛЬКО getFamilyOverview по id родителя из сессии (параметра
 * «какие дети» не существует по построению).
 */
export default async function FamilyPage() {
  await requirePageRole(["PARENT"]);
  const year = await getActiveYear();

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

      <p className="rounded-lg border border-dashed border-rule-strong bg-card p-8 text-center text-sm text-muted-foreground">
        Ваша учётная запись пока не привязана к ученику. Скажите об этом учителю —
        привязку делает администратор школы.
      </p>
    </div>
  );
}

import { ChevronLeft, ChevronRight, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuditFilter } from "@/app/(app)/admin/audit/audit-filter";
import { LocalTime } from "@/components/local-time";
import { requirePageRole } from "@/lib/auth-guards";
import { AUDIT_ACTION_LABELS, isAuditAction } from "@/lib/audit-actions";
import { AUDIT_PAGE_SIZE, getAuditLog } from "@/lib/queries";
import { cn, pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Журнал изменений" };

type SearchParams = Promise<{ page?: string; action?: string }>;

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  // Журнал изменений видит ТОЛЬКО администратор.
  await requirePageRole(["ADMIN"]);

  const params = await searchParams;
  const action = isAuditAction(params.action) ? params.action : null;
  const requestedPage = Number(params.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const { entries, total, pages } = await getAuditLog({ action, page });

  const hrefFor = (targetPage: number) =>
    `/admin/audit?${action ? `action=${encodeURIComponent(action)}&` : ""}page=${targetPage}`;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Журнал изменений</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Кто и когда выставлял оценки, удалял уроки и управлял пользователями.
          Записи хранят снимки имён и переживают удаление учётных записей.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{total}</span>{" "}
          {pluralize(total, "запись", "записи", "записей")}
          {action ? ` · фильтр: ${AUDIT_ACTION_LABELS[action].toLowerCase()}` : ""}
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-rule-strong bg-card p-3">
        <AuditFilter action={action} />
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-rule-strong bg-card p-10 text-center">
          <History className="mx-auto mb-3 h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-base font-semibold">Записей пока нет</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
            {action
              ? "По выбранному типу действия ничего не найдено — попробуйте «Все действия»."
              : "Как только кто-нибудь выставит оценку или изменит данные, запись появится здесь."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-rule-strong bg-card shadow-sm">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-rule-strong text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-3 py-2">Когда</th>
                <th scope="col" className="px-3 py-2">Кто</th>
                <th scope="col" className="px-3 py-2">Действие</th>
                <th scope="col" className="px-3 py-2">Кого коснулось</th>
                <th scope="col" className="px-3 py-2">Предмет</th>
                <th scope="col" className="px-3 py-2">Подробности</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-rule align-top hover:bg-primary/[0.04]">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                    <LocalTime iso={entry.createdAt.toISOString()} />
                  </td>
                  <td className="max-w-[12rem] truncate px-3 py-2 font-medium">{entry.actorName}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {isAuditAction(entry.action) ? AUDIT_ACTION_LABELS[entry.action] : entry.action}
                  </td>
                  <td className="max-w-[12rem] truncate px-3 py-2">{entry.targetName ?? "—"}</td>
                  <td className="max-w-[10rem] truncate px-3 py-2">{entry.subjectName ?? "—"}</td>
                  <td className="min-w-[16rem] px-3 py-2 text-muted-foreground">{entry.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav
          className="flex flex-wrap items-center justify-between gap-3"
          aria-label="Страницы журнала изменений"
        >
          <p className="text-sm text-muted-foreground">
            Страница <span className="font-semibold tabular-nums text-foreground">{page}</span> из{" "}
            <span className="tabular-nums">{pages}</span> · по {AUDIT_PAGE_SIZE} записей
          </p>
          <div className="flex items-center gap-2">
            <PageLink href={page > 1 ? hrefFor(page - 1) : null}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Новее
            </PageLink>
            <PageLink href={page < pages ? hrefFor(page + 1) : null}>
              Старее
              <ChevronRight className="h-4 w-4" aria-hidden />
            </PageLink>
          </div>
        </nav>
      )}
    </div>
  );
}

/** Кнопка перелистывания: ссылка или неактивная заглушка на краях. */
function PageLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  const styles =
    "inline-flex h-9 items-center gap-1 rounded-md border border-input bg-card px-3 text-sm font-medium";
  if (!href) {
    return (
      <span aria-disabled className={cn(styles, "cursor-not-allowed opacity-50")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={cn(styles, "focus-ring transition-colors hover:bg-accent")}>
      {children}
    </Link>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { AttentionStatus, SignalList } from "@/components/attention";
import { requirePageRole } from "@/lib/auth-guards";
import { getAttentionList } from "@/lib/queries";
import { formatYear, getActiveYear } from "@/lib/school-year";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Требует внимания" };

/**
 * Список «Требует внимания» для администратора: только watch/act,
 * act — первыми. Сигналы считаются при рендере и нигде не хранятся;
 * ученик и родитель этот список не видят (родителю — своя витрина
 * без сигнала о невыставлении оценок).
 */
export default async function AttentionPage() {
  await requirePageRole(["ADMIN"]);
  const year = await getActiveYear();
  const rows = await getAttentionList(year);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {formatYear(year)} учебный год
        </p>
        <h1 className="mt-1 text-[1.75rem] font-extrabold leading-tight tracking-tight">
          Требует внимания
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length === 0
            ? "Сигналы считаются на лету по оценкам и посещаемости и гаснут сами."
            : `${rows.length} ${pluralize(rows.length, "ученик", "ученика", "учеников")} — сигналы считаются на лету и гаснут сами, когда положение выправляется.`}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-rule-strong bg-card p-8 text-center text-sm text-muted-foreground">
          Сейчас поводов для беспокойства нет: ни падений средних, ни серий низких
          оценок, ни всплесков пропусков, ни молчащих журналов.
        </p>
      ) : (
        <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
          {rows.map((row) => (
            <li key={row.student.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <Link
                  href={`/journal/students/${row.student.id}`}
                  className="focus-ring rounded text-sm font-semibold hover:underline"
                >
                  {row.student.name}
                  {row.student.className && (
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      {row.student.className}
                    </span>
                  )}
                </Link>
                <AttentionStatus level={row.level} />
              </div>
              <SignalList signals={row.signals} tone="teacher" className="mt-1.5" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

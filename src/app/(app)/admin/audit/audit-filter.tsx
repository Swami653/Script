"use client";

import { useRouter } from "next/navigation";

import { Label, Select } from "@/components/ui/field";
import { AUDIT_ACTION_LABELS, AUDIT_ACTIONS } from "@/lib/audit-actions";

/** Фильтр по типу действия. Смена фильтра сбрасывает страницу на первую. */
export function AuditFilter({ action }: { action: string | null }) {
  const router = useRouter();

  return (
    <div className="min-w-[220px] space-y-1.5 sm:max-w-xs">
      <Label htmlFor="audit-action">Тип действия</Label>
      <Select
        id="audit-action"
        value={action ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          router.push(value ? `/admin/audit?action=${encodeURIComponent(value)}` : "/admin/audit");
        }}
      >
        <option value="">Все действия</option>
        {AUDIT_ACTIONS.map((item) => (
          <option key={item} value={item}>
            {AUDIT_ACTION_LABELS[item]}
          </option>
        ))}
      </Select>
    </div>
  );
}

"use client";

import { Badge } from "@/components/ui/badge";
import { LocalDate } from "@/components/local-time";
import type { ParentRow } from "@/lib/queries";

/**
 * Колонка Telegram в разделе «Семьи»: состояние привязки родителя.
 * Действия (выдать код, отозвать привязку) добавляет шаг «Уведомления
 * в Telegram» этой же фазы.
 */
export function TelegramColumn({
  parent,
}: {
  parent: ParentRow;
  /** Пароль для памятки — используется действиями шага Telegram. */
  memoPassword?: string | null;
}) {
  return (
    <div className="space-y-1">
      {parent.telegram === "linked" && <Badge tone="success">привязан</Badge>}
      {parent.telegram === "blocked" && (
        <Badge tone="danger" title="Родитель заблокировал бота — уведомления не доставляются">
          заблокировал бота
        </Badge>
      )}
      {parent.telegram === "code_issued" && parent.codeExpiresAt && (
        <p className="text-xs text-muted-foreground">
          код выдан до <LocalDate iso={parent.codeExpiresAt.toISOString()} />
        </p>
      )}
      {parent.telegram === "none" && (
        <span className="text-xs text-muted-foreground">не подключён</span>
      )}
    </div>
  );
}

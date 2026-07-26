"use client";

import { Printer, Send, Unlink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Flash, useFlash } from "@/components/flash";
import { LocalDate } from "@/components/local-time";
import { printMemo } from "@/components/parent-manager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  createTelegramCodeAction,
  revokeTelegramLinkAction,
} from "@/lib/actions/telegram";
import type { ParentRow } from "@/lib/queries";

/**
 * Колонка Telegram в разделе «Семьи»: состояние привязки + выдача
 * одноразового кода и отзыв. Код показывается ОДИН раз (в БД — только
 * хеш) и сразу предлагается на печать вместе с логином/паролем памятки.
 */
export function TelegramColumn({
  parent,
  memoPassword,
}: {
  parent: ParentRow;
  /** Временный пароль для памятки; null — родитель уже входил. */
  memoPassword?: string | null;
}) {
  const router = useRouter();
  const { flash, show, clear } = useFlash();
  const [pending, startTransition] = useTransition();
  /** Свежевыданный код — жив только до перезагрузки, как пароль при создании. */
  const [freshCode, setFreshCode] = useState<{ code: string; deepLink: string | null } | null>(
    null,
  );

  function handleIssueCode() {
    startTransition(async () => {
      const result = await createTelegramCodeAction({ userId: parent.id });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      setFreshCode({ code: result.data.code, deepLink: result.data.deepLink });
      show("success", `Код для ${parent.name}: ${result.data.code} (действует 72 часа)`);
      router.refresh();
    });
  }

  function handleRevoke() {
    if (
      !window.confirm(
        `Отключить Telegram у «${parent.name}»? Привязка и непогашенные коды будут удалены.`,
      )
    )
      return;
    startTransition(async () => {
      const result = await revokeTelegramLinkAction({ userId: parent.id });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      setFreshCode(null);
      show("success", result.message ?? "Привязка отключена");
      router.refresh();
    });
  }

  return (
    <div className="space-y-1.5">
      {parent.telegram === "linked" && <Badge tone="success">привязан</Badge>}
      {parent.telegram === "blocked" && (
        <Badge tone="danger" title="Родитель заблокировал бота — уведомления не доставляются">
          заблокировал бота
        </Badge>
      )}
      {parent.telegram === "code_issued" && parent.codeExpiresAt && (
        <p className="text-xs text-muted-foreground">
          код выдан, действует до <LocalDate iso={parent.codeExpiresAt.toISOString()} />
        </p>
      )}
      {parent.telegram === "none" && (
        <p className="text-xs text-muted-foreground">не подключён</p>
      )}

      {freshCode && (
        <p
          className="w-fit rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-100"
          title="Код показывается один раз — в базе хранится только его хеш"
        >
          {freshCode.code}
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={handleIssueCode}
          disabled={pending}
          title="Одноразовый код на 72 часа. Действующую привязку повторная выдача не рвёт."
        >
          <Send className="h-3.5 w-3.5" aria-hidden />
          Выдать код
        </Button>
        {freshCode && memoPassword && (
          <Button
            size="sm"
            variant="outline"
            title="Памятка с логином, паролем и кодом Telegram"
            onClick={() =>
              printMemo({
                parentName: parent.name,
                username: parent.username,
                password: memoPassword,
                telegramCode: freshCode.code,
                deepLink: freshCode.deepLink,
              })
            }
          >
            <Printer className="h-3.5 w-3.5" aria-hidden />С кодом
          </Button>
        )}
        {(parent.telegram === "linked" ||
          parent.telegram === "blocked" ||
          parent.telegram === "code_issued") && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRevoke}
            disabled={pending}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Разорвать привязку и погасить коды"
          >
            <Unlink className="h-3.5 w-3.5" aria-hidden />
            Отозвать
          </Button>
        )}
      </div>

      <Flash message={flash} onClose={clear} />
    </div>
  );
}

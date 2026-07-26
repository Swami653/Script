"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Flash, useFlash } from "@/components/flash";
import { LocalDate } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { disconnectMyTelegramAction } from "@/lib/actions/telegram";

/**
 * Блок Telegram в профиле родителя: статус привязки и кнопка «Отключить»
 * (аналог команды /stop боту). Подключение — только через код от
 * администратора: самовыдачи кода в профиле нет намеренно.
 */
export function TelegramProfile({
  link,
}: {
  link: { createdAt: string; blockedAt: string | null } | null;
}) {
  const router = useRouter();
  const { flash, show, clear } = useFlash();
  const [pending, startTransition] = useTransition();

  function handleDisconnect() {
    if (
      !window.confirm(
        "Отключить уведомления Telegram? Чтобы подключить их снова, понадобится новый код от администратора.",
      )
    )
      return;
    startTransition(async () => {
      const result = await disconnectMyTelegramAction();
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      show("success", result.message ?? "Уведомления отключены");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {link ? (
        <>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Send className="h-4 w-4 text-primary" aria-hidden />
            {link.blockedAt ? (
              <>
                <Badge tone="danger">бот заблокирован</Badge>
                <span className="text-muted-foreground">
                  уведомления не доставляются — разблокируйте бота и отправьте ему новый код
                </span>
              </>
            ) : (
              <>
                <Badge tone="success">подключены</Badge>
                <span className="text-muted-foreground">
                  с <LocalDate iso={link.createdAt} />
                </span>
              </>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            В сообщениях — имя ребёнка без фамилии, предмет, оценка и дата. Комментарии
            учителя в Telegram не отправляются никогда.
          </p>
          <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={pending}>
            Отключить уведомления
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Уведомления не подключены. Попросите у администратора школы одноразовый код и
          отправьте его школьному боту в Telegram — это же можно сделать по ссылке с
          памятки.
        </p>
      )}
      <Flash message={flash} onClose={clear} />
    </div>
  );
}

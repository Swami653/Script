import { createHash } from "node:crypto";

/**
 * Тонкий отправитель Telegram. Только сервер (node:crypto, env с токеном).
 *
 * ПРАВИЛА:
 *  * sendTelegramMessage НИКОГДА не бросает — возвращает статус. Падение
 *    Telegram не имеет права уронить выставление оценки или дренаж.
 *  * В сообщения не попадают фамилия ребёнка и комментарий учителя —
 *    тексты собирает telegram-notify.ts из полей-снимков outbox, в
 *    которых комментария нет на уровне схемы.
 */

const API_TIMEOUT_MS = 5000;

export type SendResult = "ok" | "blocked" | "error";

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

/** SHA-256-хеш кода привязки — единственная форма, в которой код живёт в БД. */
export function hashLinkCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/** Нормализация текста от пользователя бота: «/start AB12…», «ab 12…» → «AB12…». */
export function normalizeLinkCode(text: string): string {
  return text
    .replace(/^\/start(@\w+)?/i, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

/**
 * Отправка одного сообщения. "blocked" — родитель заблокировал бота
 * (403 forbidden), ретраи бессмысленны; "error" — всё остальное
 * (сеть, лимиты, кривой chatId) — событие останется в outbox на повтор.
 */
export async function sendTelegramMessage(chatId: string, text: string): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return "error";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.ok) return "ok";
    // 403 — «bot was blocked by the user»: канал мёртв, повторять нечего.
    if (response.status === 403) return "blocked";
    console.warn(`[telegram] sendMessage ${response.status} для чата ${chatId}`);
    return "error";
  } catch (error) {
    console.warn("[telegram] sendMessage не удался:", error);
    return "error";
  }
}

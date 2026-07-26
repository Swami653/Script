import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { hashLinkCode, normalizeLinkCode, sendTelegramMessage } from "@/lib/telegram";

/**
 * Приём апдейтов Telegram-бота. Сессии здесь нет и быть не может:
 * аутентификациями служат secret_token вебхука (шаг 1) и сам одноразовый
 * код (шаг гашения). Ответ пользователю — нейтральный, БЕЗ имён детей:
 * перехваченный код не должен раскрывать, чей это ребёнок.
 *
 * Телеграму всегда отвечаем 200 (кроме неверного секрета) — иначе он
 * ретраит бесконечно. Rate-limit перебора кодов не нужен: подделать
 * запрос мимо secret_token нельзя, а живой Telegram сам ограничивает
 * частоту сообщений (~1/с) — 2^40 кодов при TTL 72 ч не перебираются.
 */

const CONFIRM_TEXT =
  "Уведомления подключены. Если это сделали не вы — сообщите в школу.";
const STOP_TEXT = "Уведомления отключены. Новый код привязки выдаёт администратор школы.";
const REJECT_TEXT = "Код не подошёл или истёк. Попросите новый у администратора школы.";

export async function POST(request: NextRequest) {
  // Шаг 1: настоящий HTTP 401 при неверном секрете вебхука.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "Недействительный запрос" }, { status: 401 });
  }

  try {
    // Шаг 2: из апдейта берём только chat.id и text; всё прочее — 200 без реакции.
    const update: unknown = await request.json().catch(() => null);
    const message = (update as { message?: { chat?: { id?: unknown }; text?: unknown } } | null)
      ?.message;
    const chatIdRaw = message?.chat?.id;
    const text = typeof message?.text === "string" ? message.text.trim() : null;
    if ((typeof chatIdRaw !== "number" && typeof chatIdRaw !== "string") || !text) {
      return NextResponse.json({ ok: true });
    }
    // chatId — строкой: телеграмный int64 не влезает в safe integer JS.
    const chatId = String(chatIdRaw);

    // Шаг 3: /stop — отключение по инициативе родителя.
    if (/^\/stop(@\w+)?$/i.test(text)) {
      await prisma.telegramLink.deleteMany({ where: { chatId } });
      await sendTelegramMessage(chatId, STOP_TEXT);
      return NextResponse.json({ ok: true });
    }

    // Шаг 4: гашение кода АТОМАРНО — updateMany по хешу с условиями
    // «не использован и не истёк»; два параллельных сообщения с одним
    // кодом дадут ровно одну привязку.
    const codeHash = hashLinkCode(normalizeLinkCode(text));
    const now = new Date();
    const burned = await prisma.telegramLinkCode.updateMany({
      where: { codeHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (burned.count !== 1) {
      console.warn(`[telegram] неудачная попытка привязки из чата ${chatId}`);
      await sendTelegramMessage(chatId, REJECT_TEXT);
      return NextResponse.json({ ok: true });
    }

    // Шаг 5: владелец кода перечитывается из БД — код, выданный до смены
    // роли, не привяжет не-родителя.
    const code = await prisma.telegramLinkCode.findUnique({
      where: { codeHash },
      select: { userId: true, user: { select: { role: true } } },
    });
    if (!code || code.user.role !== "PARENT") {
      await sendTelegramMessage(chatId, REJECT_TEXT);
      return NextResponse.json({ ok: true });
    }

    try {
      await prisma.telegramLink.upsert({
        where: { userId: code.userId },
        create: { userId: code.userId, chatId },
        // Новая привязка снимает blockedAt: родитель разблокировал бота.
        update: { chatId, blockedAt: null },
      });
    } catch (error) {
      // P2002 по chatId: этот чат уже привязан к ДРУГОМУ аккаунту.
      console.warn(`[telegram] чат ${chatId} уже привязан к другому аккаунту:`, error);
      await sendTelegramMessage(chatId, REJECT_TEXT);
      return NextResponse.json({ ok: true });
    }

    // Шаг 6: подтверждение НЕЙТРАЛЬНОЕ — без имён детей (решение §1 п.7).
    await sendTelegramMessage(chatId, CONFIRM_TEXT);
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Шаг 7: внутренние ошибки тоже 200 — иначе бесконечные ретраи Телеграма.
    console.error("[telegram] webhook упал:", error);
    return NextResponse.json({ ok: true });
  }
}

import { NextResponse, type NextRequest } from "next/server";

import { drainNotifications } from "@/lib/telegram-notify";

/**
 * Страховочный дренаж outbox по Vercel Cron (раз в сутки, см. vercel.json):
 * основной запуск — after() после действий с оценками, но если учитель
 * поставил оценки вечером и закрыл ноутбук до конца after, утренний cron
 * дошлёт хвост. Cron аутентифицируется CRON_SECRET (Vercel подставляет
 * заголовок сам); всем остальным — настоящий 401.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  }

  const result = await drainNotifications();
  return NextResponse.json(result);
}

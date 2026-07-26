import { asGradeKind, GRADE_KINDS } from "@/lib/grades";
import { prisma } from "@/lib/prisma";
import { isTelegramConfigured, sendTelegramMessage } from "@/lib/telegram";
import { firstNameOf, formatDateShort } from "@/lib/utils";

/**
 * Дренаж outbox уведомлений (NotificationEvent → Telegram-дайджесты).
 *
 * Получатели резолвятся ЖИВЫМ запросом ParentLink→TelegramLink в момент
 * отправки: отвязанный родитель перестаёт получать уведомления со
 * следующего же дренажа, без чистки очереди. Строка outbox — СОБЫТИЕ,
 * а не пара «родитель×событие».
 *
 * Семантика at-least-once: при гонке двух дренажей возможен редкий дубль
 * дайджеста — осознанная цена вместо распределённого лока (учитель один,
 * окно тишины склеивает серии).
 *
 * ПРИВАТНОСТЬ: имя ребёнка — БЕЗ фамилии (firstNameOf), комментарий
 * учителя не отправляется никогда (его нет даже в таблице очереди),
 * сигналы и средние не отправляются.
 */

/** Окно тишины: серия оценок одного урока склеивается в один дайджест. */
const QUIET_WINDOW_MS = 3 * 60 * 1000;
/** После стольких неудач событие считается мёртвым и больше не пытается. */
const MAX_ATTEMPTS = 5;
/** Сколько событий разбирается за один прогон. */
const BATCH_SIZE = 200;
/** Пауза между сообщениями — лимиты Telegram (~30 msg/s суммарно). */
const SEND_PAUSE_MS = 50;

/** Насколько подробное сообщение (AppSetting["telegramDetail"]). */
export const TELEGRAM_DETAIL_KEY = "telegramDetail";
type TelegramDetail = "fact" | "subject" | "value";

const SITE_URL =
  process.env.APP_BASE_URL?.replace(/\/$/, "") ?? "https://school-journal-six.vercel.app";

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readDetail(): Promise<TelegramDetail> {
  const setting = await prisma.appSetting.findUnique({ where: { key: TELEGRAM_DETAIL_KEY } });
  return setting?.value === "fact" || setting?.value === "subject" ? setting.value : "value";
}

type OutboxEvent = {
  id: string;
  studentId: string;
  studentName: string;
  subjectName: string;
  lessonDate: Date;
  value: number;
  kind: string;
};

/** «Математика: 8 (контрольная), 24.07» или «Математика, 24.07» без балла. */
function eventLine(event: OutboxEvent, detail: TelegramDetail): string {
  const date = formatDateShort(event.lessonDate);
  if (detail === "subject") return `${event.subjectName}, ${date}`;
  const kind = asGradeKind(event.kind);
  const kindNote = kind !== "regular" ? ` (${GRADE_KINDS[kind].label.toLowerCase()})` : "";
  return `${event.subjectName}: ${event.value}${kindNote}, ${date}`;
}

/** Дайджест одному родителю по всем его детям. Имя — без фамилии. */
function buildDigest(events: OutboxEvent[], detail: TelegramDetail): string {
  if (detail === "fact") {
    return `Есть новые записи в дневнике.\nПодробности: ${SITE_URL}/family`;
  }
  const byStudent = new Map<string, OutboxEvent[]>();
  for (const event of events) {
    const list = byStudent.get(event.studentId) ?? [];
    list.push(event);
    byStudent.set(event.studentId, list);
  }
  const lines = [...byStudent.values()].map((list) => {
    const name = firstNameOf(list[0]!.studentName);
    return `${name} — ${list.map((event) => eventLine(event, detail)).join("; ")}`;
  });
  return `Новые записи в дневнике:\n${lines.join("\n")}\nПодробности: ${SITE_URL}/family`;
}

/**
 * Разобрать очередь: собрать получателей, отправить дайджесты, отметить
 * события. НИКОГДА не бросает — дренаж запускается из after() действий
 * с оценками, и его падение не должно быть заметно учителю.
 */
export async function drainNotifications(): Promise<{ sent: number; dead: number }> {
  try {
    return await drain();
  } catch (error) {
    console.error("[telegram] дренаж уведомлений упал:", error);
    return { sent: 0, dead: 0 };
  }
}

async function drain(): Promise<{ sent: number; dead: number }> {
  // Токен не настроен — события просто ждут в очереди, попытки не тратятся.
  if (!isTelegramConfigured()) return { sent: 0, dead: 0 };

  const now = new Date();
  const events = await prisma.notificationEvent.findMany({
    where: {
      sentAt: null,
      attempts: { lt: MAX_ATTEMPTS },
      createdAt: { lte: new Date(now.getTime() - QUIET_WINDOW_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: {
      id: true,
      studentId: true,
      studentName: true,
      subjectName: true,
      lessonDate: true,
      value: true,
      kind: true,
    },
  });
  if (events.length === 0) return { sent: 0, dead: 0 };

  // Получатели — ЖИВЫМ запросом: только текущие связи и незаблокированные чаты.
  const studentIds = [...new Set(events.map((event) => event.studentId))];
  const links = await prisma.parentLink.findMany({
    where: {
      studentId: { in: studentIds },
      parent: { telegramLink: { isNot: null } },
    },
    select: {
      studentId: true,
      parent: {
        select: { id: true, telegramLink: { select: { id: true, chatId: true, blockedAt: true } } },
      },
    },
  });

  /** studentId → получатели (родители с живой, незаблокированной привязкой). */
  const recipientsByStudent = new Map<
    string,
    { parentId: string; linkId: string; chatId: string }[]
  >();
  for (const link of links) {
    const telegram = link.parent.telegramLink;
    if (!telegram || telegram.blockedAt) continue;
    const list = recipientsByStudent.get(link.studentId) ?? [];
    list.push({ parentId: link.parent.id, linkId: telegram.id, chatId: telegram.chatId });
    recipientsByStudent.set(link.studentId, list);
  }

  // События без единого получателя закрываются сразу — иначе копились бы вечно.
  const orphanIds = events
    .filter((event) => (recipientsByStudent.get(event.studentId) ?? []).length === 0)
    .map((event) => event.id);
  const deliverable = events.filter(
    (event) => (recipientsByStudent.get(event.studentId) ?? []).length > 0,
  );

  // Группировка: одному родителю — ОДИН дайджест по всем его детям.
  const byParent = new Map<string, { chatId: string; linkId: string; events: OutboxEvent[] }>();
  for (const event of deliverable) {
    for (const recipient of recipientsByStudent.get(event.studentId) ?? []) {
      const entry = byParent.get(recipient.parentId) ?? {
        chatId: recipient.chatId,
        linkId: recipient.linkId,
        events: [],
      };
      entry.events.push(event);
      byParent.set(recipient.parentId, entry);
    }
  }

  const detail = await readDetail();
  const resultByParent = new Map<string, "ok" | "blocked" | "error">();
  const blockedLinkIds: string[] = [];
  let first = true;
  for (const [parentId, entry] of byParent) {
    if (!first) await pause(SEND_PAUSE_MS);
    first = false;
    const result = await sendTelegramMessage(entry.chatId, buildDigest(entry.events, detail));
    resultByParent.set(parentId, result);
    if (result === "blocked") blockedLinkIds.push(entry.linkId);
  }

  // Итог по событию: ошибок нет (ok или blocked у всех получателей) → sent;
  // была ошибка → attempts+1. «blocked» не ошибка: канал мёртв, привязка
  // помечается, и следующий дренаж этого получателя уже не увидит.
  const sentIds: string[] = [...orphanIds];
  const retryIds: string[] = [];
  for (const event of deliverable) {
    const outcomes = (recipientsByStudent.get(event.studentId) ?? []).map(
      (recipient) => resultByParent.get(recipient.parentId) ?? "error",
    );
    if (outcomes.some((outcome) => outcome === "error")) retryIds.push(event.id);
    else sentIds.push(event.id);
  }

  const [, , retried] = await prisma.$transaction([
    prisma.telegramLink.updateMany({
      where: { id: { in: blockedLinkIds } },
      data: { blockedAt: now },
    }),
    prisma.notificationEvent.updateMany({
      where: { id: { in: sentIds } },
      data: { sentAt: now },
    }),
    prisma.notificationEvent.findMany({
      where: { id: { in: retryIds }, attempts: { gte: MAX_ATTEMPTS - 1 } },
      select: { id: true },
    }),
    prisma.notificationEvent.updateMany({
      where: { id: { in: retryIds } },
      data: { attempts: { increment: 1 } },
    }),
  ]);

  return { sent: sentIds.length - orphanIds.length, dead: retried.length };
}

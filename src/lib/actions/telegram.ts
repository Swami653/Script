"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth-guards";
import { generateLinkCode } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { hashLinkCode } from "@/lib/telegram";

/**
 * Привязка Telegram. Код выдаёт ТОЛЬКО администратор и вручает родителю
 * лично (никакой самовыдачи — решение §1 п.20 спецификации фазы).
 * В БД живёт только SHA-256-хеш кода; открытый код показывается один раз
 * (дисциплина tempPassword). Сам код в аудит НЕ пишется — как пароли.
 */

/** Срок жизни кода привязки: памятки печатают накануне собрания. */
const CODE_TTL_HOURS = 72;

const userIdSchema = z.object({ userId: z.string().min(1, "Не указан пользователь") });

/**
 * ADMIN: выдать одноразовый код привязки (8 символов, ~40 бит, TTL 72 ч).
 * Старые непогашенные коды пользователя гасятся — живой код всегда один.
 * Действующую привязку повторная выдача НЕ рвёт: родитель мог просто
 * потерять памятку до того, как ей воспользовался.
 */
export async function createTelegramCodeAction(input: {
  userId: string;
}): Promise<ActionResult<{ code: string; expiresAt: string; deepLink: string | null }>> {
  try {
    const admin = await requireRole(["ADMIN"]);
    const { userId } = userIdSchema.parse(input);

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, username: true, role: true },
    });
    if (!target || target.role !== "PARENT") {
      return actionFail("Код привязки выдаётся только пользователю с ролью «Родитель»", 400);
    }

    const code = generateLinkCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_HOURS * 60 * 60 * 1000);
    await prisma.$transaction([
      prisma.telegramLinkCode.deleteMany({ where: { userId, usedAt: null } }),
      prisma.telegramLinkCode.create({
        data: { userId, codeHash: hashLinkCode(code), expiresAt },
      }),
    ]);

    // Факт выдачи — в аудит, сам код — никогда (правило «как пароли»).
    await logAudit({
      actor: admin,
      action: "telegram.code",
      targetName: target.username,
      details: `Выдан код привязки Telegram для «${target.name}», действует ${CODE_TTL_HOURS} ч`,
    });

    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    revalidatePath("/admin");
    return actionOk(
      {
        code,
        expiresAt: expiresAt.toISOString(),
        deepLink: botUsername ? `https://t.me/${botUsername}?start=${code}` : null,
      },
      "Код создан — покажите или напечатайте его один раз",
    );
  } catch (error) {
    return actionError(error);
  }
}

/** ADMIN: разорвать привязку (телефон утерян, доступ отозван) + погасить коды. */
export async function revokeTelegramLinkAction(input: {
  userId: string;
}): Promise<ActionResult<null>> {
  try {
    const admin = await requireRole(["ADMIN"]);
    const { userId } = userIdSchema.parse(input);

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, username: true },
    });
    if (!target) return actionFail("Пользователь не найден", 404);

    const [links] = await prisma.$transaction([
      prisma.telegramLink.deleteMany({ where: { userId } }),
      prisma.telegramLinkCode.deleteMany({ where: { userId, usedAt: null } }),
    ]);

    await logAudit({
      actor: admin,
      action: "telegram.unlink",
      targetName: target.username,
      details:
        links.count > 0
          ? `Привязка Telegram пользователя «${target.name}» разорвана администратором`
          : `Непогашенные коды Telegram пользователя «${target.name}» отозваны`,
    });

    revalidatePath("/admin");
    revalidatePath("/profile");
    return actionOk(null, "Привязка Telegram отключена");
  } catch (error) {
    return actionError(error);
  }
}

/** PARENT: отключить СВОЮ привязку из профиля (аналог /stop боту). */
export async function disconnectMyTelegramAction(): Promise<ActionResult<null>> {
  try {
    const parent = await requireRole(["PARENT"]);

    const { count } = await prisma.telegramLink.deleteMany({ where: { userId: parent.id } });
    if (count === 0) return actionOk(null, "Привязки уже не было");

    await logAudit({
      actor: parent,
      action: "telegram.unlink",
      targetName: parent.username,
      details: "Родитель отключил свою привязку Telegram из профиля",
    });

    revalidatePath("/profile");
    revalidatePath("/admin");
    return actionOk(null, "Уведомления Telegram отключены");
  } catch (error) {
    return actionError(error);
  }
}

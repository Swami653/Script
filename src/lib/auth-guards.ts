import { cache } from "react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { asRole, ROLE_HOME, type Role } from "@/lib/roles";

/**
 * ЕДИНАЯ ТОЧКА ПРОВЕРКИ ПРАВ НА СЕРВЕРЕ.
 *
 * Любое Server Action и любой Route Handler, который читает или меняет данные,
 * ОБЯЗАН начинаться с requireRole(...) / requireUser(). Проверка на клиенте
 * (скрытые кнопки) и в middleware — только удобство, а не защита.
 *
 * ВАЖНО: роль и сам факт существования пользователя берутся из БАЗЫ, а не из
 * JWT. JWT живёт до 12 часов, поэтому доверять роли из токена нельзя: удалённый
 * или понижённый пользователь иначе работал бы по старому токену. Свежие данные
 * из БД закрывают это одним запросом (кэшируется на время одного рендера).
 */

export type SessionUser = {
  id: string;
  name: string;
  /** Логин для входа. Почта необязательна и здесь не участвует. */
  username: string;
  role: Role;
  className: string | null;
};

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "Требуется вход в систему") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "Недостаточно прав для этого действия") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Текущий пользователь или null. Ничего не бросает.
 *
 * Обёрнут в React cache(): в пределах одного запроса/рендера БД спрашивается
 * один раз, даже если guard вызывается и в layout, и на странице.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;

  // Сверка с базой: роль и существование берём из актуальных данных, а не из JWT.
  const fresh = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
      className: true,
      sessionVersion: true,
    },
  });

  // Пользователь удалён — сессия недействительна.
  if (!fresh) return null;

  // Пароль сменили/сбросили после выпуска токена — старую сессию не принимаем.
  const tokenVersion = typeof session.user.sessionVersion === "number"
    ? session.user.sessionVersion
    : 0;
  if (fresh.sessionVersion !== tokenVersion) return null;

  return {
    id: fresh.id,
    name: fresh.name,
    username: fresh.username,
    role: asRole(fresh.role),
    className: fresh.className,
  };
});

/** Для Server Actions / API: бросает 401, если пользователь не авторизован. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/**
 * Для Server Actions / API: бросает 403, если роль не входит в список разрешённых.
 * Именно эта функция гарантирует, что ученик не сможет выставить оценку,
 * даже если отправит запрос напрямую, в обход интерфейса.
 */
export async function requireRole(allowed: readonly Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!allowed.includes(user.role)) {
    throw new ForbiddenError(
      `Действие доступно только для ролей: ${allowed.join(", ")}. Ваша роль: ${user.role}.`,
    );
  }
  return user;
}

/** Для страниц (Server Components): вместо ошибки — редирект на /login. */
export async function requirePageUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Для страниц: пускает только указанные роли, остальных уводит на их раздел. */
export async function requirePageRole(allowed: readonly Role[]): Promise<SessionUser> {
  const user = await requirePageUser();
  if (!allowed.includes(user.role)) {
    redirect(ROLE_HOME[user.role]);
  }
  return user;
}

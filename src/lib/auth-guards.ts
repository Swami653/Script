import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { asRole, ROLE_HOME, type Role } from "@/lib/roles";

/**
 * ЕДИНАЯ ТОЧКА ПРОВЕРКИ ПРАВ НА СЕРВЕРЕ.
 *
 * Любое Server Action и любой Route Handler, который читает или меняет данные,
 * ОБЯЗАН начинаться с requireRole(...) / requireUser(). Проверка на клиенте
 * (скрытые кнопки) и в middleware — только удобство, а не защита.
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

/** Текущий пользователь или null. Ничего не бросает. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  return {
    id: session.user.id,
    name: session.user.name ?? "",
    username: session.user.username ?? "",
    role: asRole(session.user.role),
    className: session.user.className ?? null,
  };
}

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

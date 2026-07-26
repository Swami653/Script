import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

/**
 * Первый рубеж защиты: неавторизованных отправляем на /login,
 * а роли — на «свои» разделы (логика в authConfig.callbacks.authorized).
 *
 * ВНИМАНИЕ: middleware НЕ является достаточной защитой. Каждая страница
 * и каждое Server Action обязаны самостоятельно проверять роль через
 * requireRole()/requireUser() из src/lib/auth-guards.ts.
 */
export const { auth: middleware } = NextAuth(authConfig);

export default middleware;

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

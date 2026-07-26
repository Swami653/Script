import type { NextAuthConfig } from "next-auth";

import { asRole, ROLE_HOME } from "@/lib/roles";

/**
 * Edge-совместимая часть конфигурации NextAuth.
 *
 * Здесь НЕТ Prisma и bcrypt — этот файл импортируется middleware, который
 * выполняется в Edge Runtime. Полная конфигурация с провайдером — в src/auth.ts.
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [],
  callbacks: {
    /** Роль кладём в JWT, чтобы проверять её без обращения к БД. */
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = asRole(user.role);
        token.username = user.username ?? null;
        token.className = user.className ?? null;
        token.sessionVersion = typeof user.sessionVersion === "number" ? user.sessionVersion : 0;
      }
      if (trigger === "update" && session?.name) {
        token.name = session.name as string;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = asRole(token.role);
        session.user.username = token.username ?? null;
        session.user.className = token.className ?? null;
        session.user.sessionVersion =
          typeof token.sessionVersion === "number" ? token.sessionVersion : 0;
      }
      return session;
    },
    /**
     * Проверка доступа на уровне middleware.
     * Это только первый рубеж — итоговое решение всегда принимают
     * серверные проверки в Server Actions и на страницах (см. src/lib/auth-guards.ts).
     */
    authorized({ auth, request: { nextUrl } }) {
      const user = auth?.user;
      const { pathname } = nextUrl;

      if (pathname === "/login") {
        if (user) {
          return Response.redirect(new URL(ROLE_HOME[asRole(user.role)], nextUrl));
        }
        return true;
      }

      if (!user) return false;

      const role = asRole(user.role);

      // Ученик не имеет доступа к журналу учителя и админ-панели.
      if (pathname.startsWith("/journal") && role === "STUDENT") {
        return Response.redirect(new URL("/student", nextUrl));
      }
      if (pathname.startsWith("/admin") && role !== "ADMIN") {
        return Response.redirect(new URL(ROLE_HOME[role], nextUrl));
      }

      return true;
    },
  },
} satisfies NextAuthConfig;

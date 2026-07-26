import bcrypt from "bcryptjs";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import { asRole } from "@/lib/roles";

const credentialsSchema = z.object({
  username: z.string().trim().toLowerCase().min(1),
  password: z.string().min(1),
});

/**
 * Фиктивный bcrypt-хеш. Сравниваем с ним пароль, когда пользователь не найден,
 * чтобы время ответа не выдавало существование логина (защита от перебора).
 */
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/** Защита от перебора пароля. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

/** Понятная причина отказа — попадает в сообщение на странице входа. */
class LockedError extends CredentialsSignin {
  code = "locked";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        username: { label: "Логин", type: "text" },
        password: { label: "Пароль", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const { username, password } = parsed.data;

        const user = await prisma.user.findUnique({
          where: { username },
          select: {
            id: true,
            username: true,
            email: true,
            name: true,
            password: true,
            role: true,
            className: true,
            failedLoginCount: true,
            lockedUntil: true,
            sessionVersion: true,
          },
        });

        if (!user) {
          await bcrypt.compare(password, DUMMY_HASH);
          return null;
        }

        // Аккаунт временно заблокирован после серии неудачных попыток.
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          throw new LockedError();
        }

        const passwordMatches = await bcrypt.compare(password, user.password);

        if (!passwordMatches) {
          // Копим неудачи; на пороге — блокируем на LOCK_MINUTES.
          const failed = user.failedLoginCount + 1;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: failed,
              lockedUntil:
                failed >= MAX_FAILED_ATTEMPTS
                  ? new Date(Date.now() + LOCK_MINUTES * 60_000)
                  : null,
            },
          });
          if (failed >= MAX_FAILED_ATTEMPTS) throw new LockedError();
          return null;
        }

        /**
         * Успешный вход: сбрасываем счётчик неудач, отмечаем время входа
         * и стираем временный пароль — с этого момента админ его не видит.
         */
        await prisma.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: new Date(),
            tempPassword: null,
            failedLoginCount: 0,
            lockedUntil: null,
          },
        });

        return {
          id: user.id,
          // NextAuth хранит поле как `email`; для нас это логин.
          email: user.email ?? `${user.username}@journal.local`,
          name: user.name,
          username: user.username,
          role: asRole(user.role),
          className: user.className,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
});

import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
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
            lastLoginAt: true,
          },
        });

        if (!user) {
          await bcrypt.compare(password, DUMMY_HASH);
          return null;
        }

        const passwordMatches = await bcrypt.compare(password, user.password);
        if (!passwordMatches) return null;

        /**
         * Первый успешный вход стирает временный пароль: с этого момента
         * администратор его больше не видит — в базе остаётся только bcrypt-хеш.
         */
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date(), tempPassword: null },
        });

        return {
          id: user.id,
          // NextAuth хранит поле как `email`; для нас это логин.
          email: user.email ?? `${user.username}@journal.local`,
          name: user.name,
          username: user.username,
          role: asRole(user.role),
          className: user.className,
        };
      },
    }),
  ],
});

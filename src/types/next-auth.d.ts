import type { DefaultSession } from "next-auth";

import type { Role } from "@/lib/roles";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      username?: string | null;
      className?: string | null;
      sessionVersion?: number;
    } & DefaultSession["user"];
  }

  interface User {
    role?: Role | string;
    username?: string | null;
    className?: string | null;
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    username?: string | null;
    className?: string | null;
    sessionVersion?: number;
  }
}

/**
 * next-auth/jwt только реэкспортирует типы из @auth/core/jwt,
 * поэтому расширяем и исходный модуль — иначе token.role будет unknown.
 */
declare module "@auth/core/jwt" {
  interface JWT {
    role?: Role;
    username?: string | null;
    className?: string | null;
    sessionVersion?: number;
  }
}

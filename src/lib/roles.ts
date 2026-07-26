/**
 * Роли пользователей.
 *
 * SQLite не поддерживает enum на уровне Prisma, поэтому роль хранится строкой,
 * а единственным источником правды о допустимых значениях является этот файл.
 */

export const ROLES = ["ADMIN", "TEACHER", "STUDENT", "PARENT"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Администратор",
  TEACHER: "Учитель",
  STUDENT: "Ученик",
  PARENT: "Родитель",
};

/** Куда отправлять пользователя сразу после входа. */
export const ROLE_HOME: Record<Role, string> = {
  ADMIN: "/admin",
  TEACHER: "/journal",
  STUDENT: "/student",
  PARENT: "/family",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Безопасно приводит значение из БД к типу Role (по умолчанию — самая слабая роль). */
export function asRole(value: unknown): Role {
  return isRole(value) ? value : "STUDENT";
}

/** Оценки могут выставлять только эти роли. Родитель сюда НЕ входит. */
export const GRADE_EDITOR_ROLES: readonly Role[] = ["TEACHER", "ADMIN"];

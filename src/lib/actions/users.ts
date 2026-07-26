"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { requireRole, requireUser } from "@/lib/auth-guards";
import { generateTempPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { ROLES, type Role } from "@/lib/roles";
import { buildStudentLogin, parseStudentNames } from "@/lib/students-import";

/** Управление пользователями — только для роли ADMIN. */

const ADMIN_ONLY: readonly Role[] = ["ADMIN"];
const BCRYPT_ROUNDS = 10;
const MAX_IMPORT_STUDENTS = 200;

const nameSchema = z
  .string()
  .trim()
  .min(2, "Имя — минимум 2 символа")
  .max(100, "Имя — не длиннее 100 символов");

/** Логин: латиница, цифры, точка, дефис и подчёркивание. */
const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Логин — минимум 3 символа")
  .max(40, "Логин — не длиннее 40 символов")
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    "Логин может содержать латинские буквы, цифры, точку, дефис и подчёркивание",
  );

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Некорректный e-mail")
  .optional()
  .or(z.literal(""));

const passwordSchema = z
  .string()
  .min(6, "Пароль — минимум 6 символов")
  .max(72, "Пароль — не длиннее 72 символов");

const classNameSchema = z
  .string()
  .trim()
  .max(20, "Название класса — не длиннее 20 символов")
  .optional();

const createUserSchema = z.object({
  name: nameSchema,
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(ROLES),
  className: classNameSchema,
});

export async function createUserAction(input: {
  name: string;
  username: string;
  email?: string;
  password: string;
  role: string;
  className?: string;
}): Promise<ActionResult<{ id: string; username: string }>> {
  try {
    await requireRole(ADMIN_ONLY);
    const parsed = createUserSchema.parse(input);

    const existing = await prisma.user.findUnique({
      where: { username: parsed.username },
      select: { id: true },
    });
    if (existing) return actionFail(`Логин ${parsed.username} уже занят`, 409);

    const email = parsed.email ? parsed.email : null;
    if (email) {
      const emailTaken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (emailTaken) return actionFail(`Почта ${email} уже используется`, 409);
    }

    const user = await prisma.user.create({
      data: {
        name: parsed.name,
        username: parsed.username,
        email,
        password: await bcrypt.hash(parsed.password, BCRYPT_ROUNDS),
        // Пароль виден администратору, пока пользователь не вошёл в первый раз.
        tempPassword: parsed.password,
        role: parsed.role,
        className: parsed.role === "STUDENT" ? parsed.className?.trim() || null : null,
        mustChangePassword: true,
      },
      select: { id: true, username: true },
    });

    revalidatePath("/admin");
    revalidatePath("/journal");
    return actionOk(user, `Пользователь ${parsed.name} создан`);
  } catch (error) {
    return actionError(error);
  }
}

export type ImportedStudent = {
  name: string;
  username: string;
  password: string;
};

export type BulkImportResult = {
  created: ImportedStudent[];
  skipped: { name: string; reason: string }[];
  parsed: number;
};

const bulkImportSchema = z.object({
  text: z.string().min(1, "Вставьте список учеников"),
  className: classNameSchema,
});

/**
 * Массовый импорт учеников.
 * Принимает произвольный текст (ФИО по одному на строку или через запятую),
 * создаёт учётные записи с логинами и временными паролями. Пароли остаются
 * видимыми администратору до первого входа ученика.
 */
export async function bulkImportStudentsAction(input: {
  text: string;
  className?: string;
}): Promise<ActionResult<BulkImportResult>> {
  try {
    await requireRole(ADMIN_ONLY);
    const parsed = bulkImportSchema.parse(input);

    const names = parseStudentNames(parsed.text);
    if (names.length === 0) {
      return actionFail("Не удалось распознать ни одного имени", 400);
    }
    if (names.length > MAX_IMPORT_STUDENTS) {
      return actionFail(
        `За один раз можно импортировать не более ${MAX_IMPORT_STUDENTS} учеников (распознано ${names.length})`,
        400,
      );
    }

    const existingUsers = await prisma.user.findMany({ select: { username: true } });
    const taken = new Set(existingUsers.map((user) => user.username.toLowerCase()));

    const created: ImportedStudent[] = [];
    const skipped: { name: string; reason: string }[] = [];
    const className = parsed.className?.trim() || null;

    for (const name of names) {
      const validated = nameSchema.safeParse(name);
      if (!validated.success) {
        skipped.push({ name, reason: validated.error.issues[0]?.message ?? "Некорректное имя" });
        continue;
      }

      const username = buildStudentLogin(validated.data, taken);
      const password = generateTempPassword();

      try {
        await prisma.user.create({
          data: {
            name: validated.data,
            username,
            password: await bcrypt.hash(password, BCRYPT_ROUNDS),
            tempPassword: password,
            role: "STUDENT",
            className,
            mustChangePassword: true,
          },
        });
        created.push({ name: validated.data, username, password });
      } catch {
        skipped.push({ name, reason: "Не удалось создать (логин занят)" });
      }
    }

    revalidatePath("/admin");
    revalidatePath("/journal");

    return actionOk(
      { created, skipped, parsed: names.length },
      `Создано учеников: ${created.length} из ${names.length}`,
    );
  } catch (error) {
    return actionError(error);
  }
}

export async function deleteUserAction(input: {
  userId: string;
}): Promise<ActionResult<null>> {
  try {
    const admin = await requireRole(ADMIN_ONLY);
    const userId = z.string().min(1).parse(input.userId);

    if (userId === admin.id) {
      return actionFail("Нельзя удалить собственную учётную запись", 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true },
    });
    if (!user) return actionFail("Пользователь не найден", 404);

    if (user.role === "ADMIN") {
      const admins = await prisma.user.count({ where: { role: "ADMIN" } });
      if (admins <= 1) {
        return actionFail("Нельзя удалить последнего администратора", 400);
      }
    }

    await prisma.user.delete({ where: { id: userId } });

    revalidatePath("/admin");
    revalidatePath("/journal");
    return actionOk(null, `Пользователь ${user.name} удалён`);
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Сброс пароля: возвращает новый временный пароль и сохраняет его так,
 * чтобы администратор мог посмотреть его в таблице до первого входа.
 */
export async function resetPasswordAction(input: {
  userId: string;
}): Promise<ActionResult<{ password: string; username: string }>> {
  try {
    await requireRole(ADMIN_ONLY);
    const userId = z.string().min(1).parse(input.userId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!user) return actionFail("Пользователь не найден", 404);

    const password = generateTempPassword(10);
    await prisma.user.update({
      where: { id: userId },
      data: {
        password: await bcrypt.hash(password, BCRYPT_ROUNDS),
        tempPassword: password,
        mustChangePassword: true,
        lastLoginAt: null,
      },
    });

    revalidatePath("/admin");
    return actionOk({ password, username: user.username }, "Пароль сброшен");
  } catch (error) {
    return actionError(error);
  }
}

export async function updateUserRoleAction(input: {
  userId: string;
  role: string;
}): Promise<ActionResult<null>> {
  try {
    const admin = await requireRole(ADMIN_ONLY);
    const userId = z.string().min(1).parse(input.userId);
    const role = z.enum(ROLES).parse(input.role);

    if (userId === admin.id && role !== "ADMIN") {
      return actionFail("Нельзя понизить собственную роль", 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) return actionFail("Пользователь не найден", 404);

    await prisma.user.update({
      where: { id: userId },
      data: { role, className: role === "STUDENT" ? undefined : null },
    });

    revalidatePath("/admin");
    revalidatePath("/journal");
    return actionOk(null, "Роль обновлена");
  } catch (error) {
    return actionError(error);
  }
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Введите текущий пароль"),
  newPassword: passwordSchema,
});

/** Смена собственного пароля — доступна любому авторизованному пользователю. */
export async function changeOwnPasswordAction(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<ActionResult<null>> {
  try {
    const current = await requireUser();
    const parsed = changePasswordSchema.parse(input);

    const user = await prisma.user.findUnique({
      where: { id: current.id },
      select: { id: true, password: true },
    });
    if (!user) return actionFail("Пользователь не найден", 404);

    const matches = await bcrypt.compare(parsed.currentPassword, user.password);
    if (!matches) return actionFail("Текущий пароль указан неверно", 400);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(parsed.newPassword, BCRYPT_ROUNDS),
        // Свой пароль пользователь придумал сам — администратору его не видно.
        tempPassword: null,
        mustChangePassword: false,
      },
    });

    return actionOk(null, "Пароль изменён");
  } catch (error) {
    return actionError(error);
  }
}

"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, DomainError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth-guards";
import { requireOwnChild } from "@/lib/family-guards";
import { generateTempPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { buildStudentLogin } from "@/lib/students-import";
import { pluralize } from "@/lib/utils";

/**
 * Семья: создание родителей, привязка к детям (ADMIN) и штамп «Ознакомлен»
 * (PARENT). Канон раздела 6 CLAUDE.md: requireRole первой строкой, zod на все
 * поля включая id, actionError в catch.
 *
 * Исчерпывающий whitelist записи для роли PARENT: ackGradesAction,
 * markChildViewedAction, disconnectMyTelegramAction (actions/telegram.ts) и
 * общий changeOwnPasswordAction. Всё остальное родителю отвечает 403 —
 * GRADE_EDITOR_ROLES не расширяется.
 */

const ADMIN_ONLY = ["ADMIN"] as const;
const BCRYPT_ROUNDS = 10;

/** Не больше стольких детей за одно создание родителя (в семье их не десятки). */
const MAX_CHILDREN_PER_CREATE = 10;

/** Не больше стольких штампов за один вызов «Ознакомлен со всем новым». */
const MAX_ACKS_PER_CALL = 50;

const nameSchema = z
  .string()
  .trim()
  .min(2, "Имя — минимум 2 символа")
  .max(100, "Имя — не длиннее 100 символов");

const createParentSchema = z.object({
  name: nameSchema,
  studentIds: z.array(z.string().min(1, "Пустой id ученика")).max(
    MAX_CHILDREN_PER_CREATE,
    `Не более ${MAX_CHILDREN_PER_CREATE} детей за раз`,
  ),
});

/**
 * ADMIN: создать родителя. Логин — транслитерацией ФИО (как у учеников),
 * пароль — временный (виден в админке до первого входа), дети — одной
 * транзакцией с созданием. Пароль возвращается ОДИН раз (прецедент
 * resetPasswordAction) и в аудит не пишется.
 */
export async function createParentAction(input: {
  name: string;
  studentIds?: string[];
}): Promise<ActionResult<{ id: string; username: string; password: string }>> {
  try {
    const admin = await requireRole(ADMIN_ONLY);
    const parsed = createParentSchema.parse({
      name: input.name,
      studentIds: input.studentIds ?? [],
    });
    const studentIds = [...new Set(parsed.studentIds)];

    // Все дети перечитываются из БД: привязать можно только настоящих учеников
    // (прецедент сверки длины в setGradesBulkAction).
    const students = await prisma.user.findMany({
      where: { id: { in: studentIds }, role: "STUDENT" },
      select: { id: true, name: true, className: true },
    });
    if (students.length !== studentIds.length) {
      return actionFail("Часть учеников не найдена или не является учениками", 400);
    }

    const existing = await prisma.user.findMany({ select: { username: true } });
    const taken = new Set(existing.map((user) => user.username.toLowerCase()));
    const username = buildStudentLogin(parsed.name, taken);
    const password = generateTempPassword();

    const parent = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: parsed.name,
          username,
          password: await bcrypt.hash(password, BCRYPT_ROUNDS),
          tempPassword: password,
          role: "PARENT",
          mustChangePassword: true,
        },
        select: { id: true, username: true },
      });
      if (students.length > 0) {
        await tx.parentLink.createMany({
          data: students.map((student) => ({
            parentId: created.id,
            studentId: student.id,
            createdById: admin.id,
          })),
        });
      }
      return created;
    });

    // Пароль в аудит НЕ попадает — только факт создания и список детей.
    await logAudit({
      actor: admin,
      action: "user.create",
      targetName: parent.username,
      details:
        `Создан пользователь «${parsed.name}» (Родитель)` +
        (students.length > 0
          ? `, привязан к: ${students
              .map((s) => `${s.name}${s.className ? ` (${s.className})` : ""}`)
              .join(", ")}`
          : ""),
    });

    revalidatePath("/admin");
    revalidatePath("/family");
    return actionOk(
      { id: parent.id, username: parent.username, password },
      `Родитель ${parsed.name} создан`,
    );
  } catch (error) {
    return actionError(error);
  }
}

const linkSchema = z.object({
  parentId: z.string().min(1, "Не указан родитель"),
  studentId: z.string().min(1, "Не указан ученик"),
});

/** ADMIN: привязать родителя к ученику. Идемпотентно (upsert по паре). */
export async function linkParentAction(input: {
  parentId: string;
  studentId: string;
}): Promise<ActionResult<null>> {
  try {
    const admin = await requireRole(ADMIN_ONLY);
    const parsed = linkSchema.parse(input);

    if (parsed.parentId === parsed.studentId) {
      return actionFail("Родитель и ученик не могут совпадать", 400);
    }

    // Обе стороны перечитываются из БД: инвариант ParentLink держится на записи.
    const [parent, student] = await Promise.all([
      prisma.user.findUnique({
        where: { id: parsed.parentId },
        select: { id: true, name: true, role: true },
      }),
      prisma.user.findUnique({
        where: { id: parsed.studentId },
        select: { id: true, name: true, role: true, className: true },
      }),
    ]);
    if (!parent || parent.role !== "PARENT") {
      return actionFail("Родитель не найден или роль не «Родитель»", 400);
    }
    if (!student || student.role !== "STUDENT") {
      return actionFail("Ученик не найден или роль не «Ученик»", 400);
    }

    await prisma.parentLink.upsert({
      where: {
        parentId_studentId: { parentId: parsed.parentId, studentId: parsed.studentId },
      },
      create: {
        parentId: parsed.parentId,
        studentId: parsed.studentId,
        createdById: admin.id,
      },
      update: {},
    });

    await logAudit({
      actor: admin,
      action: "parent.link",
      targetName: student.name,
      details:
        `Родитель «${parent.name}» привязан к ученику «${student.name}` +
        `${student.className ? ` (${student.className})` : ""}»`,
    });

    revalidatePath("/admin");
    revalidatePath("/family");
    return actionOk(null, "Родитель привязан");
  } catch (error) {
    return actionError(error);
  }
}

/**
 * ADMIN: отвязать родителя от ученика. Отвязка от последнего ребёнка НЕ
 * удаляет TelegramLink: дренаж резолвит получателей по живым ParentLink,
 * поэтому поток уведомлений и так глохнет немедленно.
 */
export async function unlinkParentAction(input: {
  parentId: string;
  studentId: string;
}): Promise<ActionResult<null>> {
  try {
    const admin = await requireRole(ADMIN_ONLY);
    const parsed = linkSchema.parse(input);

    const [parent, student] = await Promise.all([
      prisma.user.findUnique({
        where: { id: parsed.parentId },
        select: { name: true },
      }),
      prisma.user.findUnique({
        where: { id: parsed.studentId },
        select: { name: true, className: true },
      }),
    ]);

    const { count } = await prisma.parentLink.deleteMany({
      where: { parentId: parsed.parentId, studentId: parsed.studentId },
    });
    if (count === 0) return actionOk(null, "Связи уже не было");

    await logAudit({
      actor: admin,
      action: "parent.unlink",
      targetName: student?.name ?? null,
      details:
        `Родитель «${parent?.name ?? parsed.parentId}» отвязан от ученика ` +
        `«${student?.name ?? parsed.studentId}${student?.className ? ` (${student.className})` : ""}»`,
    });

    revalidatePath("/admin");
    revalidatePath("/family");
    return actionOk(null, "Родитель отвязан");
  } catch (error) {
    return actionError(error);
  }
}

const ackSchema = z.object({
  gradeIds: z
    .array(z.string().min(1, "Пустой id оценки"))
    .min(1, "Не выбрано ни одной оценки")
    .max(MAX_ACKS_PER_CALL, `Не более ${MAX_ACKS_PER_CALL} оценок за раз`),
});

/**
 * PARENT: штамп «Ознакомлен» — и точечный (1 id), и массовый («со всем
 * новым»). studentId берётся из СТРОКИ Grade в базе и лишь затем проходит
 * requireOwnChild — клиентский studentId в проверке прав не участвует нигде.
 * Оценки уроков из корзины «ознакомить» нельзя (фильтр lesson.deletedAt).
 * Повторный тап переподписывает изменённую оценку (upsert обновляет seenValue).
 * Без logAudit: GradeAck сам является журналом подписей (решение §1 п.21).
 */
export async function ackGradesAction(input: {
  gradeIds: string[];
}): Promise<ActionResult<{ count: number }>> {
  try {
    const parent = await requireRole(["PARENT"]);
    const parsed = ackSchema.parse(input);
    const gradeIds = [...new Set(parsed.gradeIds)];

    const grades = await prisma.grade.findMany({
      where: { id: { in: gradeIds }, lesson: { deletedAt: null } },
      select: { id: true, studentId: true, value: true },
    });
    // Смешанный список (чужая/несуществующая/корзинная оценка) отклоняется
    // ЦЕЛИКОМ, тем же 404, что и чужой ребёнок — ни одного штампа не создаётся.
    if (grades.length !== gradeIds.length) {
      throw new DomainError("Оценка не найдена", 404);
    }
    for (const studentId of new Set(grades.map((grade) => grade.studentId))) {
      await requireOwnChild(parent, studentId);
    }

    await prisma.$transaction(
      grades.map((grade) =>
        prisma.gradeAck.upsert({
          where: { gradeId_parentId: { gradeId: grade.id, parentId: parent.id } },
          create: {
            gradeId: grade.id,
            parentId: parent.id,
            parentName: parent.name,
            seenValue: grade.value,
          },
          // Повторная подпись «переподписывает»: снимок увиденного обновляется.
          update: { seenValue: grade.value, parentName: parent.name },
        }),
      ),
    );

    revalidatePath("/journal");
    revalidatePath("/family");
    return actionOk(
      { count: grades.length },
      grades.length === 1
        ? "Отмечено: ознакомлен"
        : `Отмечено: ознакомлен с ${grades.length} ${pluralize(grades.length, "оценкой", "оценками", "оценками")}`,
    );
  } catch (error) {
    return actionError(error);
  }
}

const markViewedSchema = z.object({ studentId: z.string().min(1, "Не указан ученик") });

/**
 * PARENT: отметка «дневник ребёнка открыт» — питает «что нового». Вызывается
 * клиентским эффектом при открытии дневника (страницы-чтения в БД не пишут).
 * Без аудита и без revalidatePath: следующий заход на /family перечитает сам.
 */
export async function markChildViewedAction(input: {
  studentId: string;
}): Promise<ActionResult<null>> {
  try {
    const parent = await requireRole(["PARENT"]);
    const parsed = markViewedSchema.parse(input);
    await requireOwnChild(parent, parsed.studentId);

    await prisma.parentLink.updateMany({
      where: { parentId: parent.id, studentId: parsed.studentId },
      data: { lastViewedAt: new Date() },
    });

    return actionOk(null);
  } catch (error) {
    return actionError(error);
  }
}

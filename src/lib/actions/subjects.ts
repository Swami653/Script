"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";

/** Управление предметами доступно учителю и администратору. */

const subjectNameSchema = z
  .string()
  .trim()
  .min(2, "Название предмета — минимум 2 символа")
  .max(60, "Название предмета — не длиннее 60 символов");

export async function createSubjectAction(input: {
  name: string;
}): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    await requireRole(GRADE_EDITOR_ROLES);
    const name = subjectNameSchema.parse(input.name);

    const existing = await prisma.subject.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) return actionFail(`Предмет «${name}» уже существует`, 409);

    const subject = await prisma.subject.create({
      data: { name },
      select: { id: true, name: true },
    });

    revalidatePath("/journal");
    revalidatePath("/student");
    return actionOk(subject, `Предмет «${name}» добавлен`);
  } catch (error) {
    return actionError(error);
  }
}

export async function renameSubjectAction(input: {
  subjectId: string;
  name: string;
}): Promise<ActionResult<null>> {
  try {
    await requireRole(GRADE_EDITOR_ROLES);
    const subjectId = z.string().min(1).parse(input.subjectId);
    const name = subjectNameSchema.parse(input.name);

    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
      select: { id: true },
    });
    if (!subject) return actionFail("Предмет не найден", 404);

    const duplicate = await prisma.subject.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, NOT: { id: subjectId } },
      select: { id: true },
    });
    if (duplicate) return actionFail(`Предмет «${name}» уже существует`, 409);

    await prisma.subject.update({ where: { id: subjectId }, data: { name } });

    revalidatePath("/journal");
    revalidatePath("/student");
    return actionOk(null, "Предмет переименован");
  } catch (error) {
    return actionError(error);
  }
}

/** Удаление предмета каскадно удаляет его уроки и оценки. */
export async function deleteSubjectAction(input: {
  subjectId: string;
}): Promise<ActionResult<null>> {
  try {
    await requireRole(GRADE_EDITOR_ROLES);
    const subjectId = z.string().min(1).parse(input.subjectId);

    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
      select: { id: true, name: true },
    });
    if (!subject) return actionFail("Предмет не найден", 404);

    await prisma.subject.delete({ where: { id: subjectId } });

    revalidatePath("/journal");
    revalidatePath("/student");
    return actionOk(null, `Предмет «${subject.name}» удалён вместе с оценками`);
  } catch (error) {
    return actionError(error);
  }
}

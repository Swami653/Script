"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionFail, actionOk, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { findOverlap, quarterPeriodSchema } from "@/lib/quarters";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";
import { ACTIVE_YEAR_KEY } from "@/lib/school-year";
import { parseDateInputValue } from "@/lib/utils";

/**
 * Учебный год и границы четвертей. Настраивает учитель (или администратор):
 * именно эти даты определяют, какая четверть «идёт сейчас» и в какую четверть
 * попадёт урок при добавлении.
 */

const yearSchema = z
  .number({ invalid_type_error: "Учебный год должен быть числом" })
  .int("Учебный год должен быть целым числом")
  .min(2000, "Учебный год должен быть не раньше 2000")
  .max(2100, "Учебный год должен быть не позже 2100");

/** Сохранить границы одной четверти. Пересечения с другими четвертями запрещены. */
export async function saveQuarterPeriodAction(input: {
  year: number;
  quarter: number;
  startDate: string;
  endDate: string;
}): Promise<ActionResult<null>> {
  try {
    const teacher = await requireRole(GRADE_EDITOR_ROLES);

    const year = yearSchema.parse(input.year);
    const parsed = quarterPeriodSchema.parse({
      quarter: input.quarter,
      startDate: input.startDate,
      endDate: input.endDate,
    });

    const startDate = parseDateInputValue(parsed.startDate);
    const endDate = parseDateInputValue(parsed.endDate);

    const others = await prisma.quarterPeriod.findMany({
      where: { year, NOT: { quarter: parsed.quarter } },
      select: { quarter: true, startDate: true, endDate: true },
    });

    const overlap = findOverlap(others, { quarter: parsed.quarter, startDate, endDate });
    if (overlap) {
      return actionFail(
        `Даты пересекаются с ${overlap.quarter} четвертью — исправьте границы`,
        409,
      );
    }

    await prisma.quarterPeriod.upsert({
      where: { year_quarter: { year, quarter: parsed.quarter } },
      create: {
        year,
        quarter: parsed.quarter,
        startDate,
        endDate,
        authorId: teacher.id,
      },
      update: { startDate, endDate, authorId: teacher.id },
    });

    revalidatePath("/journal");
    revalidatePath("/journal/year");
    revalidatePath("/student");
    return actionOk(null, `${parsed.quarter} четверть сохранена`);
  } catch (error) {
    return actionError(error);
  }
}

export async function deleteQuarterPeriodAction(input: {
  year: number;
  quarter: number;
}): Promise<ActionResult<null>> {
  try {
    await requireRole(GRADE_EDITOR_ROLES);
    const year = yearSchema.parse(input.year);
    const quarter = z.number().int().min(1).max(4).parse(input.quarter);

    const existing = await prisma.quarterPeriod.findUnique({
      where: { year_quarter: { year, quarter } },
      select: { id: true },
    });
    if (!existing) return actionOk(null, "Период не был задан");

    await prisma.quarterPeriod.delete({ where: { id: existing.id } });

    revalidatePath("/journal");
    revalidatePath("/journal/year");
    return actionOk(null, `Границы ${quarter} четверти удалены`);
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Сделать учебный год активным. Настройка общая: журнал и дневники всех
 * пользователей начинают показывать именно этот год.
 */
export async function setActiveYearAction(input: {
  year: number;
}): Promise<ActionResult<{ year: number }>> {
  try {
    await requireRole(GRADE_EDITOR_ROLES);
    const year = yearSchema.parse(input.year);

    await prisma.appSetting.upsert({
      where: { key: ACTIVE_YEAR_KEY },
      create: { key: ACTIVE_YEAR_KEY, value: String(year) },
      update: { value: String(year) },
    });

    revalidatePath("/journal");
    revalidatePath("/journal/year");
    revalidatePath("/student");
    return actionOk({ year }, `Активный учебный год: ${year}/${year + 1}`);
  } catch (error) {
    return actionError(error);
  }
}

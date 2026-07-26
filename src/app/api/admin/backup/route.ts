import { NextResponse } from "next/server";

import { logAudit } from "@/lib/audit";
import { ForbiddenError, requireRole, UnauthorizedError } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { toDateInputValue } from "@/lib/utils";

/**
 * Полный архив данных журнала в JSON — страховка администратора.
 *
 * Журнал — юридически значимый документ, а единственная копия данных за год —
 * сама база. Случайный RESET_DATA=true или неудачная миграция необратимы,
 * поэтому администратор должен уметь скачать всё сам, без разработчика.
 *
 * В архив входят ВСЕ таблицы, включая корзину уроков и журнал изменений, —
 * это резервная копия, а не отчёт. Единственное исключение — пароли:
 * ни bcrypt-хеш (User.password), ни временный пароль (User.tempPassword)
 * не выгружаются НИ В КАКОМ ВИДЕ (правило проекта: клиенту пароли не
 * возвращаются никогда). После восстановления из архива пароли придётся
 * выдать заново — архив явно помечен этим в meta.
 */

/** Имя последней применённой миграции — «версия схемы» архива. */
async function getSchemaVersion(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `;
    return rows[0]?.migration_name ?? null;
  } catch {
    // Таблицы миграций может не оказаться (база без prisma migrate) —
    // архив от этого не хуже, просто без версии схемы.
    return null;
  }
}

export async function GET() {
  try {
    // Полная выгрузка данных доступна ТОЛЬКО администратору.
    const admin = await requireRole(["ADMIN"]);

    const [
      users,
      subjects,
      lessons,
      grades,
      absences,
      quarterPeriods,
      quarterLocks,
      quarterResults,
      debts,
      appSettings,
      auditLog,
      schemaVersion,
    ] = await Promise.all([
      prisma.user.findMany({
        // ПАРОЛИ НЕ ВЫГРУЖАЮТСЯ: ни password (bcrypt-хеш), ни tempPassword.
        // Поля перечислены явно, чтобы новое секретное поле не утекло само собой.
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          lastLoginAt: true,
          failedLoginCount: true,
          lockedUntil: true,
          sessionVersion: true,
          role: true,
          className: true,
          mustChangePassword: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.subject.findMany({ orderBy: { name: "asc" } }),
      // Без фильтра по deletedAt: корзина тоже входит в резервную копию.
      prisma.lesson.findMany({ orderBy: { date: "asc" } }),
      prisma.grade.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.absence.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.quarterPeriod.findMany({ orderBy: [{ year: "asc" }, { quarter: "asc" }] }),
      // Итоги закрытых четвертей — самая ценная часть архива: ведомость
      // юридически значима и, в отличие от оценок, её нельзя пересчитать.
      prisma.quarterLock.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.quarterResult.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.debt.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.appSetting.findMany({ orderBy: { key: "asc" } }),
      prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } }),
      getSchemaVersion(),
    ]);

    const counts = {
      users: users.length,
      subjects: subjects.length,
      lessons: lessons.length,
      grades: grades.length,
      absences: absences.length,
      quarterPeriods: quarterPeriods.length,
      quarterLocks: quarterLocks.length,
      quarterResults: quarterResults.length,
      debts: debts.length,
      appSettings: appSettings.length,
      auditLog: auditLog.length,
    };

    const backup = {
      meta: {
        format: "school-journal-backup",
        formatVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: admin.username,
        /** Имя последней применённой миграции prisma/migrations. */
        schemaVersion,
        passwordsExcluded: true,
        passwordsNote:
          "Пароли в архив не входят ни в каком виде: в базе хранятся только " +
          "bcrypt-хеши, и наружу они не выгружаются. После восстановления из " +
          "этого архива выдайте всем пользователям новые пароли " +
          "(сброс пароля в панели администратора).",
        counts,
      },
      data: {
        users,
        subjects,
        lessons,
        grades,
        absences,
        quarterLocks,
        quarterResults,
        debts,
        quarterPeriods,
        appSettings,
        auditLog,
      },
    };

    // Факт выгрузки — в журнал изменений: полная копия данных школы на руках —
    // событие, которое администратор должен видеть. Сама запись в скачанный
    // архив уже не попадает (auditLog прочитан раньше) — это нормально.
    await logAudit({
      actor: { id: admin.id, name: admin.name },
      action: "backup.download",
      details:
        `Скачан полный архив данных: ${counts.users} пользователей, ` +
        `${counts.lessons} уроков, ${counts.grades} оценок, ` +
        `${counts.absences} отметок «Н». Пароли в архив не входят.`,
    });

    const filename = `journal-backup-${toDateInputValue(new Date())}.json`;

    return new NextResponse(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("[backup]", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

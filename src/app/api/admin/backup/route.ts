import { Prisma } from "@prisma/client";
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
 * ПОЧЕМУ СПИСОК ТАБЛИЦ НЕ ЗАШИТ РУКАМИ. Он уже дважды отставал от схемы:
 * архив объявлял себя полным, но терял ведомости закрытых четвертей, а потом
 * весь учебный след 1–2 классов. Ручной перечень обречён — его забывают
 * пополнить в фазе, которая думает совсем о другом. Поэтому таблицы берутся
 * из САМОЙ СХЕМЫ (Prisma.dmmf): любая новая модель попадает в архив
 * автоматически, в день своего появления.
 *
 * Единственное исключение — пароли: ни bcrypt-хеш (User.password), ни
 * временный пароль (User.tempPassword) не выгружаются НИ В КАКОМ ВИДЕ
 * (правило проекта: клиенту пароли не возвращаются никогда). Для User поля
 * перечислены поимённо — так новое секретное поле не утечёт само собой, его
 * придётся добавить осознанно. После восстановления пароли выдаются заново.
 */

/**
 * Поля User, которые МОЖНО выгружать. Перечислены явно, а не через исключение
 * пароля: аллаулист безопаснее — новое поле по умолчанию не попадает наружу.
 */
const USER_SAFE_SELECT = {
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
} as const;

/** «QuarterResult» -> «quarterResult»: имя делегата в Prisma Client. */
function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

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

    const models = Prisma.dmmf.datamodel.models.map((model) => model.name);

    const data: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};

    // Последовательно, а не Promise.all: пул соединений serverless-функции
    // узкий (connection_limit=1), и два десятка параллельных выборок его
    // исчерпают. Архив скачивают редко — скорость здесь не важна.
    for (const model of models) {
      const delegate = (prisma as unknown as Record<string, { findMany: (args?: unknown) => Promise<unknown[]> }>)[
        delegateName(model)
      ];
      if (!delegate?.findMany) continue;

      // Уроки выгружаются вместе с корзиной (deletedAt) — это резервная
      // копия, а не отчёт: удалённое пользователь может захотеть вернуть.
      const rows =
        model === "User" ? await delegate.findMany({ select: USER_SAFE_SELECT }) : await delegate.findMany();

      const key = delegateName(model);
      data[key] = rows;
      counts[key] = rows.length;
    }

    const schemaVersion = await getSchemaVersion();

    const backup = {
      meta: {
        format: "school-journal-backup",
        formatVersion: 2,
        createdAt: new Date().toISOString(),
        createdBy: admin.username,
        /** Имя последней применённой миграции prisma/migrations. */
        schemaVersion,
        /** Список выгруженных таблиц — виден без разбора всего файла. */
        tables: Object.keys(data),
        passwordsExcluded: true,
        passwordsNote:
          "Пароли в архив не входят ни в каком виде: в базе хранятся только " +
          "bcrypt-хеши, и наружу они не выгружаются. После восстановления из " +
          "этого архива выдайте всем пользователям новые пароли " +
          "(сброс пароля в панели администратора).",
        counts,
      },
      data,
    };

    // Факт выгрузки — в журнал изменений: полная копия данных школы на руках —
    // событие, которое администратор должен видеть. Сама запись в скачанный
    // архив уже не попадает (auditLog прочитан раньше) — это нормально.
    await logAudit({
      actor: { id: admin.id, name: admin.name },
      action: "backup.download",
      details:
        `Скачан полный архив данных: таблиц ${Object.keys(data).length}, ` +
        `пользователей ${counts.user ?? 0}, уроков ${counts.lesson ?? 0}, ` +
        `оценок ${counts.grade ?? 0}. Пароли в архив не входят.`,
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

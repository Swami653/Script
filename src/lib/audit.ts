import type { AuditAction } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";
import { formatDateShort } from "@/lib/utils";

/**
 * Запись в журнал изменений (аудит). Вызывается из Server Actions сразу после
 * успешного изменения данных.
 *
 * Правила:
 *  * пишем СНИМКИ имён (actorName, targetName, subjectName) — запись должна
 *    пережить удаление пользователя, урока и предмета;
 *  * ошибка аудита НЕ роняет действие: сохранённая оценка важнее строки
 *    в журнале, поэтому всё обёрнуто в собственный try/catch с console.error;
 *  * никаких паролей в details — даже временных.
 */
export async function logAudit(entry: {
  actor: { id: string; name: string };
  action: AuditAction;
  /** Снимок: ФИО ученика или логин пользователя, которого коснулось действие. */
  targetName?: string | null;
  subjectName?: string | null;
  /** Человекочитаемое описание по-русски: «Математика, урок 12.09: оценка 8…». */
  details: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actor.id,
        actorName: entry.actor.name,
        action: entry.action,
        targetName: entry.targetName ?? null,
        subjectName: entry.subjectName ?? null,
        details: entry.details,
      },
    });
  } catch (error) {
    console.error("[audit] не удалось записать журнал изменений:", error);
  }
}

/** «Математика, урок 12.09» — общий префикс описаний действий с уроком. */
export function lessonRef(subjectName: string, date: Date): string {
  return `${subjectName}, урок ${formatDateShort(date)}`;
}

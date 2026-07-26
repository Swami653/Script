/**
 * Типы действий журнала изменений (аудита).
 *
 * Изоморфный модуль без prisma: используется и на сервере (запись через
 * src/lib/audit.ts), и в клиентских компонентах (фильтр на /admin/audit).
 * Единственный источник правды о допустимых значениях AuditLog.action.
 */

export const AUDIT_ACTIONS = [
  "grade.set",
  "grade.delete",
  "cell.clear",
  "absence.set",
  "absence.clear",
  "lesson.delete",
  "lesson.restore",
  "lesson.destroy",
  "lessons.grid",
  "lesson.homework",
  "lesson.plan",
  "user.create",
  "user.delete",
  "user.role",
  "user.resetPassword",
  "grades.bulk",
  "backup.download",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "grade.set": "Оценка выставлена",
  "grade.delete": "Оценка удалена",
  "cell.clear": "Клетка очищена",
  "absence.set": "Отмечено «Н»",
  "absence.clear": "Снято «Н»",
  "lesson.delete": "Урок в корзину",
  "lesson.restore": "Урок восстановлен",
  "lesson.destroy": "Урок удалён навсегда",
  "lessons.grid": "Сетка уроков",
  "lesson.homework": "Домашнее задание",
  "lesson.plan": "Пометка контрольной",
  "user.create": "Пользователь создан",
  "user.delete": "Пользователь удалён",
  "user.role": "Роль изменена",
  "user.resetPassword": "Пароль сброшен",
  "grades.bulk": "Оценки всему классу",
  "backup.download": "Резервная копия скачана",
};

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === "string" && (AUDIT_ACTIONS as readonly string[]).includes(value);
}

import { notFound } from "next/navigation";

import { DomainError } from "@/lib/action-result";
import type { SessionUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

/**
 * ЕДИНАЯ ДВЕРЬ К ДАННЫМ УЧЕНИКА (аналог requireWritableLesson для уроков).
 *
 * Любая функция, отдающая персональные данные ученика по studentId, обязана
 * начинаться с requireOwnChild. Сырой prisma-запрос по studentId из
 * пользовательского ввода на страницах /family — ошибка ревью.
 *
 * Отказ — ВСЕГДА 404 «Ученик не найден», а не 403: ответ «запрещено»
 * подтверждал бы перебирающему, что подобранный id существует. Ответы на
 * чужого и на несуществующего ученика неотличимы.
 *
 * Связь и роли проверяются ЖИВЫМ запросом к базе (не из JWT): отвязка
 * родителя или понижение роли действуют со следующего же запроса.
 *
 * КОНВЕНЦИЯ страниц /family (проверяется на ревью): они не импортируют
 * общешкольных выборок — getJournalData, getStudents, getAllUsers,
 * getAuditLog, getAdminStats, getStudentAgenda, getQuarterReview. В
 * родительский рендер не попадают ни одноклассники, ни средние класса,
 * ни чужие семьи; чужие штампы показываются как «Просмотрено семьёй»
 * без имени второго родителя.
 */

export type ChildRef = {
  id: string;
  name: string;
  username: string;
  className: string | null;
};

export async function requireOwnChild(
  viewer: SessionUser,
  studentId: string,
): Promise<ChildRef> {
  const student = await prisma.user.findFirst({
    where: { id: studentId, role: "STUDENT" },
    select: { id: true, name: true, username: true, className: true },
  });
  if (!student) throw new DomainError("Ученик не найден", 404);

  // ЯВНЫЙ аллаулист: каждая роль перечислена, новая роль по умолчанию НЕ проходит.
  switch (viewer.role) {
    case "ADMIN":
    case "TEACHER":
      return student;
    case "STUDENT":
      if (viewer.id === studentId) return student;
      throw new DomainError("Ученик не найден", 404);
    case "PARENT": {
      const link = await prisma.parentLink.findUnique({
        where: { parentId_studentId: { parentId: viewer.id, studentId } },
        select: { id: true },
      });
      if (link) return student;
      throw new DomainError("Ученик не найден", 404);
    }
  }
}

/**
 * Обёртка для СТРАНИЦ: DomainError 404 от requireOwnChild превращается в
 * notFound() — страница «не найдено» вместо экрана ошибки. Ответ для чужого
 * и несуществующего id одинаков. Прочие ошибки пробрасываются как есть.
 */
export async function notFoundOn404<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof DomainError && error.status === 404) notFound();
    throw error;
  }
}

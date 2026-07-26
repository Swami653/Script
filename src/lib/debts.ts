import { isControlLesson } from "@/lib/grades";
import { prisma } from "@/lib/prisma";
import { todayUtcMidnight } from "@/lib/utils";

/**
 * Авто-долги за «Н» на контрольной. ЕДИНСТВЕННЫЙ владелец инварианта —
 * идемпотентный редьюсер syncControlDebts: «приведи долги урока к инварианту»,
 * а не точечные хуки, размазанные по действиям. Редьюсер переживает любой
 * порядок событий («Н» раньше пометки КР, КР распознана по оценкам, снятие
 * пометки) и самозалечивается при следующем касании урока.
 *
 * Инвариант урока:
 *  (а) СОЗДАНИЕ: урок — контрольная (isControlLesson: пометка ИЛИ оценки
 *      kind="control") И уже прошёл (дата <= сегодня UTC) → у каждого ученика
 *      с «Н» есть строка Debt (origin "auto").
 *  (б) РАСТВОРЕНИЕ: открытый авто-долг ученика БЕЗ оценки на уроке удаляется,
 *      если урок больше не контрольная, ещё не прошёл или у ученика нет «Н».
 *      Сценарий «сняли ошибочное Н» (фантомный долг — несправедливость) важнее
 *      сценария «аннулировали пересдачу»: учитель при нужде пометит заново.
 *
 * НИКОГДА не трогаются: ручные долги (origin "manual"), прощённые (clearedAt —
 * надгробие) и закрытые оценкой (история «сдал»; статус закрытия не хранится,
 * а выводится по EXISTS Grade).
 */
export async function syncControlDebts(lessonId: string): Promise<void> {
  try {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        date: true,
        subjectId: true,
        year: true,
        quarter: true,
        plannedKind: true,
        deletedAt: true,
      },
    });
    // Урока нет или он в корзине — молча выходим: корзинные долги и так
    // отфильтрованы во всех выборках, а редьюсер сойдётся при восстановлении.
    if (!lesson || lesson.deletedAt) return;

    const [grades, absences, debts] = await Promise.all([
      prisma.grade.findMany({
        where: { lessonId },
        select: { studentId: true, kind: true },
      }),
      prisma.absence.findMany({ where: { lessonId }, select: { studentId: true } }),
      prisma.debt.findMany({
        where: { lessonId },
        select: { id: true, studentId: true, origin: true, clearedAt: true },
      }),
    ]);

    const isControl = isControlLesson(
      lesson.plannedKind,
      grades.map((grade) => grade.kind),
    );
    // «Н» на БУДУЩЕЙ контрольной долга не рождает — работа ещё не прошла.
    const isPast = lesson.date <= todayUtcMidnight();

    const gradedStudents = new Set(grades.map((grade) => grade.studentId));
    const absentStudents = new Set(absences.map((absence) => absence.studentId));
    const debtStudents = new Set(debts.map((debt) => debt.studentId));

    // (а) Создание авто-долгов. skipDuplicates гасит гонку параллельных касаний.
    if (isControl && isPast) {
      const missing = [...absentStudents].filter((studentId) => !debtStudents.has(studentId));
      if (missing.length > 0) {
        await prisma.debt.createMany({
          data: missing.map((studentId) => ({
            studentId,
            lessonId: lesson.id,
            origin: "auto",
            // Денормализованные поля — ТОЛЬКО из урока (инвариант Grade/Absence).
            subjectId: lesson.subjectId,
            year: lesson.year,
            quarter: lesson.quarter,
          })),
          skipDuplicates: true,
        });
      }
    }

    // (б) Растворение потерявших основание авто-долгов (в памяти по загруженным).
    const dissolve = debts.filter(
      (debt) =>
        debt.origin === "auto" &&
        debt.clearedAt === null &&
        !gradedStudents.has(debt.studentId) &&
        (!isControl || !isPast || !absentStudents.has(debt.studentId)),
    );
    if (dissolve.length > 0) {
      await prisma.debt.deleteMany({ where: { id: { in: dissolve.map((debt) => debt.id) } } });
    }
  } catch (error) {
    // Ошибка вторичной бухгалтерии не роняет сохранённую оценку (образец —
    // logAudit); пропуск самозалечится при следующем касании урока.
    console.error("[debts] не удалось привести долги урока к инварианту:", error);
  }
}

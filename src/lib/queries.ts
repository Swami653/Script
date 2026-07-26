import { ForbiddenError, type SessionUser } from "@/lib/auth-guards";
import { averageGrade, QUARTERS, yearGrade, type Quarter } from "@/lib/grades";
import { prisma } from "@/lib/prisma";

/**
 * Чтение данных журнала. Все функции предполагают, что вызывающая сторона
 * уже выполнила requirePageRole()/requireRole(); там, где данные принадлежат
 * конкретному ученику, дополнительно проверяется владелец.
 */

export type JournalLesson = {
  id: string;
  date: Date;
  quarter: number;
  topic: string | null;
};

export type JournalRow = {
  student: { id: string; name: string; className: string | null };
  /** lessonId -> оценка */
  cells: Record<string, { id: string; value: number }>;
  /** Средний балл за выбранную четверть */
  average: number | null;
  /** Средние баллы по всем 4 четвертям (для колонки «Год») */
  quarterAverages: (number | null)[];
  /** Итоговая годовая оценка по предмету */
  year: number | null;
};

export type JournalData = {
  lessons: JournalLesson[];
  rows: JournalRow[];
  /** Средний балл всего класса за выбранную четверть */
  classAverage: number | null;
};

export async function getSubjects() {
  return prisma.subject.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { lessons: true, grades: true } },
    },
  });
}

export async function getStudents(className?: string | null) {
  return prisma.user.findMany({
    where: { role: "STUDENT", ...(className ? { className } : {}) },
    orderBy: [{ className: "asc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, className: true },
  });
}

/** Четверти, в которых у предмета есть уроки — для умного выбора четверти по умолчанию. */
export async function getQuartersWithLessons(subjectId: string): Promise<number[]> {
  const rows = await prisma.lesson.groupBy({
    by: ["quarter"],
    where: { subjectId },
    _count: { _all: true },
  });
  return rows.map((row) => row.quarter).sort((a, b) => a - b);
}

/** Список классов, в которых есть ученики (для фильтра журнала). */
export async function getClassNames(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { role: "STUDENT", NOT: { className: null } },
    distinct: ["className"],
    orderBy: { className: "asc" },
    select: { className: true },
  });
  return rows.map((row) => row.className).filter((name): name is string => Boolean(name));
}

/** Данные журнала: строки — ученики, столбцы — уроки выбранной четверти. */
export async function getJournalData(
  subjectId: string,
  quarter: Quarter,
  className?: string | null,
): Promise<JournalData> {
  const [lessons, students, gradesOfQuarter, gradesOfYear] = await Promise.all([
    prisma.lesson.findMany({
      where: { subjectId, quarter },
      orderBy: { date: "asc" },
      select: { id: true, date: true, quarter: true, topic: true },
    }),
    getStudents(className),
    prisma.grade.findMany({
      where: { subjectId, quarter },
      select: { id: true, value: true, studentId: true, lessonId: true },
    }),
    prisma.grade.findMany({
      where: { subjectId },
      select: { value: true, studentId: true, quarter: true },
    }),
  ]);

  const cellsByStudent = new Map<string, Record<string, { id: string; value: number }>>();
  for (const grade of gradesOfQuarter) {
    const cells = cellsByStudent.get(grade.studentId) ?? {};
    cells[grade.lessonId] = { id: grade.id, value: grade.value };
    cellsByStudent.set(grade.studentId, cells);
  }

  const yearValues = new Map<string, number[][]>();
  for (const grade of gradesOfYear) {
    const perQuarter = yearValues.get(grade.studentId) ?? [[], [], [], []];
    const index = grade.quarter - 1;
    if (index >= 0 && index < 4) perQuarter[index]!.push(grade.value);
    yearValues.set(grade.studentId, perQuarter);
  }

  const rows: JournalRow[] = students.map((student) => {
    const cells = cellsByStudent.get(student.id) ?? {};
    const perQuarter = yearValues.get(student.id) ?? [[], [], [], []];
    const quarterAverages = perQuarter.map((values) => averageGrade(values));

    return {
      student,
      cells,
      average: quarterAverages[quarter - 1] ?? null,
      quarterAverages,
      year: yearGrade(quarterAverages),
    };
  });

  const classAverages = rows
    .map((row) => row.average)
    .filter((value): value is number => value !== null);

  return {
    lessons,
    rows,
    classAverage: averageGrade(classAverages),
  };
}

export type StudentSubjectReport = {
  subjectId: string;
  subjectName: string;
  /** Средние баллы по четвертям 1..4 */
  quarterAverages: (number | null)[];
  /** Все оценки по четвертям (для раскрывающегося списка) */
  quarterGrades: { value: number; date: Date; topic: string | null }[][];
  year: number | null;
};

export type StudentReport = {
  student: { id: string; name: string; email: string; className: string | null };
  subjects: StudentSubjectReport[];
  /** Средний балл по всем предметам за каждую четверть */
  overallByQuarter: (number | null)[];
  /** Средний балл за весь год по всем предметам */
  overallYear: number | null;
  totalGrades: number;
};

/**
 * Полная карточка ученика: все предметы × 4 четверти + годовые оценки.
 * Ученик может запросить только свою карточку — иначе 403.
 */
export async function getStudentReport(
  studentId: string,
  viewer: SessionUser,
): Promise<StudentReport | null> {
  if (viewer.role === "STUDENT" && viewer.id !== studentId) {
    throw new ForbiddenError("Ученик может просматривать только свой дневник");
  }

  const student = await prisma.user.findFirst({
    where: { id: studentId, role: "STUDENT" },
    select: { id: true, name: true, email: true, className: true },
  });
  if (!student) return null;

  const [subjects, grades] = await Promise.all([
    prisma.subject.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.grade.findMany({
      where: { studentId },
      orderBy: { lesson: { date: "asc" } },
      select: {
        value: true,
        quarter: true,
        subjectId: true,
        lesson: { select: { date: true, topic: true } },
      },
    }),
  ]);

  const bySubject = new Map<string, { value: number; date: Date; topic: string | null }[][]>();
  for (const grade of grades) {
    const perQuarter = bySubject.get(grade.subjectId) ?? [[], [], [], []];
    const index = grade.quarter - 1;
    if (index >= 0 && index < 4) {
      perQuarter[index]!.push({
        value: grade.value,
        date: grade.lesson.date,
        topic: grade.lesson.topic,
      });
    }
    bySubject.set(grade.subjectId, perQuarter);
  }

  const subjectReports: StudentSubjectReport[] = subjects.map((subject) => {
    const quarterGrades = bySubject.get(subject.id) ?? [[], [], [], []];
    const quarterAverages = quarterGrades.map((items) => averageGrade(items.map((i) => i.value)));

    return {
      subjectId: subject.id,
      subjectName: subject.name,
      quarterGrades,
      quarterAverages,
      year: yearGrade(quarterAverages),
    };
  });

  const overallByQuarter = QUARTERS.map((quarter) => {
    const values = subjectReports
      .map((report) => report.quarterAverages[quarter - 1] ?? null)
      .filter((value): value is number => value !== null);
    return averageGrade(values);
  });

  return {
    student,
    subjects: subjectReports,
    overallByQuarter,
    overallYear: averageGrade(
      subjectReports.map((r) => r.year).filter((v): v is number => v !== null),
    ),
    totalGrades: grades.length,
  };
}

/**
 * Последние оценки ученика — лента «что нового» в дневнике.
 * Сортировка по ДАТЕ УРОКА, а не по времени создания записи: иначе порядок
 * зависит от того, в каком порядке учитель заполнял журнал.
 */
export async function getRecentGrades(studentId: string, take = 12) {
  return prisma.grade.findMany({
    where: { studentId },
    orderBy: [{ lesson: { date: "desc" } }, { createdAt: "desc" }],
    take,
    select: {
      id: true,
      value: true,
      quarter: true,
      createdAt: true,
      subject: { select: { name: true } },
      lesson: { select: { date: true, topic: true } },
      teacher: { select: { name: true } },
    },
  });
}

export async function getAdminStats() {
  const [admins, teachers, students, subjects, grades, lessons] = await Promise.all([
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.user.count({ where: { role: "TEACHER" } }),
    prisma.user.count({ where: { role: "STUDENT" } }),
    prisma.subject.count(),
    prisma.grade.count(),
    prisma.lesson.count(),
  ]);

  return { admins, teachers, students, subjects, grades, lessons };
}

export async function getAllUsers() {
  return prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      className: true,
      mustChangePassword: true,
      createdAt: true,
      _count: { select: { grades: true } },
    },
  });
}

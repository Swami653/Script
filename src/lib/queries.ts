import { ForbiddenError, type SessionUser } from "@/lib/auth-guards";
import { averageGrade, QUARTERS, yearGrade, type Quarter } from "@/lib/grades";
import { prisma } from "@/lib/prisma";

/**
 * Чтение данных журнала. Все функции предполагают, что вызывающая сторона
 * уже выполнила requirePageRole()/requireRole(); там, где данные принадлежат
 * конкретному ученику, дополнительно проверяется владелец.
 *
 * Всё, что связано с оценками, ограничено учебным годом: 2025/2026 и 2027/2028
 * не должны смешиваться в одной таблице.
 */

export type JournalLesson = {
  id: string;
  date: Date;
  quarter: number;
  topic: string | null;
};

/** Оценка в клетке. slot: 0 — первая, 1 — вторая («10/9»). */
export type CellGrade = { id: string; value: number; slot: number };

export type JournalRow = {
  student: { id: string; name: string; className: string | null };
  /** lessonId -> оценки клетки, отсортированные по позиции */
  cells: Record<string, CellGrade[]>;
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
    select: { id: true, name: true, username: true, className: true },
  });
}

/** Четверти выбранного года, где у предмета есть уроки. */
export async function getQuartersWithLessons(
  subjectId: string,
  year: number,
): Promise<number[]> {
  const rows = await prisma.lesson.groupBy({
    by: ["quarter"],
    where: { subjectId, year },
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
  year: number,
  className?: string | null,
): Promise<JournalData> {
  const [lessons, students, gradesOfQuarter, gradesOfYear] = await Promise.all([
    prisma.lesson.findMany({
      where: { subjectId, quarter, year },
      orderBy: { date: "asc" },
      select: { id: true, date: true, quarter: true, topic: true },
    }),
    getStudents(className),
    prisma.grade.findMany({
      where: { subjectId, quarter, year },
      orderBy: { slot: "asc" },
      select: { id: true, value: true, slot: true, studentId: true, lessonId: true },
    }),
    prisma.grade.findMany({
      where: { subjectId, year },
      select: { value: true, studentId: true, quarter: true },
    }),
  ]);

  const cellsByStudent = new Map<string, Record<string, CellGrade[]>>();
  for (const grade of gradesOfQuarter) {
    const cells = cellsByStudent.get(grade.studentId) ?? {};
    const cell = cells[grade.lessonId] ?? [];
    cell.push({ id: grade.id, value: grade.value, slot: grade.slot });
    cells[grade.lessonId] = cell;
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
      student: { id: student.id, name: student.name, className: student.className },
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
  /** Количество оценок по четвертям — чтобы показать «нет оценок» честно */
  quarterCounts: number[];
  year: number | null;
};

export type StudentReport = {
  student: { id: string; name: string; username: string; className: string | null };
  subjects: StudentSubjectReport[];
  /** Средний балл по всем предметам за каждую четверть */
  overallByQuarter: (number | null)[];
  /** Средний балл за весь год по всем предметам */
  overallYear: number | null;
  totalGrades: number;
};

/**
 * Сводная ведомость ученика за учебный год: предметы × 4 четверти + годовые.
 * Ученик может запросить только свою — иначе 403.
 */
export async function getStudentReport(
  studentId: string,
  viewer: SessionUser,
  year: number,
): Promise<StudentReport | null> {
  if (viewer.role === "STUDENT" && viewer.id !== studentId) {
    throw new ForbiddenError("Ученик может просматривать только свой дневник");
  }

  const student = await prisma.user.findFirst({
    where: { id: studentId, role: "STUDENT" },
    select: { id: true, name: true, username: true, className: true },
  });
  if (!student) return null;

  const [subjects, grades] = await Promise.all([
    prisma.subject.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.grade.findMany({
      where: { studentId, year },
      select: { value: true, quarter: true, subjectId: true },
    }),
  ]);

  const bySubject = new Map<string, number[][]>();
  for (const grade of grades) {
    const perQuarter = bySubject.get(grade.subjectId) ?? [[], [], [], []];
    const index = grade.quarter - 1;
    if (index >= 0 && index < 4) perQuarter[index]!.push(grade.value);
    bySubject.set(grade.subjectId, perQuarter);
  }

  const subjectReports: StudentSubjectReport[] = subjects.map((subject) => {
    const perQuarter = bySubject.get(subject.id) ?? [[], [], [], []];
    const quarterAverages = perQuarter.map((values) => averageGrade(values));

    return {
      subjectId: subject.id,
      subjectName: subject.name,
      quarterAverages,
      quarterCounts: perQuarter.map((values) => values.length),
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

export type SubjectLessonRow = {
  lessonId: string;
  date: Date;
  quarter: number;
  topic: string | null;
  values: number[];
};

export type StudentSubjectDetail = {
  student: { id: string; name: string; className: string | null };
  subject: { id: string; name: string };
  /** Уроки по четвертям: 4 массива, в каждом — уроки с оценками ученика */
  byQuarter: SubjectLessonRow[][];
  quarterAverages: (number | null)[];
  year: number | null;
  totalGrades: number;
};

/**
 * Оценки ученика по одному предмету: дата урока, тема и оценка за него.
 * Показываются ВСЕ уроки предмета, в том числе без оценки, — так видно пропуски.
 */
export async function getStudentSubjectDetail(
  studentId: string,
  subjectId: string,
  viewer: SessionUser,
  year: number,
): Promise<StudentSubjectDetail | null> {
  if (viewer.role === "STUDENT" && viewer.id !== studentId) {
    throw new ForbiddenError("Ученик может просматривать только свой дневник");
  }

  const [student, subject] = await Promise.all([
    prisma.user.findFirst({
      where: { id: studentId, role: "STUDENT" },
      select: { id: true, name: true, className: true },
    }),
    prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true, name: true } }),
  ]);
  if (!student || !subject) return null;

  const [lessons, grades] = await Promise.all([
    prisma.lesson.findMany({
      where: { subjectId, year },
      orderBy: { date: "asc" },
      select: { id: true, date: true, quarter: true, topic: true },
    }),
    prisma.grade.findMany({
      where: { studentId, subjectId, year },
      orderBy: { slot: "asc" },
      select: { value: true, slot: true, lessonId: true, quarter: true },
    }),
  ]);

  const valuesByLesson = new Map<string, number[]>();
  for (const grade of grades) {
    const list = valuesByLesson.get(grade.lessonId) ?? [];
    list.push(grade.value);
    valuesByLesson.set(grade.lessonId, list);
  }

  const byQuarter: SubjectLessonRow[][] = [[], [], [], []];
  for (const lesson of lessons) {
    const index = lesson.quarter - 1;
    if (index < 0 || index > 3) continue;
    byQuarter[index]!.push({
      lessonId: lesson.id,
      date: lesson.date,
      quarter: lesson.quarter,
      topic: lesson.topic,
      values: valuesByLesson.get(lesson.id) ?? [],
    });
  }

  const quarterAverages = byQuarter.map((rows) =>
    averageGrade(rows.flatMap((row) => row.values)),
  );

  return {
    student,
    subject,
    byQuarter,
    quarterAverages,
    year: yearGrade(quarterAverages),
    totalGrades: grades.length,
  };
}

/** Последние оценки ученика — лента «что нового» в дневнике. */
export async function getRecentGrades(studentId: string, year: number, take = 12) {
  return prisma.grade.findMany({
    where: { studentId, year },
    orderBy: [{ lesson: { date: "desc" } }, { slot: "asc" }],
    take,
    select: {
      id: true,
      value: true,
      quarter: true,
      subject: { select: { id: true, name: true } },
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
      username: true,
      email: true,
      role: true,
      className: true,
      mustChangePassword: true,
      // Виден только до первого входа пользователя — дальше в базе null.
      tempPassword: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { grades: true } },
    },
  });
}

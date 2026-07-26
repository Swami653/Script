import type { AuditAction } from "@/lib/audit-actions";
import { ForbiddenError, type SessionUser } from "@/lib/auth-guards";
import {
  asGradeKind,
  averageGrade,
  isGradeKind,
  QUARTERS,
  weightedAverage,
  yearGrade,
  type GradeKind,
  type Quarter,
} from "@/lib/grades";
import { prisma } from "@/lib/prisma";
import { addUtcDays, parseDateInputValue, toDateInputValue, todayUtcMidnight } from "@/lib/utils";

/**
 * Чтение данных журнала. Все функции предполагают, что вызывающая сторона
 * уже выполнила requirePageRole()/requireRole(); там, где данные принадлежат
 * конкретному ученику, дополнительно проверяется владелец.
 *
 * Средний балл за четверть — обычное среднее арифметическое (см. grades.ts).
 * Отметка «Н» (Absence) в средний балл не входит — это учёт посещаемости.
 * Всё ограничено учебным годом: 2025/2026 и 2027/2028 не смешиваются.
 *
 * Уроки из корзины (Lesson.deletedAt != null) НЕ показываются нигде: ни в
 * журнале, ни в отчётах, ни в экспорте — их оценки и «Н» тоже выпадают из
 * всех подсчётов до восстановления урока. Отсюда фильтры deletedAt: null
 * (для Grade/Absence — через связь lesson) в каждом запросе ниже.
 */

/** Фильтр «только живые уроки» для запросов по оценкам и отметкам «Н». */
const LIVE_LESSON = { deletedAt: null } as const;

export type JournalLesson = {
  id: string;
  date: Date;
  quarter: number;
  topic: string | null;
  /** «Что задано» к этому уроку. null — не записано. */
  homework: string | null;
  /** Пометка планируемой работы — сырой TEXT из БД; UI приводит через isGradeKind. */
  plannedKind: string | null;
};

/** Оценка в клетке. slot: 0 — первая, 1 — вторая («10/9»). */
export type CellGrade = {
  id: string;
  value: number;
  slot: number;
  kind: GradeKind;
  weight: number;
  comment: string | null;
};

export type JournalRow = {
  student: { id: string; name: string; className: string | null };
  /** lessonId -> оценки клетки, отсортированные по позиции */
  cells: Record<string, CellGrade[]>;
  /** lessonId, на которых у ученика отмечено «Н» */
  absentLessons: string[];
  /** Взвешенный средний балл за выбранную четверть */
  average: number | null;
  /** Средние баллы по всем 4 четвертям (для колонки «Год») */
  quarterAverages: (number | null)[];
  /** Итоговая годовая оценка по предмету */
  year: number | null;
  /** Пропусков за выбранную четверть */
  absencesInQuarter: number;
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
      _count: {
        select: {
          lessons: { where: LIVE_LESSON },
          grades: { where: { lesson: LIVE_LESSON } },
        },
      },
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
export async function getQuartersWithLessons(subjectId: string, year: number): Promise<number[]> {
  const rows = await prisma.lesson.groupBy({
    by: ["quarter"],
    where: { subjectId, year, ...LIVE_LESSON },
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
  const [lessons, students, gradesOfQuarter, gradesOfYear, absencesOfQuarter] = await Promise.all([
    prisma.lesson.findMany({
      where: { subjectId, quarter, year, ...LIVE_LESSON },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        quarter: true,
        topic: true,
        homework: true,
        plannedKind: true,
      },
    }),
    getStudents(className),
    prisma.grade.findMany({
      where: { subjectId, quarter, year, lesson: LIVE_LESSON },
      orderBy: { slot: "asc" },
      select: {
        id: true,
        value: true,
        slot: true,
        kind: true,
        weight: true,
        comment: true,
        studentId: true,
        lessonId: true,
      },
    }),
    prisma.grade.findMany({
      where: { subjectId, year, lesson: LIVE_LESSON },
      select: { value: true, weight: true, studentId: true, quarter: true },
    }),
    prisma.absence.findMany({
      where: { subjectId, quarter, year, lesson: LIVE_LESSON },
      select: { studentId: true, lessonId: true },
    }),
  ]);

  const cellsByStudent = new Map<string, Record<string, CellGrade[]>>();
  for (const grade of gradesOfQuarter) {
    const cells = cellsByStudent.get(grade.studentId) ?? {};
    const cell = cells[grade.lessonId] ?? [];
    cell.push({
      id: grade.id,
      value: grade.value,
      slot: grade.slot,
      kind: asGradeKind(grade.kind),
      weight: grade.weight,
      comment: grade.comment,
    });
    cells[grade.lessonId] = cell;
    cellsByStudent.set(grade.studentId, cells);
  }

  const absentByStudent = new Map<string, string[]>();
  for (const absence of absencesOfQuarter) {
    const list = absentByStudent.get(absence.studentId) ?? [];
    list.push(absence.lessonId);
    absentByStudent.set(absence.studentId, list);
  }

  // Взвешенные оценки года, разложенные по четвертям.
  const yearValues = new Map<string, { value: number; weight: number }[][]>();
  for (const grade of gradesOfYear) {
    const perQuarter = yearValues.get(grade.studentId) ?? [[], [], [], []];
    const index = grade.quarter - 1;
    if (index >= 0 && index < 4) perQuarter[index]!.push({ value: grade.value, weight: grade.weight });
    yearValues.set(grade.studentId, perQuarter);
  }

  const rows: JournalRow[] = students.map((student) => {
    const cells = cellsByStudent.get(student.id) ?? {};
    const absentLessons = absentByStudent.get(student.id) ?? [];
    const perQuarter = yearValues.get(student.id) ?? [[], [], [], []];
    const quarterAverages = perQuarter.map((items) => weightedAverage(items));

    return {
      student: { id: student.id, name: student.name, className: student.className },
      cells,
      absentLessons,
      average: quarterAverages[quarter - 1] ?? null,
      quarterAverages,
      year: yearGrade(quarterAverages),
      absencesInQuarter: absentLessons.length,
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
  /** Взвешенные средние баллы по четвертям 1..4 */
  quarterAverages: (number | null)[];
  /** Количество оценок по четвертям — чтобы показать «нет оценок» честно */
  quarterCounts: number[];
  /** Пропусков по предмету за год */
  absences: number;
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
  totalAbsences: number;
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

  const [subjects, grades, absences] = await Promise.all([
    prisma.subject.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.grade.findMany({
      where: { studentId, year, lesson: LIVE_LESSON },
      select: { value: true, weight: true, quarter: true, subjectId: true },
    }),
    prisma.absence.groupBy({
      by: ["subjectId"],
      where: { studentId, year, lesson: LIVE_LESSON },
      _count: { _all: true },
    }),
  ]);

  const bySubject = new Map<string, { value: number; weight: number }[][]>();
  for (const grade of grades) {
    const perQuarter = bySubject.get(grade.subjectId) ?? [[], [], [], []];
    const index = grade.quarter - 1;
    if (index >= 0 && index < 4) perQuarter[index]!.push({ value: grade.value, weight: grade.weight });
    bySubject.set(grade.subjectId, perQuarter);
  }

  const absenceBySubject = new Map(absences.map((a) => [a.subjectId, a._count._all]));

  const subjectReports: StudentSubjectReport[] = subjects.map((subject) => {
    const perQuarter = bySubject.get(subject.id) ?? [[], [], [], []];
    const quarterAverages = perQuarter.map((items) => weightedAverage(items));

    return {
      subjectId: subject.id,
      subjectName: subject.name,
      quarterAverages,
      quarterCounts: perQuarter.map((items) => items.length),
      absences: absenceBySubject.get(subject.id) ?? 0,
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
    totalAbsences: absences.reduce((sum, a) => sum + a._count._all, 0),
  };
}

export type SubjectLessonRow = {
  lessonId: string;
  date: Date;
  quarter: number;
  topic: string | null;
  /** «Что задано» к этому уроку. null — не записано. */
  homework: string | null;
  /** Пометка планируемой работы; защитное чтение через isGradeKind. */
  plannedKind: GradeKind | null;
  grades: { value: number; kind: GradeKind; comment: string | null }[];
  absent: boolean;
};

export type StudentSubjectDetail = {
  student: { id: string; name: string; className: string | null };
  subject: { id: string; name: string };
  /** Прошедшие уроки по четвертям: 4 массива, в каждом — уроки предмета */
  byQuarter: SubjectLessonRow[][];
  /** Будущие уроки (date > сегодня UTC) без оценок и без «Н», по возрастанию даты. */
  upcoming: SubjectLessonRow[];
  quarterAverages: (number | null)[];
  year: number | null;
  totalGrades: number;
  totalAbsences: number;
};

/**
 * Оценки ученика по одному предмету: дата урока, тема, оценки (с типом и
 * комментарием) и отметки «Н». Показываются ВСЕ уроки предмета — видно пропуски.
 *
 * После появления «Сетки на четверть» будущие уроки отделяются от прошедших:
 * строка попадает в byQuarter, если урок уже был (date <= сегодня UTC) ИЛИ
 * в ней есть оценки или «Н»; остальное — в upcoming. Партиция здесь, а не в
 * компоненте: страницей пользуется и учитель (?student=), и ученик.
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

  const [lessons, grades, absences] = await Promise.all([
    prisma.lesson.findMany({
      where: { subjectId, year, ...LIVE_LESSON },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        quarter: true,
        topic: true,
        homework: true,
        plannedKind: true,
      },
    }),
    prisma.grade.findMany({
      where: { studentId, subjectId, year, lesson: LIVE_LESSON },
      orderBy: { slot: "asc" },
      select: { value: true, weight: true, kind: true, comment: true, lessonId: true, quarter: true },
    }),
    prisma.absence.findMany({
      where: { studentId, subjectId, year, lesson: LIVE_LESSON },
      select: { lessonId: true },
    }),
  ]);

  const gradesByLesson = new Map<string, typeof grades>();
  for (const grade of grades) {
    const list = gradesByLesson.get(grade.lessonId) ?? [];
    list.push(grade);
    gradesByLesson.set(grade.lessonId, list);
  }
  const absentLessons = new Set(absences.map((a) => a.lessonId));

  const todayUtc = todayUtcMidnight();
  const byQuarter: SubjectLessonRow[][] = [[], [], [], []];
  const upcoming: SubjectLessonRow[] = [];
  const weightedByQuarter: { value: number; weight: number }[][] = [[], [], [], []];
  for (const lesson of lessons) {
    const index = lesson.quarter - 1;
    if (index < 0 || index > 3) continue;
    const cell = gradesByLesson.get(lesson.id) ?? [];
    const absent = absentLessons.has(lesson.id);
    const row: SubjectLessonRow = {
      lessonId: lesson.id,
      date: lesson.date,
      quarter: lesson.quarter,
      topic: lesson.topic,
      homework: lesson.homework,
      plannedKind: isGradeKind(lesson.plannedKind) ? lesson.plannedKind : null,
      grades: cell.map((g) => ({ value: g.value, kind: asGradeKind(g.kind), comment: g.comment })),
      absent,
    };
    // Будущий урок без содержимого клетки — в «Впереди», а не в ленту четверти.
    if (lesson.date <= todayUtc || cell.length > 0 || absent) {
      byQuarter[index]!.push(row);
      for (const g of cell) weightedByQuarter[index]!.push({ value: g.value, weight: g.weight });
    } else {
      upcoming.push(row);
    }
  }

  const quarterAverages = weightedByQuarter.map((items) => weightedAverage(items));

  return {
    student,
    subject,
    byQuarter,
    upcoming,
    quarterAverages,
    year: yearGrade(quarterAverages),
    totalGrades: grades.length,
    totalAbsences: absences.length,
  };
}

export type AgendaLesson = {
  lessonId: string;
  date: Date;
  subject: { id: string; name: string };
  topic: string | null;
  homework: string | null;
  /** Пометка планируемой работы; защитное чтение через isGradeKind. */
  plannedKind: GradeKind | null;
};

export type StudentAgenda = {
  /** Запланированные работы: plannedKind != null, окно сегодня..+14 дней. */
  planned: AgendaLesson[];
  /** Домашние задания: homework != null, окно сегодня..+6 дней. */
  homework: AgendaLesson[];
  /** В активном году есть хоть один живой урок с домашкой — «фича в работе». */
  homeworkInUse: boolean;
};

/**
 * Агенда дневника: блоки «Впереди» и «Что задано». Только чтение; вызывается
 * ПОСЛЕ гвардов страницы. Персональных данных нет — урок не привязан к классу,
 * поэтому агенда глобальна по году, как и весь дневник (ограничение модели,
 * фиксируется осознанно).
 */
export async function getStudentAgenda(year: number, today = new Date()): Promise<StudentAgenda> {
  const todayUtc = parseDateInputValue(toDateInputValue(today));

  const [lessons, homeworkCount] = await Promise.all([
    prisma.lesson.findMany({
      where: {
        year,
        ...LIVE_LESSON,
        date: { gte: todayUtc, lt: addUtcDays(todayUtc, 15) },
        OR: [{ NOT: { homework: null } }, { NOT: { plannedKind: null } }],
      },
      orderBy: [{ date: "asc" }, { subject: { name: "asc" } }],
      select: {
        id: true,
        date: true,
        topic: true,
        homework: true,
        plannedKind: true,
        subject: { select: { id: true, name: true } },
      },
    }),
    prisma.lesson.count({ where: { year, ...LIVE_LESSON, NOT: { homework: null } } }),
  ]);

  const items: AgendaLesson[] = lessons.map((lesson) => ({
    lessonId: lesson.id,
    date: lesson.date,
    subject: lesson.subject,
    topic: lesson.topic,
    homework: lesson.homework,
    plannedKind: isGradeKind(lesson.plannedKind) ? lesson.plannedKind : null,
  }));

  const homeworkHorizon = addUtcDays(todayUtc, 7);
  return {
    planned: items.filter((item) => item.plannedKind !== null),
    homework: items.filter((item) => item.homework !== null && item.date < homeworkHorizon),
    homeworkInUse: homeworkCount > 0,
  };
}

/** Последние оценки ученика — лента «что нового» в дневнике. */
export async function getRecentGrades(studentId: string, year: number, take = 12) {
  return prisma.grade.findMany({
    where: { studentId, year, lesson: LIVE_LESSON },
    orderBy: [{ lesson: { date: "desc" } }, { slot: "asc" }],
    take,
    select: {
      id: true,
      value: true,
      quarter: true,
      kind: true,
      comment: true,
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
    prisma.grade.count({ where: { lesson: LIVE_LESSON } }),
    prisma.lesson.count({ where: LIVE_LESSON }),
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
      _count: { select: { grades: { where: { lesson: LIVE_LESSON } } } },
    },
  });
}

/**
 * Темы прошлых уроков предмета (все годы, без повторов, свежие первыми) —
 * подсказки <datalist> в форме создания урока. Только чтение.
 */
export async function getTopicSuggestions(subjectId: string): Promise<string[]> {
  const rows = await prisma.lesson.findMany({
    where: { subjectId, ...LIVE_LESSON, NOT: { topic: null } },
    distinct: ["topic"],
    orderBy: { date: "desc" },
    take: 100,
    select: { topic: true },
  });
  return rows
    .map((row) => row.topic)
    .filter((topic): topic is string => Boolean(topic && topic.trim()));
}

/** Уроки в корзине — для страницы /journal/trash, свежеудалённые сверху. */
export async function getTrashedLessons() {
  return prisma.lesson.findMany({
    where: { NOT: { deletedAt: null } },
    orderBy: { deletedAt: "desc" },
    select: {
      id: true,
      date: true,
      quarter: true,
      year: true,
      topic: true,
      deletedAt: true,
      subject: { select: { name: true } },
      _count: { select: { grades: true, absences: true } },
    },
  });
}

export const AUDIT_PAGE_SIZE = 50;

/** Страница журнала изменений: свежие записи сверху, фильтр по типу действия. */
export async function getAuditLog(options: { action?: AuditAction | null; page: number }) {
  const where = options.action ? { action: options.action } : {};
  const page = Math.max(1, options.page);

  const [total, entries] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
    }),
  ]);

  return { entries, total, pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)) };
}

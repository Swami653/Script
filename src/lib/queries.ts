import type { AuditAction } from "@/lib/audit-actions";
import { ForbiddenError, type SessionUser } from "@/lib/auth-guards";
import { requireOwnChild } from "@/lib/family-guards";
import {
  asMasteryLevel,
  asStampKind,
  assessmentOf,
  type Assessment,
  type MasteryLevel,
  type StampKind,
} from "@/lib/gradeless";
import {
  asGradeKind,
  averageGrade,
  classSummary,
  displayQuarter,
  isBorderlineAverage,
  isControlLesson,
  isGradeKind,
  QUARTER_MIN_GRADES,
  quarterMark,
  QUARTERS,
  weightedAverage,
  yearGrade,
  type ClassSummary,
  type GradeKind,
  type Quarter,
} from "@/lib/grades";
import { prisma } from "@/lib/prisma";
import { periodContains } from "@/lib/quarters";
import {
  detectSignals,
  parentVisibleSignals,
  SIGNAL_RULES,
  signalLevel,
  signalSeverity,
  type Signal,
  type SignalLevel,
} from "@/lib/signals";
import {
  addUtcDays,
  diffUtcDays,
  parseDateInputValue,
  toDateInputValue,
  todayUtcMidnight,
} from "@/lib/utils";

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
  /**
   * «Не разобрался в теме»: сколько учеников ТЕКУЩЕЙ выборки (с учётом фильтра
   * класса) просят объяснить ещё раз и кто именно — в порядке строк журнала.
   * Данные видит только учитель/администратор: getJournalData вызывается
   * исключительно из-под requirePageRole/requireRole(GRADE_EDITOR_ROLES), а на
   * страницы /family и /student этот запрос не импортируется (family-guards).
   */
  confusedCount: number;
  confusedNames: string[];
};

/** Штамп «Ознакомлен» на оценке — снимок для попапа клетки журнала. */
export type CellAck = {
  parentName: string;
  seenValue: number;
  createdAt: Date;
  updatedAt: Date;
};

/** Оценка в клетке. slot: 0 — первая, 1 — вторая («10/9»). */
export type CellGrade = {
  id: string;
  value: number;
  slot: number;
  kind: GradeKind;
  weight: number;
  comment: string | null;
  /** Штампы «Ознакомлен» всех родителей — «изменена после просмотра» выводится
   *  сравнением seenValue !== value, а не хранится. */
  acks: CellAck[];
};

export type JournalRow = {
  student: { id: string; name: string; className: string | null };
  /**
   * Система оценивания строки — подсказка интерфейсу (assessmentOf по классу).
   * Данные ниже отдаются независимо от неё: история переживает перевод 2→3.
   */
  assessment: Assessment;
  /**
   * У ученика есть хотя бы один привязанный родитель. Без него отсутствие
   * штампа читается как «семейный доступ не подключён», а не «семья игнорирует».
   */
  hasFamily: boolean;
  /** Уровень «требует внимания» (сигналы не хранятся — считаются при рендере). */
  attention: SignalLevel;
  /** Сигналы строки — формулировки для попапа/тултипа учителя. */
  signals: Signal[];
  /** lessonId -> оценки клетки, отсортированные по позиции */
  cells: Record<string, CellGrade[]>;
  /** lessonId -> уровень освоения клетки (безотметочные 1–2 классы). */
  mastery: Record<string, { level: MasteryLevel; comment: string | null }>;
  /** lessonId -> печати клетки; null — неизвестный вид (рисуется как «Печать»). */
  stamps: Record<string, (StampKind | null)[]>;
  /** Печатей за ГОД — колонка «Печати» безотметочной строки. */
  stampsYearTotal: number;
  /** lessonId, на которых у ученика отмечено «Н» */
  absentLessons: string[];
  /**
   * Непрощённые долги четверти (lessonId -> debtId). «Открытость» грид
   * дорисовывает сам: маркер гаснет, как только в клетке появляется оценка —
   * в том числе оптимистичная, до ответа сервера.
   */
  openDebts: { lessonId: string; debtId: string }[];
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
  const [
    lessons,
    students,
    gradesOfQuarter,
    gradesOfYear,
    absencesOfQuarter,
    debtsOfQuarter,
    masteryOfQuarter,
    stampsOfYear,
    confusionsOfQuarter,
  ] = await Promise.all([
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
    // Непрощённые долги четверти — маркер в клетке и кнопка «Снять долг».
    prisma.debt.findMany({
      where: { subjectId, quarter, year, clearedAt: null, lesson: LIVE_LESSON },
      select: { id: true, studentId: true, lessonId: true },
    }),
    // Безотметочные данные читаются БЕЗУСЛОВНО: у оценочных классов запросы
    // возвращают пустоту по индексу (≈0 стоимости), а отображение при
    // переводе 2→3 получается data-driven, без флагов и второго прохода.
    prisma.masteryMark.findMany({
      where: { subjectId, quarter, year, lesson: LIVE_LESSON },
      select: { level: true, comment: true, studentId: true, lessonId: true },
    }),
    // Печати за ГОД: клетки четверти + счётчик колонки «Печати».
    prisma.lessonStamp.findMany({
      where: { subjectId, year, lesson: LIVE_LESSON },
      orderBy: { createdAt: "asc" },
      select: { kind: true, quarter: true, studentId: true, lessonId: true },
    }),
    // «Не разобрался в теме» — счётчик шапки столбца и список имён панели
    // урока. Данные учительские (см. комментарий у JournalLesson).
    prisma.topicConfusion.findMany({
      where: { subjectId, quarter, year, lesson: LIVE_LESSON },
      select: { studentId: true, lessonId: true },
    }),
  ]);

  // Штампы «Ознакомлен» оценок четверти и наличие семьи у учеников — для
  // галочки-подписи в чипе и трёх состояний попапа клетки.
  const [ackRows, familyLinks] = await Promise.all([
    prisma.gradeAck.findMany({
      where: { grade: { subjectId, quarter, year, lesson: LIVE_LESSON } },
      orderBy: { updatedAt: "asc" },
      select: {
        gradeId: true,
        parentName: true,
        seenValue: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.parentLink.groupBy({ by: ["studentId"] }),
  ]);
  const acksByGrade = new Map<string, CellAck[]>();
  for (const ack of ackRows) {
    const list = acksByGrade.get(ack.gradeId) ?? [];
    list.push({
      parentName: ack.parentName,
      seenValue: ack.seenValue,
      createdAt: ack.createdAt,
      updatedAt: ack.updatedAt,
    });
    acksByGrade.set(ack.gradeId, list);
  }
  const withFamily = new Set(familyLinks.map((link) => link.studentId));

  // Светофор «требует внимания» — одна обёртка на все витрины.
  const signalMap = await getSignalsForStudents(
    students.map((student) => student.id),
    year,
  );

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
      acks: acksByGrade.get(grade.id) ?? [],
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

  const debtsByStudent = new Map<string, { lessonId: string; debtId: string }[]>();
  for (const debt of debtsOfQuarter) {
    const list = debtsByStudent.get(debt.studentId) ?? [];
    list.push({ lessonId: debt.lessonId, debtId: debt.id });
    debtsByStudent.set(debt.studentId, list);
  }

  // Уровни клеток: защитное чтение — неизвестный уровень отбрасывается.
  const masteryByStudent = new Map<
    string,
    Record<string, { level: MasteryLevel; comment: string | null }>
  >();
  for (const mark of masteryOfQuarter) {
    const level = asMasteryLevel(mark.level);
    if (level === null) continue;
    const cells = masteryByStudent.get(mark.studentId) ?? {};
    cells[mark.lessonId] = { level, comment: mark.comment };
    masteryByStudent.set(mark.studentId, cells);
  }

  // Печати: клетки выбранной четверти + годовой счётчик. Неизвестный вид
  // не падает — рисуется нейтральной «Печатью» (null).
  const stampsByStudent = new Map<string, Record<string, (StampKind | null)[]>>();
  const stampsYearByStudent = new Map<string, number>();
  for (const stamp of stampsOfYear) {
    stampsYearByStudent.set(stamp.studentId, (stampsYearByStudent.get(stamp.studentId) ?? 0) + 1);
    if (stamp.quarter !== quarter) continue;
    const cells = stampsByStudent.get(stamp.studentId) ?? {};
    const cell = cells[stamp.lessonId] ?? [];
    cell.push(asStampKind(stamp.kind));
    cells[stamp.lessonId] = cell;
    stampsByStudent.set(stamp.studentId, cells);
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
      assessment: assessmentOf(student.className),
      hasFamily: withFamily.has(student.id),
      attention: signalMap.get(student.id)?.level ?? "ok",
      signals: signalMap.get(student.id)?.signals ?? [],
      cells,
      mastery: masteryByStudent.get(student.id) ?? {},
      stamps: stampsByStudent.get(student.id) ?? {},
      stampsYearTotal: stampsYearByStudent.get(student.id) ?? 0,
      absentLessons,
      openDebts: debtsByStudent.get(student.id) ?? [],
      average: quarterAverages[quarter - 1] ?? null,
      quarterAverages,
      year: yearGrade(quarterAverages),
      absencesInQuarter: absentLessons.length,
    };
  });

  /* Только оценочные строки: у безотметочного ученика среднего не существует,
     а редкая историческая оценка (перевод 3→2) не должна попадать в средний
     балл класса. Подвал сетки и мастер итогов считают так же — иначе шапка
     журнала и его же подвал показывали бы разные числа. */
  const classAverages = rows
    .filter((row) => row.assessment === "graded")
    .map((row) => row.average)
    .filter((value): value is number => value !== null);

  // «Не разобрался в теме»: кто из учеников просит объяснить урок ещё раз.
  // Имена собираются проходом по students — список повторяет порядок строк
  // журнала и отбрасывает отметивших вне текущего фильтра класса: кого нет в
  // сетке, того нет и в счётчике, иначе «2 из 15» не сходилось бы со списком.
  const confusedByLesson = new Map<string, Set<string>>();
  for (const mark of confusionsOfQuarter) {
    const set = confusedByLesson.get(mark.lessonId) ?? new Set<string>();
    set.add(mark.studentId);
    confusedByLesson.set(mark.lessonId, set);
  }
  const lessonsWithConfusion: JournalLesson[] = lessons.map((lesson) => {
    const confusedIds = confusedByLesson.get(lesson.id);
    const confusedNames = confusedIds
      ? students.filter((student) => confusedIds.has(student.id)).map((student) => student.name)
      : [];
    return { ...lesson, confusedCount: confusedNames.length, confusedNames };
  });

  return {
    lessons: lessonsWithConfusion,
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
  /**
   * Официальные четвертные отметки из снимков закрытых четвертей (QuarterResult).
   * null на позиции закрытой четверти означает «н/а»; у открытых четвертей
   * отметки не существует нигде — смотрите quarterAverages.
   */
  quarterFinals: (number | null)[];
  /** Закрыта ли четверть (есть строка снимка). Индексация как у quarterAverages. */
  closedQuarters: boolean[];
  /** Была ли четверть безотметочной на момент закрытия: «б/о», а не «н/а». */
  gradelessQuarters: boolean[];
  /** Пропусков по предмету за год */
  absences: number;
  year: number | null;
  /** Сколько уровней каждого вида по четвертям 1..4 (безотметочные 1–2 классы). */
  masteryByQuarter: Record<MasteryLevel, number>[];
  /** Словесные характеристики по четвертям 1..4; null — не написана. */
  notes: (string | null)[];
};

/** Лист печатей ученика за год (безотметочный дневник). */
export type StampSheet = {
  total: number;
  byKind: Partial<Record<StampKind, number>>;
  /** Печатей по четвертям 1..4. */
  byQuarter: number[];
  /** Свежие первыми; kind null — неизвестный вид (рисуется как «Печать»). */
  items: { id: string; kind: StampKind | null; date: Date; subjectName: string }[];
};

export type StudentReport = {
  student: { id: string; name: string; username: string; className: string | null };
  /** Подсказка интерфейсу: какой дневник рисовать (assessmentOf по классу). */
  assessment: Assessment;
  subjects: StudentSubjectReport[];
  /** Средний балл по всем предметам за каждую четверть */
  overallByQuarter: (number | null)[];
  /** Средний балл за весь год по всем предметам */
  overallYear: number | null;
  totalGrades: number;
  totalAbsences: number;
  /** Печати за год (безотметочные 1–2 классы; у оценочных пустой). */
  stampSheet: StampSheet;
};

/**
 * Сводная ведомость ученика за учебный год: предметы × 4 четверти + годовые.
 * Доступ решает requireOwnChild (единая дверь): чужой ребёнок для родителя
 * и чужой дневник для ученика — 404, неотличимый от несуществующего id.
 */
export async function getStudentReport(
  studentId: string,
  viewer: SessionUser,
  year: number,
): Promise<StudentReport | null> {
  const student = await requireOwnChild(viewer, studentId);

  const [subjects, grades, absences, finals, masteryRows, noteRows, stampRows] =
    await Promise.all([
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
      // Официальные отметки закрытых четвертей — из снимков-ведомостей.
      // Переоткрытие удаляет снимок каскадом, и отметка сама исчезает из дневника.
      prisma.quarterResult.findMany({
        where: { studentId, year },
        select: { subjectId: true, quarter: true, finalGrade: true, gradeless: true },
      }),
      // Безотметочные данные — безусловно: у оценочного ученика пусто по
      // индексу, у переведённого 2→3 история остаётся видимой.
      prisma.masteryMark.findMany({
        where: { studentId, year, lesson: LIVE_LESSON },
        select: { level: true, quarter: true, subjectId: true },
      }),
      prisma.quarterNote.findMany({
        where: { studentId, year },
        select: { text: true, quarter: true, subjectId: true },
      }),
      // Лист печатей: свежие первыми; take страхует от вырожденного объёма.
      prisma.lessonStamp.findMany({
        where: { studentId, year, lesson: LIVE_LESSON },
        orderBy: { lesson: { date: "desc" } },
        take: 400,
        select: {
          id: true,
          kind: true,
          quarter: true,
          lesson: { select: { date: true, subject: { select: { name: true } } } },
        },
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

  const finalsBySubject = new Map<string, (number | null)[]>();
  const closedBySubject = new Map<string, boolean[]>();
  /* Была ли четверть безотметочной НА МОМЕНТ ЗАКРЫТИЯ — читаем из снимка, а не
     из текущего класса: ученик мог перейти 2→3 внутри года, и тогда закрытая
     вторая четверть обязана остаться «б/о», а не превратиться в «н/а»
     («не аттестован» — обвинение, которого не было). */
  const gradelessClosedBySubject = new Map<string, boolean[]>();
  for (const row of finals) {
    const index = row.quarter - 1;
    if (index < 0 || index > 3) continue;
    const subjectFinals = finalsBySubject.get(row.subjectId) ?? [null, null, null, null];
    const subjectClosed = closedBySubject.get(row.subjectId) ?? [false, false, false, false];
    const subjectGradeless =
      gradelessClosedBySubject.get(row.subjectId) ?? [false, false, false, false];
    subjectFinals[index] = row.finalGrade;
    subjectClosed[index] = true;
    subjectGradeless[index] = row.gradeless;
    finalsBySubject.set(row.subjectId, subjectFinals);
    closedBySubject.set(row.subjectId, subjectClosed);
    gradelessClosedBySubject.set(row.subjectId, subjectGradeless);
  }

  // Уровни освоения по (предмет × четверть) — защитное чтение уровня.
  const masteryBySubject = new Map<string, Record<MasteryLevel, number>[]>();
  for (const mark of masteryRows) {
    const level = asMasteryLevel(mark.level);
    const index = mark.quarter - 1;
    if (level === null || index < 0 || index > 3) continue;
    const perQuarter =
      masteryBySubject.get(mark.subjectId) ??
      QUARTERS.map(() => ({ high: 0, medium: 0, low: 0 }) as Record<MasteryLevel, number>);
    perQuarter[index]![level] += 1;
    masteryBySubject.set(mark.subjectId, perQuarter);
  }

  const notesBySubject = new Map<string, (string | null)[]>();
  for (const note of noteRows) {
    const index = note.quarter - 1;
    if (index < 0 || index > 3) continue;
    const perQuarter = notesBySubject.get(note.subjectId) ?? [null, null, null, null];
    perQuarter[index] = note.text;
    notesBySubject.set(note.subjectId, perQuarter);
  }

  const stampSheet: StampSheet = {
    total: stampRows.length,
    byKind: {},
    byQuarter: [0, 0, 0, 0],
    items: stampRows.map((stamp) => ({
      id: stamp.id,
      kind: asStampKind(stamp.kind),
      date: stamp.lesson.date,
      subjectName: stamp.lesson.subject.name,
    })),
  };
  for (const stamp of stampSheet.items) {
    if (stamp.kind !== null) {
      stampSheet.byKind[stamp.kind] = (stampSheet.byKind[stamp.kind] ?? 0) + 1;
    }
  }
  for (const stamp of stampRows) {
    const index = stamp.quarter - 1;
    if (index >= 0 && index < 4) stampSheet.byQuarter[index]! += 1;
  }

  const subjectReports: StudentSubjectReport[] = subjects.map((subject) => {
    const perQuarter = bySubject.get(subject.id) ?? [[], [], [], []];
    const quarterAverages = perQuarter.map((items) => weightedAverage(items));

    return {
      subjectId: subject.id,
      subjectName: subject.name,
      quarterAverages,
      quarterCounts: perQuarter.map((items) => items.length),
      quarterFinals: finalsBySubject.get(subject.id) ?? [null, null, null, null],
      closedQuarters: closedBySubject.get(subject.id) ?? [false, false, false, false],
      gradelessQuarters: gradelessClosedBySubject.get(subject.id) ?? [false, false, false, false],
      absences: absenceBySubject.get(subject.id) ?? 0,
      // Годовая — ТОЛЬКО от живых средних четвертей (правило 1.2):
      // finalGrade — документ, в годовую он не входит.
      year: yearGrade(quarterAverages),
      masteryByQuarter:
        masteryBySubject.get(subject.id) ??
        QUARTERS.map(() => ({ high: 0, medium: 0, low: 0 }) as Record<MasteryLevel, number>),
      notes: notesBySubject.get(subject.id) ?? [null, null, null, null],
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
    assessment: assessmentOf(student.className),
    subjects: subjectReports,
    overallByQuarter,
    overallYear: averageGrade(
      subjectReports.map((r) => r.year).filter((v): v is number => v !== null),
    ),
    totalGrades: grades.length,
    totalAbsences: absences.reduce((sum, a) => sum + a._count._all, 0),
    stampSheet,
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
  grades: {
    id: string;
    value: number;
    kind: GradeKind;
    comment: string | null;
    /** Есть штамп «Ознакомлен» ЭТОГО зрителя-родителя (другим ролям — false). */
    ackedByViewer: boolean;
    /** Штамп есть, но оценка изменена после подписи (seenValue !== value). */
    ackStale: boolean;
  }[];
  /** Уровень освоения клетки (безотметочные 1–2 классы); null — не отмечен. */
  mastery: { level: MasteryLevel; comment: string | null } | null;
  /** Печати клетки; null в массиве — неизвестный вид (рисуется как «Печать»). */
  stamps: (StampKind | null)[];
  absent: boolean;
  /**
   * Ученик отметил «не разобрался в теме». Для зрителя-родителя ВСЕГДА false —
   * отметки ему не отдаются вовсе (см. решение приватности в
   * getStudentSubjectDetail).
   */
  confused: boolean;
};

export type StudentSubjectDetail = {
  student: { id: string; name: string; className: string | null };
  subject: { id: string; name: string };
  /** Подсказка интерфейсу: какой разбор рисовать (assessmentOf по классу). */
  assessment: Assessment;
  /** Прошедшие уроки по четвертям: 4 массива, в каждом — уроки предмета */
  byQuarter: SubjectLessonRow[][];
  /** Будущие уроки (date > сегодня UTC) без оценок и без «Н», по возрастанию даты. */
  upcoming: SubjectLessonRow[];
  quarterAverages: (number | null)[];
  /** Сколько уровней каждого вида по четвертям 1..4 (безотметочные). */
  masteryByQuarter: Record<MasteryLevel, number>[];
  /** Словесные характеристики по четвертям 1..4; null — не написана. */
  notesByQuarter: (string | null)[];
  /** Печатей по предмету за год. */
  totalStamps: number;
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
  // Единая дверь: чужой ребёнок и несуществующий id неотличимы (404).
  const [student, subject] = await Promise.all([
    requireOwnChild(viewer, studentId),
    prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true, name: true } }),
  ]);
  if (!subject) return null;

  const [lessons, grades, absences, masteryRows, stampRows, noteRows] = await Promise.all([
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
      select: {
        id: true,
        value: true,
        weight: true,
        kind: true,
        comment: true,
        lessonId: true,
        quarter: true,
      },
    }),
    prisma.absence.findMany({
      where: { studentId, subjectId, year, lesson: LIVE_LESSON },
      select: { lessonId: true },
    }),
    // Безотметочные данные — безусловно (у оценочного ученика пустота по индексу).
    prisma.masteryMark.findMany({
      where: { studentId, subjectId, year, lesson: LIVE_LESSON },
      select: { level: true, comment: true, lessonId: true, quarter: true },
    }),
    prisma.lessonStamp.findMany({
      where: { studentId, subjectId, year, lesson: LIVE_LESSON },
      orderBy: { createdAt: "asc" },
      select: { kind: true, lessonId: true },
    }),
    prisma.quarterNote.findMany({
      where: { studentId, subjectId, year },
      select: { text: true, quarter: true },
    }),
  ]);

  /*
   * ПРИВАТНОСТЬ отметки «не разобрался в теме» — зафиксированное решение фичи:
   *
   *  - одноклассники не видят НИЧЕГО (ни счётчика, ни факта): ученик через
   *    requireOwnChild получает только СВОЮ страницу, а в его данных чужих
   *    отметок нет по построению запроса (фильтр studentId);
   *  - учитель и администратор видят отметку и здесь (карточка ученика), и в
   *    журнале поимённо — иначе не подойти к конкретному ребёнку;
   *  - РОДИТЕЛЬ НЕ ВИДИТ ОТМЕТКИ СВОЕГО РЕБЁНКА ВОВСЕ. Это осознанный выбор,
   *    а не пропуск: «не понял» — канал доверия между ребёнком и учителем.
   *    Если просьба объяснить оборачивается домашним разбором, ребёнок просто
   *    перестаёт нажимать — и канал умирает. Поэтому родительскому зрителю
   *    строки не запрашиваются в принципе: чего нет в выборке, то не утечёт
   *    ни в рендер, ни в будущие уведомления.
   */
  const confusionRows =
    viewer.role === "PARENT"
      ? []
      : await prisma.topicConfusion.findMany({
          where: { studentId, subjectId, year, lesson: LIVE_LESSON },
          select: { lessonId: true },
        });
  const confusedLessons = new Set(confusionRows.map((row) => row.lessonId));

  // Штампы «Ознакомлен» ЭТОГО родителя — для кнопок и пометки «изменена после
  // просмотра» в родительском разборе. Другим ролям — false/false; чужие
  // подписи в этот запрос не попадают вовсе.
  const viewerAcks =
    viewer.role === "PARENT" && grades.length > 0
      ? await prisma.gradeAck.findMany({
          where: { parentId: viewer.id, gradeId: { in: grades.map((grade) => grade.id) } },
          select: { gradeId: true, seenValue: true },
        })
      : [];
  const ackByGrade = new Map(viewerAcks.map((ack) => [ack.gradeId, ack.seenValue]));

  const gradesByLesson = new Map<string, typeof grades>();
  for (const grade of grades) {
    const list = gradesByLesson.get(grade.lessonId) ?? [];
    list.push(grade);
    gradesByLesson.set(grade.lessonId, list);
  }
  const absentLessons = new Set(absences.map((a) => a.lessonId));

  const masteryByLesson = new Map<string, { level: MasteryLevel; comment: string | null }>();
  const masteryByQuarter = QUARTERS.map(
    () => ({ high: 0, medium: 0, low: 0 }) as Record<MasteryLevel, number>,
  );
  for (const mark of masteryRows) {
    const level = asMasteryLevel(mark.level);
    if (level === null) continue;
    masteryByLesson.set(mark.lessonId, { level, comment: mark.comment });
    const index = mark.quarter - 1;
    if (index >= 0 && index < 4) masteryByQuarter[index]![level] += 1;
  }
  const stampsByLesson = new Map<string, (StampKind | null)[]>();
  for (const stamp of stampRows) {
    const list = stampsByLesson.get(stamp.lessonId) ?? [];
    list.push(asStampKind(stamp.kind));
    stampsByLesson.set(stamp.lessonId, list);
  }
  const notesByQuarter: (string | null)[] = [null, null, null, null];
  for (const note of noteRows) {
    const index = note.quarter - 1;
    if (index >= 0 && index < 4) notesByQuarter[index] = note.text;
  }

  const todayUtc = todayUtcMidnight();
  const byQuarter: SubjectLessonRow[][] = [[], [], [], []];
  const upcoming: SubjectLessonRow[] = [];
  const weightedByQuarter: { value: number; weight: number }[][] = [[], [], [], []];
  for (const lesson of lessons) {
    const index = lesson.quarter - 1;
    if (index < 0 || index > 3) continue;
    const cell = gradesByLesson.get(lesson.id) ?? [];
    const absent = absentLessons.has(lesson.id);
    const mastery = masteryByLesson.get(lesson.id) ?? null;
    const stamps = stampsByLesson.get(lesson.id) ?? [];
    const row: SubjectLessonRow = {
      lessonId: lesson.id,
      date: lesson.date,
      quarter: lesson.quarter,
      topic: lesson.topic,
      homework: lesson.homework,
      plannedKind: isGradeKind(lesson.plannedKind) ? lesson.plannedKind : null,
      grades: cell.map((g) => ({
        id: g.id,
        value: g.value,
        kind: asGradeKind(g.kind),
        comment: g.comment,
        ackedByViewer: ackByGrade.has(g.id),
        ackStale: ackByGrade.has(g.id) && ackByGrade.get(g.id) !== g.value,
      })),
      mastery,
      stamps,
      absent,
      confused: confusedLessons.has(lesson.id),
    };
    // Будущий урок без содержимого клетки — в «Впереди», а не в ленту четверти.
    if (lesson.date <= todayUtc || cell.length > 0 || absent || mastery || stamps.length > 0) {
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
    assessment: assessmentOf(student.className),
    byQuarter,
    upcoming,
    quarterAverages,
    masteryByQuarter,
    notesByQuarter,
    totalStamps: stampRows.length,
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

/** Оценка ленты «что нового»; acked/ackStale — штамп зрителя-родителя. */
export type RecentGrade = {
  id: string;
  value: number;
  quarter: number;
  kind: string;
  comment: string | null;
  createdAt: Date;
  subject: { id: string; name: string };
  lesson: { date: Date; topic: string | null };
  teacher: { name: string } | null;
  /** Есть штамп «Ознакомлен» ЭТОГО зрителя-родителя (другим ролям — false). */
  acked: boolean;
  /** Штамп есть, но оценка изменена после подписи (seenValue !== value). */
  ackStale: boolean;
};

/**
 * Последние оценки ученика — лента «что нового» в дневнике и на семейном
 * экране. Доступ решает requireOwnChild (единая дверь, отказ — 404).
 */
export async function getRecentGrades(
  studentId: string,
  viewer: SessionUser,
  year: number,
  take = 12,
): Promise<RecentGrade[]> {
  await requireOwnChild(viewer, studentId);

  const grades = await prisma.grade.findMany({
    where: { studentId, year, lesson: LIVE_LESSON },
    orderBy: [{ lesson: { date: "desc" } }, { slot: "asc" }],
    take,
    select: {
      id: true,
      value: true,
      quarter: true,
      kind: true,
      comment: true,
      createdAt: true,
      subject: { select: { id: true, name: true } },
      lesson: { select: { date: true, topic: true } },
      teacher: { select: { name: true } },
    },
  });

  // Штампы этого родителя — для кнопок «Ознакомлен» в ленте.
  const acks =
    viewer.role === "PARENT" && grades.length > 0
      ? await prisma.gradeAck.findMany({
          where: { parentId: viewer.id, gradeId: { in: grades.map((grade) => grade.id) } },
          select: { gradeId: true, seenValue: true },
        })
      : [];
  const ackByGrade = new Map(acks.map((ack) => [ack.gradeId, ack.seenValue]));

  return grades.map((grade) => ({
    ...grade,
    acked: ackByGrade.has(grade.id),
    ackStale: ackByGrade.has(grade.id) && ackByGrade.get(grade.id) !== grade.value,
  }));
}

/**
 * Оценки года без свежего штампа ЭТОГО родителя (нет подписи или подпись
 * устарела) — для кнопки «Ознакомлен со всем новым». Не больше limit id.
 */
export async function getUnackedGradeIds(
  studentId: string,
  viewer: SessionUser,
  year: number,
  limit = 50,
): Promise<string[]> {
  await requireOwnChild(viewer, studentId);
  if (viewer.role !== "PARENT") return [];

  const [grades, acks] = await Promise.all([
    prisma.grade.findMany({
      where: { studentId, year, lesson: LIVE_LESSON },
      orderBy: [{ lesson: { date: "desc" } }, { slot: "asc" }],
      select: { id: true, value: true },
    }),
    prisma.gradeAck.findMany({
      where: { parentId: viewer.id, grade: { studentId, year } },
      select: { gradeId: true, seenValue: true },
    }),
  ]);
  const ackByGrade = new Map(acks.map((ack) => [ack.gradeId, ack.seenValue]));

  return grades
    .filter((grade) => ackByGrade.get(grade.id) !== grade.value)
    .slice(0, limit)
    .map((grade) => grade.id);
}

/** Событие безотметочной ленты «что нового»: уровень или печать. */
export type GradelessFeedItem = {
  id: string;
  type: "mastery" | "stamp";
  /** Для type "mastery"; защитное чтение — неизвестный уровень отброшен раньше. */
  level: MasteryLevel | null;
  comment: string | null;
  /** Для type "stamp"; null — неизвестный вид (рисуется как «Печать»). */
  kind: StampKind | null;
  quarter: number;
  subject: { id: string; name: string };
  lesson: { date: Date; topic: string | null };
  teacherName: string | null;
};

/**
 * Лента «что нового» безотметочного дневника: уровни и печати вперемешку,
 * свежие первыми. Вызывается ВМЕСТО getRecentGrades для дневника 1–2 класса.
 * Два запроса по take и слияние в JS: отдельный union в SQL не окупается.
 * Доступ решает requireOwnChild (единая дверь, отказ — 404).
 */
export async function getRecentGradelessMarks(
  studentId: string,
  viewer: SessionUser,
  year: number,
  take = 12,
): Promise<GradelessFeedItem[]> {
  await requireOwnChild(viewer, studentId);

  const [mastery, stamps] = await Promise.all([
    prisma.masteryMark.findMany({
      where: { studentId, year, lesson: LIVE_LESSON },
      orderBy: { lesson: { date: "desc" } },
      take,
      select: {
        id: true,
        level: true,
        comment: true,
        quarter: true,
        lesson: {
          select: { date: true, topic: true, subject: { select: { id: true, name: true } } },
        },
        teacher: { select: { name: true } },
      },
    }),
    prisma.lessonStamp.findMany({
      where: { studentId, year, lesson: LIVE_LESSON },
      orderBy: { lesson: { date: "desc" } },
      take,
      select: {
        id: true,
        kind: true,
        quarter: true,
        lesson: {
          select: { date: true, topic: true, subject: { select: { id: true, name: true } } },
        },
        teacher: { select: { name: true } },
      },
    }),
  ]);

  const items: GradelessFeedItem[] = [
    ...mastery
      .filter((mark) => asMasteryLevel(mark.level) !== null)
      .map((mark) => ({
        id: mark.id,
        type: "mastery" as const,
        level: asMasteryLevel(mark.level),
        comment: mark.comment,
        kind: null,
        quarter: mark.quarter,
        subject: mark.lesson.subject,
        lesson: { date: mark.lesson.date, topic: mark.lesson.topic },
        teacherName: mark.teacher?.name ?? null,
      })),
    ...stamps.map((stamp) => ({
      id: stamp.id,
      type: "stamp" as const,
      level: null,
      comment: null,
      kind: asStampKind(stamp.kind),
      quarter: stamp.quarter,
      subject: stamp.lesson.subject,
      lesson: { date: stamp.lesson.date, topic: stamp.lesson.topic },
      teacherName: stamp.teacher?.name ?? null,
    })),
  ];

  return items
    .sort((a, b) => b.lesson.date.getTime() - a.lesson.date.getTime())
    .slice(0, take);
}

export async function getAdminStats() {
  const [admins, teachers, students, parents, subjects, grades, lessons] = await Promise.all([
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.user.count({ where: { role: "TEACHER" } }),
    prisma.user.count({ where: { role: "STUDENT" } }),
    prisma.user.count({ where: { role: "PARENT" } }),
    prisma.subject.count(),
    prisma.grade.count({ where: { lesson: LIVE_LESSON } }),
    prisma.lesson.count({ where: LIVE_LESSON }),
  ]);

  return { admins, teachers, students, parents, subjects, grades, lessons };
}

/* ── Семьи (админка) ──────────────────────────────────────────────────────── */

export type ParentRow = {
  id: string;
  name: string;
  username: string;
  /** Временный пароль — виден до первого входа (дисциплина tempPassword). */
  tempPassword: string | null;
  lastLoginAt: Date | null;
  children: { id: string; name: string; className: string | null }[];
  /** Состояние Telegram: привязан / заблокировал бота / код выдан / нет. */
  telegram: "linked" | "blocked" | "code_issued" | "none";
  codeExpiresAt: Date | null;
};

/** Раздел «Семьи» в админке. Вызывается ПОСЛЕ requirePageRole(["ADMIN"]). */
export async function getParentsOverview(): Promise<ParentRow[]> {
  const now = new Date();
  const parents = await prisma.user.findMany({
    where: { role: "PARENT" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      username: true,
      tempPassword: true,
      lastLoginAt: true,
      parentLinks: {
        select: {
          student: { select: { id: true, name: true, className: true } },
        },
      },
      telegramLink: { select: { blockedAt: true } },
      telegramCodes: {
        where: { usedAt: null, expiresAt: { gt: now } },
        orderBy: { expiresAt: "desc" },
        take: 1,
        select: { expiresAt: true },
      },
    },
  });

  return parents.map((parent) => {
    const liveCode = parent.telegramCodes[0] ?? null;
    const telegram: ParentRow["telegram"] = parent.telegramLink
      ? parent.telegramLink.blockedAt
        ? "blocked"
        : "linked"
      : liveCode
        ? "code_issued"
        : "none";
    return {
      id: parent.id,
      name: parent.name,
      username: parent.username,
      tempPassword: parent.tempPassword,
      lastLoginAt: parent.lastLoginAt,
      children: parent.parentLinks
        .map((link) => link.student)
        .sort((a, b) => a.name.localeCompare(b.name, "ru")),
      telegram,
      codeExpiresAt: liveCode?.expiresAt ?? null,
    };
  });
}

/* ── Сигналы «требует внимания» ───────────────────────────────────────────── */

/**
 * ОДНА обёртка сигналов на все три витрины (журнал, семейные карточки,
 * /admin/attention): оценки года, «Н» за 30 дней и границы четвертей —
 * тремя батч-запросами, дальше чистый движок detectSignals. Сигналы нигде
 * не хранятся и не экспортируются.
 */
export async function getSignalsForStudents(
  studentIds: string[],
  year: number,
  today: Date = todayUtcMidnight(),
): Promise<Map<string, { level: SignalLevel; signals: Signal[] }>> {
  const result = new Map<string, { level: SignalLevel; signals: Signal[] }>();
  if (studentIds.length === 0) return result;

  const absencesFrom = addUtcDays(today, -SIGNAL_RULES.absences.windowDays);
  const [grades, absences, periods] = await Promise.all([
    prisma.grade.findMany({
      where: { studentId: { in: studentIds }, year, lesson: LIVE_LESSON },
      select: {
        studentId: true,
        value: true,
        subjectId: true,
        subject: { select: { name: true } },
        lesson: { select: { date: true } },
      },
    }),
    prisma.absence.findMany({
      where: {
        studentId: { in: studentIds },
        year,
        lesson: { deletedAt: null, date: { gte: absencesFrom } },
      },
      select: { studentId: true, lesson: { select: { date: true } } },
    }),
    prisma.quarterPeriod.findMany({
      where: { year },
      select: { quarter: true, startDate: true, endDate: true },
    }),
  ]);

  // Начало ТЕКУЩЕЙ четверти; сегодня вне всех периодов — каникулы (null),
  // и движок сам оставляет активным только правило посещаемости.
  const currentPeriod = periods.find((period) => periodContains(period, today)) ?? null;
  const quarterStart = currentPeriod?.startDate ?? null;

  const gradesByStudent = new Map<string, SignalInputGrades>();
  for (const grade of grades) {
    const list = gradesByStudent.get(grade.studentId) ?? [];
    list.push({
      value: grade.value,
      date: grade.lesson.date,
      subjectId: grade.subjectId,
      subjectName: grade.subject.name,
    });
    gradesByStudent.set(grade.studentId, list);
  }
  const absencesByStudent = new Map<string, { date: Date }[]>();
  for (const absence of absences) {
    const list = absencesByStudent.get(absence.studentId) ?? [];
    list.push({ date: absence.lesson.date });
    absencesByStudent.set(absence.studentId, list);
  }

  for (const studentId of studentIds) {
    const own = gradesByStudent.get(studentId) ?? [];
    const signals = detectSignals({
      today,
      quarterStart,
      grades: own,
      absences: absencesByStudent.get(studentId) ?? [],
      hasAnyGradeThisYear: own.length > 0,
    });
    result.set(studentId, { level: signalLevel(signals), signals });
  }
  return result;
}

type SignalInputGrades = { value: number; date: Date; subjectId: string; subjectName: string }[];

/** Для /admin/attention: только watch/act, act — первыми. */
export async function getAttentionList(year: number): Promise<
  {
    student: { id: string; name: string; className: string | null };
    level: SignalLevel;
    signals: Signal[];
  }[]
> {
  const students = await getStudents();
  const signalMap = await getSignalsForStudents(
    students.map((student) => student.id),
    year,
  );

  return students
    .map((student) => {
      const entry = signalMap.get(student.id) ?? { level: "ok" as const, signals: [] };
      return {
        student: { id: student.id, name: student.name, className: student.className },
        level: entry.level,
        signals: [...entry.signals].sort(
          (a, b) =>
            (signalSeverity(a) === "act" ? 0 : 1) - (signalSeverity(b) === "act" ? 0 : 1),
        ),
      };
    })
    .filter((row) => row.level !== "ok")
    .sort((a, b) => {
      if (a.level !== b.level) return a.level === "act" ? -1 : 1;
      return a.student.name.localeCompare(b.student.name, "ru");
    });
}

/**
 * Привязка Telegram ТЕКУЩЕГО пользователя — блок в профиле родителя.
 * userId берётся из сессии на странице, не из ввода.
 */
export async function getOwnTelegramLink(userId: string) {
  return prisma.telegramLink.findUnique({
    where: { userId },
    select: { createdAt: true, blockedAt: true },
  });
}

/* ── Семейный экран (родитель) ────────────────────────────────────────────── */

/** Окно «что нового» для родителя, который ещё не открывал дневник: 14 дней. */
export const FAMILY_NEW_WINDOW_DAYS = 14;

export type FamilyChildCard = {
  student: { id: string; name: string; className: string | null };
  /** Шаблон карточки: 1–2 класс — печати и уровни, без единой цифры-оценки. */
  assessment: Assessment;
  /** Показываемая четверть (displayQuarter) и средний за неё. */
  quarter: Quarter;
  quarterAverage: number | null;
  quarterAverages: (number | null)[];
  /** «Новое с вашего визита»: записи с createdAt позже lastViewedAt. */
  newGrades: number;
  newAbsences: number;
  newStamps: number;
  newMastery: number;
  /** null — дневник ещё не открывали: «новое» считается за 14 дней. */
  lastViewedAt: Date | null;
  /** Свежие оценки (≤5) со штампом ЭТОГО родителя. */
  recentChips: {
    id: string;
    value: number;
    kind: GradeKind;
    comment: string | null;
    acked: boolean;
    ackStale: boolean;
  }[];
  /** Свежие печати и уровни (≤5) — карточка 1–2 класса. */
  recentGradeless: {
    id: string;
    type: "stamp" | "mastery";
    kind: StampKind | null;
    level: MasteryLevel | null;
    date: Date;
  }[];
  /** Оценок года без свежего штампа ЭТОГО родителя. */
  unackedCount: number;
  absences30d: number;
  totalAbsences: number;
  stampsYearTotal: number;
  /** Характеристика показываемой четверти (безотметочные 1–2 классы). */
  quarterNote: string | null;
  /** Уровень «обратите внимание» и ≤2 родительских сигнала (без silence). */
  level: SignalLevel;
  signals: Signal[];
};

/**
 * Карточки детей для /family. Детей выводит ТОЛЬКО из ParentLink по id
 * родителя из СЕССИИ — параметра «какие дети» не существует по построению,
 * подменять нечего. Никаких данных класса и одноклассников здесь нет.
 */
export async function getFamilyOverview(
  parent: SessionUser,
  year: number,
): Promise<FamilyChildCard[]> {
  // Защита от неверного вызова с чужой страницы; периметр держит requirePageRole.
  if (parent.role !== "PARENT") {
    throw new ForbiddenError("Семейный экран доступен только родителю");
  }

  const links = await prisma.parentLink.findMany({
    where: { parentId: parent.id },
    select: {
      lastViewedAt: true,
      student: { select: { id: true, name: true, className: true } },
    },
  });
  if (links.length === 0) return [];
  const studentIds = links.map((link) => link.student.id);

  const monthAgo = addUtcDays(todayUtcMidnight(), -30);
  const [signalMap, grades, absences, acks, stamps, mastery, notes] = await Promise.all([
    getSignalsForStudents(studentIds, year),
    prisma.grade.findMany({
      where: { studentId: { in: studentIds }, year, lesson: LIVE_LESSON },
      orderBy: [{ lesson: { date: "desc" } }, { slot: "asc" }],
      select: {
        id: true,
        studentId: true,
        value: true,
        weight: true,
        kind: true,
        comment: true,
        quarter: true,
        createdAt: true,
      },
    }),
    prisma.absence.findMany({
      where: { studentId: { in: studentIds }, year, lesson: LIVE_LESSON },
      select: { studentId: true, createdAt: true, lesson: { select: { date: true } } },
    }),
    prisma.gradeAck.findMany({
      where: { parentId: parent.id, grade: { studentId: { in: studentIds }, year } },
      select: { gradeId: true, seenValue: true },
    }),
    prisma.lessonStamp.findMany({
      where: { studentId: { in: studentIds }, year, lesson: LIVE_LESSON },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        studentId: true,
        kind: true,
        createdAt: true,
        lesson: { select: { date: true } },
      },
    }),
    prisma.masteryMark.findMany({
      where: { studentId: { in: studentIds }, year, lesson: LIVE_LESSON },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        studentId: true,
        level: true,
        createdAt: true,
        lesson: { select: { date: true } },
      },
    }),
    prisma.quarterNote.findMany({
      where: { studentId: { in: studentIds }, year },
      select: { studentId: true, quarter: true, text: true },
    }),
  ]);

  const ackByGrade = new Map(acks.map((ack) => [ack.gradeId, ack.seenValue]));

  return links
    .sort((a, b) => a.student.name.localeCompare(b.student.name, "ru"))
    .map((link) => {
      const student = link.student;
      // «Новое» — по реальному моменту записи (createdAt), не по дате урока:
      // оценку за вторник учитель мог выставить в пятницу.
      const newSince =
        link.lastViewedAt ??
        new Date(Date.now() - FAMILY_NEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);

      const ownGrades = grades.filter((grade) => grade.studentId === student.id);
      const ownAbsences = absences.filter((absence) => absence.studentId === student.id);
      const ownStamps = stamps.filter((stamp) => stamp.studentId === student.id);
      const ownMastery = mastery.filter((mark) => mark.studentId === student.id);

      const perQuarter: { value: number; weight: number }[][] = [[], [], [], []];
      for (const grade of ownGrades) {
        const index = grade.quarter - 1;
        if (index >= 0 && index < 4)
          perQuarter[index]!.push({ value: grade.value, weight: grade.weight });
      }
      const quarterAverages = perQuarter.map((items) => weightedAverage(items));
      const quarter = displayQuarter(quarterAverages);

      const noteRow = notes.find(
        (note) => note.studentId === student.id && note.quarter === quarter,
      );

      const recentGradeless = [
        ...ownStamps.map((stamp) => ({
          id: stamp.id,
          type: "stamp" as const,
          kind: asStampKind(stamp.kind),
          level: null,
          date: stamp.lesson.date,
          createdAt: stamp.createdAt,
        })),
        ...ownMastery
          .filter((mark) => asMasteryLevel(mark.level) !== null)
          .map((mark) => ({
            id: mark.id,
            type: "mastery" as const,
            kind: null,
            level: asMasteryLevel(mark.level),
            date: mark.lesson.date,
            createdAt: mark.createdAt,
          })),
      ]
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, 5)
        .map(({ createdAt: _createdAt, ...item }) => item);

      return {
        student,
        assessment: assessmentOf(student.className),
        quarter,
        quarterAverage: quarterAverages[quarter - 1] ?? null,
        quarterAverages,
        newGrades: ownGrades.filter((grade) => grade.createdAt > newSince).length,
        newAbsences: ownAbsences.filter((absence) => absence.createdAt > newSince).length,
        newStamps: ownStamps.filter((stamp) => stamp.createdAt > newSince).length,
        newMastery: ownMastery.filter((mark) => mark.createdAt > newSince).length,
        lastViewedAt: link.lastViewedAt,
        recentChips: ownGrades.slice(0, 5).map((grade) => ({
          id: grade.id,
          value: grade.value,
          kind: asGradeKind(grade.kind),
          comment: grade.comment,
          acked: ackByGrade.has(grade.id),
          ackStale: ackByGrade.has(grade.id) && ackByGrade.get(grade.id) !== grade.value,
        })),
        recentGradeless,
        unackedCount: ownGrades.filter((grade) => ackByGrade.get(grade.id) !== grade.value)
          .length,
        absences30d: ownAbsences.filter((absence) => absence.lesson.date >= monthAgo).length,
        totalAbsences: ownAbsences.length,
        stampsYearTotal: ownStamps.length,
        quarterNote: noteRow?.text ?? null,
        // Родительская витрина: silence отфильтрован, максимум два сигнала.
        // Уровень тоже пересчитывается ПО ВИДИМЫМ сигналам: карточка не должна
        // тревожить «поговорите с учителем» из-за скрытого от семьи правила.
        level: signalLevel(parentVisibleSignals(signalMap.get(student.id)?.signals ?? [])),
        signals: parentVisibleSignals(signalMap.get(student.id)?.signals ?? []),
      };
    });
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

/* ── Замок четверти и мастер «Итоги четверти» ─────────────────────────────── */

export type QuarterLockInfo = { closedAt: Date; closedByName: string };

/** Замок четверти предмета (null — четверть открыта). Не кэшировать между запросами. */
export async function getQuarterLock(
  subjectId: string,
  quarter: Quarter,
  year: number,
): Promise<QuarterLockInfo | null> {
  return prisma.quarterLock.findUnique({
    where: { subjectId_year_quarter: { subjectId, year, quarter } },
    select: { closedAt: true, closedByName: true },
  });
}

/** Все замки учебного года — для строки-статуса журнала и матрицы на /journal/year. */
export async function getQuarterLocksForYear(
  year: number,
): Promise<{ subjectId: string; quarter: number; closedAt: Date; closedByName: string }[]> {
  return prisma.quarterLock.findMany({
    where: { year },
    select: { subjectId: true, quarter: true, closedAt: true, closedByName: true },
  });
}

export type QuarterReviewRow = {
  student: { id: string; name: string; className: string | null };
  /** weightedAverage оценок четверти. */
  average: number | null;
  /** quarterMark(average); null — не аттестован. */
  proposed: number | null;
  gradeCount: number;
  absenceCount: number;
  /** isBorderlineAverage(average) — средний в спорной зоне у границы округления. */
  borderline: boolean;
  /** 0 < gradeCount < QUARTER_MIN_GRADES — отметка ставится, но оценок мало. */
  belowMinGrades: boolean;
  /** Только ПРОШЕДШИЕ контрольные без его оценки; absent — стояло ли «Н». */
  missedControls: { lessonId: string; date: Date; topic: string | null; absent: boolean }[];
  /** Открытых долгов: без пары в оценках и без clearedAt (выводится, не хранится). */
  openDebts: number;
};

/** Строка безотметочного ученика в мастере «Итоги четверти». */
export type GradelessReviewRow = {
  student: { id: string; name: string; className: string | null };
  /** Уровней освоения за четверть. */
  masteryCount: number;
  /** Сколько уровней каждого вида за четверть. */
  levelCounts: Record<MasteryLevel, number>;
  /** Печатей за четверть. */
  stampCount: number;
  absenceCount: number;
  /** Оценок за четверть (историческая аномалия перевода классов; обычно 0). */
  gradeCount: number;
  /** Характеристика выбранной четверти; null — не написана. */
  note: string | null;
  /** Характеристики всех четвертей 1..4 — для «взять из прошлой четверти». */
  notes: (string | null)[];
};

export type QuarterReview = {
  locked: QuarterLockInfo | null;
  /** Снимок при locked — экран-ведомость рисуется ИЗ НЕГО, а не из живых данных. */
  results:
    | {
        studentId: string;
        studentName: string;
        className: string | null;
        average: number | null;
        finalGrade: number | null;
        gradeCount: number;
        absenceCount: number;
        /** true — строка безотметочного ученика: «б/о», не «н/а». */
        gradeless: boolean;
        /** Снимок характеристики на момент закрытия. */
        note: string | null;
      }[]
    | null;
  lessonsTotal: number;
  lessonsWithoutTopic: { lessonId: string; date: Date }[];
  controlCount: number;
  /** Уроки четверти в корзине — предупреждение мастера. */
  trashedCount: number;
  /** Учеников после фильтра класса — для примечания «в ведомости N из M». */
  totalStudents: number;
  /**
   * ОЦЕНОЧНЫЕ ученики «со следом» по (subjectId, year): ≥1 оценка или ≥1 «Н»
   * за ГОД. Безотметочные (1–2 классы) — отдельно в gradelessRows, поэтому
   * classAverage/summary их не видят и весь 1 класс не «неаттестован».
   */
  rows: QuarterReviewRow[];
  /** Безотметочные ученики «со следом» (оценка, «Н», уровень или печать за год). */
  gradelessRows: GradelessReviewRow[];
  /** Покрытие характеристик выбранной четверти по безотметочным ученикам. */
  noteCoverage: { filled: number; total: number };
  classAverage: number | null;
  summary: ClassSummary;
};

/**
 * Данные мастера «Итоги четверти». ЭТОЙ ЖЕ функцией (без фильтра класса)
 * closeQuarterAction пишет снимок: «учитель закрыл ровно то, что видел» —
 * конструктивно. Состав учеников — «со следом» за ГОД, а не за четверть:
 * ученик с пустой четвертью по изучаемому предмету обязан попасть в ведомость
 * как «н/а», а параллельный класс по чужому предмету — не попасть вовсе.
 */
export async function getQuarterReview(
  subjectId: string,
  quarter: Quarter,
  year: number,
  className?: string | null,
): Promise<QuarterReview> {
  const [
    lock,
    lessons,
    students,
    grades,
    absences,
    debts,
    gradeTrace,
    absenceTrace,
    trashedCount,
    masteryOfYear,
    stampsOfYear,
    notesOfYear,
  ] = await Promise.all([
    prisma.quarterLock.findUnique({
      where: { subjectId_year_quarter: { subjectId, year, quarter } },
      select: { id: true, closedAt: true, closedByName: true },
    }),
    prisma.lesson.findMany({
      where: { subjectId, quarter, year, ...LIVE_LESSON },
      orderBy: { date: "asc" },
      select: { id: true, date: true, topic: true, plannedKind: true },
    }),
    getStudents(className),
    prisma.grade.findMany({
      where: { subjectId, quarter, year, lesson: LIVE_LESSON },
      select: { studentId: true, lessonId: true, value: true, weight: true, kind: true },
    }),
    prisma.absence.findMany({
      where: { subjectId, quarter, year, lesson: LIVE_LESSON },
      select: { studentId: true, lessonId: true },
    }),
    prisma.debt.findMany({
      where: { subjectId, quarter, year, clearedAt: null, lesson: LIVE_LESSON },
      select: { studentId: true, lessonId: true },
    }),
    prisma.grade.groupBy({
      by: ["studentId"],
      where: { subjectId, year, lesson: LIVE_LESSON },
    }),
    prisma.absence.groupBy({
      by: ["studentId"],
      where: { subjectId, year, lesson: LIVE_LESSON },
    }),
    prisma.lesson.count({
      where: { subjectId, quarter, year, NOT: { deletedAt: null } },
    }),
    // Безотметочные данные за ГОД одним запросом каждое: и след, и счётчики
    // четверти (лишнего round-trip нет — важно при connection_limit=1).
    prisma.masteryMark.findMany({
      where: { subjectId, year, lesson: LIVE_LESSON },
      select: { studentId: true, quarter: true, level: true },
    }),
    prisma.lessonStamp.findMany({
      where: { subjectId, year, lesson: LIVE_LESSON },
      select: { studentId: true, quarter: true },
    }),
    prisma.quarterNote.findMany({
      where: { subjectId, year },
      select: { studentId: true, quarter: true, text: true },
    }),
  ]);

  const results = lock
    ? await prisma.quarterResult.findMany({
        where: { lockId: lock.id },
        orderBy: [{ className: "asc" }, { studentName: "asc" }],
        select: {
          studentId: true,
          studentName: true,
          className: true,
          average: true,
          finalGrade: true,
          gradeCount: true,
          absenceCount: true,
          gradeless: true,
          note: true,
        },
      })
    : null;

  // Контрольные — единый предикат isControlLesson (пометка ИЛИ оценки kind=control).
  const kindsByLesson = new Map<string, string[]>();
  for (const grade of grades) {
    const list = kindsByLesson.get(grade.lessonId) ?? [];
    list.push(grade.kind);
    kindsByLesson.set(grade.lessonId, list);
  }
  const todayUtc = todayUtcMidnight();
  const controlLessons = lessons.filter((lesson) =>
    isControlLesson(lesson.plannedKind, kindsByLesson.get(lesson.id) ?? []),
  );
  const pastControls = controlLessons.filter((lesson) => lesson.date <= todayUtc);

  const gradesByStudent = new Map<string, { value: number; weight: number }[]>();
  const gradedPairs = new Set<string>();
  for (const grade of grades) {
    const list = gradesByStudent.get(grade.studentId) ?? [];
    list.push({ value: grade.value, weight: grade.weight });
    gradesByStudent.set(grade.studentId, list);
    gradedPairs.add(`${grade.studentId}|${grade.lessonId}`);
  }
  const absentPairs = new Set(absences.map((a) => `${a.studentId}|${a.lessonId}`));
  const absencesByStudent = new Map<string, number>();
  for (const absence of absences) {
    absencesByStudent.set(absence.studentId, (absencesByStudent.get(absence.studentId) ?? 0) + 1);
  }
  const openDebtsByStudent = new Map<string, number>();
  for (const debt of debts) {
    if (gradedPairs.has(`${debt.studentId}|${debt.lessonId}`)) continue; // закрыт оценкой
    openDebtsByStudent.set(debt.studentId, (openDebtsByStudent.get(debt.studentId) ?? 0) + 1);
  }

  // Счётчики безотметочной четверти + следы за год.
  const levelCountsByStudent = new Map<string, Record<MasteryLevel, number>>();
  const stampCountByStudent = new Map<string, number>();
  const notesByStudent = new Map<string, (string | null)[]>();
  const traced = new Set<string>();
  for (const row of gradeTrace) traced.add(row.studentId);
  for (const row of absenceTrace) traced.add(row.studentId);
  for (const mark of masteryOfYear) {
    traced.add(mark.studentId);
    if (mark.quarter !== quarter) continue;
    const level = asMasteryLevel(mark.level);
    if (level === null) continue;
    const counts =
      levelCountsByStudent.get(mark.studentId) ??
      ({ high: 0, medium: 0, low: 0 } as Record<MasteryLevel, number>);
    counts[level] += 1;
    levelCountsByStudent.set(mark.studentId, counts);
  }
  for (const stamp of stampsOfYear) {
    traced.add(stamp.studentId);
    if (stamp.quarter !== quarter) continue;
    stampCountByStudent.set(stamp.studentId, (stampCountByStudent.get(stamp.studentId) ?? 0) + 1);
  }
  for (const note of notesOfYear) {
    const index = note.quarter - 1;
    if (index < 0 || index > 3) continue;
    const perQuarter = notesByStudent.get(note.studentId) ?? [null, null, null, null];
    perQuarter[index] = note.text;
    notesByStudent.set(note.studentId, perQuarter);
  }

  // Разделение предикатом: ведомость оценочных и блок безотметочных не смешиваются.
  const tracedStudents = students.filter((student) => traced.has(student.id));
  const gradedStudents = tracedStudents.filter(
    (student) => assessmentOf(student.className) === "graded",
  );
  const gradelessStudents = tracedStudents.filter(
    (student) => assessmentOf(student.className) === "gradeless",
  );

  const rows: QuarterReviewRow[] = gradedStudents
    .map((student) => {
      const items = gradesByStudent.get(student.id) ?? [];
      const average = weightedAverage(items);
      return {
        student: { id: student.id, name: student.name, className: student.className },
        average,
        proposed: quarterMark(average),
        gradeCount: items.length,
        absenceCount: absencesByStudent.get(student.id) ?? 0,
        borderline: isBorderlineAverage(average),
        belowMinGrades: items.length > 0 && items.length < QUARTER_MIN_GRADES,
        missedControls: pastControls
          .filter((lesson) => !gradedPairs.has(`${student.id}|${lesson.id}`))
          .map((lesson) => ({
            lessonId: lesson.id,
            date: lesson.date,
            topic: lesson.topic,
            absent: absentPairs.has(`${student.id}|${lesson.id}`),
          })),
        openDebts: openDebtsByStudent.get(student.id) ?? 0,
      };
    });

  const gradelessRows: GradelessReviewRow[] = gradelessStudents.map((student) => {
    const levelCounts =
      levelCountsByStudent.get(student.id) ??
      ({ high: 0, medium: 0, low: 0 } as Record<MasteryLevel, number>);
    const notes = notesByStudent.get(student.id) ?? [null, null, null, null];
    return {
      student: { id: student.id, name: student.name, className: student.className },
      masteryCount: levelCounts.high + levelCounts.medium + levelCounts.low,
      levelCounts,
      stampCount: stampCountByStudent.get(student.id) ?? 0,
      absenceCount: absencesByStudent.get(student.id) ?? 0,
      gradeCount: (gradesByStudent.get(student.id) ?? []).length,
      note: notes[quarter - 1] ?? null,
      notes,
    };
  });

  return {
    locked: lock ? { closedAt: lock.closedAt, closedByName: lock.closedByName } : null,
    results,
    lessonsTotal: lessons.length,
    lessonsWithoutTopic: lessons
      .filter((lesson) => !lesson.topic?.trim())
      .map((lesson) => ({ lessonId: lesson.id, date: lesson.date })),
    controlCount: controlLessons.length,
    trashedCount,
    totalStudents: students.length,
    rows,
    gradelessRows,
    noteCoverage: {
      filled: gradelessRows.filter((row) => row.note !== null && row.note.trim() !== "").length,
      total: gradelessRows.length,
    },
    classAverage: averageGrade(
      rows.map((row) => row.average).filter((value): value is number => value !== null),
    ),
    summary: classSummary(rows.map((row) => row.proposed)),
  };
}

export type QuarterCloseOverviewRow = {
  subjectId: string;
  subjectName: string;
  /** Уже закрыт (когда и кем) — в пакет не попадает. */
  locked: { closedAt: Date; closedByName: string } | null;
  lessonsTotal: number;
  lessonsWithoutTopic: number;
  /** Учеников «со следом» по предмету за год. */
  students: number;
  /** Из них без оценок в четверти — попадут в ведомость как «н/а». */
  unassessed: number;
  /** Спорных средних у границы округления. */
  borderline: number;
};

/**
 * Готовность ВСЕХ предметов четверти к закрытию — для пакетного закрытия
 * (в школе один учитель ведёт все предметы, по одному он закрывал бы 12–16 раз).
 * Считается несколькими групповыми запросами, а не getQuarterReview на предмет.
 */
export async function getQuarterCloseOverview(
  quarter: Quarter,
  year: number,
): Promise<QuarterCloseOverviewRow[]> {
  const [
    subjects,
    locks,
    lessonCounts,
    topiclessCounts,
    grades,
    gradeTrace,
    absenceTrace,
    masteryTrace,
    stampTrace,
    classRows,
  ] =
    await Promise.all([
      prisma.subject.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.quarterLock.findMany({
        where: { year, quarter },
        select: { subjectId: true, closedAt: true, closedByName: true },
      }),
      prisma.lesson.groupBy({
        by: ["subjectId"],
        where: { year, quarter, ...LIVE_LESSON },
        _count: { _all: true },
      }),
      prisma.lesson.groupBy({
        by: ["subjectId"],
        where: { year, quarter, ...LIVE_LESSON, OR: [{ topic: null }, { topic: "" }] },
        _count: { _all: true },
      }),
      prisma.grade.findMany({
        where: { year, quarter, lesson: LIVE_LESSON },
        select: { subjectId: true, studentId: true, value: true, weight: true },
      }),
      prisma.grade.groupBy({
        by: ["subjectId", "studentId"],
        where: { year, lesson: LIVE_LESSON },
      }),
      prisma.absence.groupBy({
        by: ["subjectId", "studentId"],
        where: { year, lesson: LIVE_LESSON },
      }),
      // След безотметочных: уровень или печать — такой же след предмета, как
      // оценка. Без них предмет 1–2 класса показывал бы «учеников 0» и выглядел
      // пустым, хотя учитель весь год отмечал уровни.
      prisma.masteryMark.groupBy({
        by: ["subjectId", "studentId"],
        where: { year, lesson: LIVE_LESSON },
      }),
      prisma.lessonStamp.groupBy({
        by: ["subjectId", "studentId"],
        where: { year, lesson: LIVE_LESSON },
      }),
      // Классы учеников: безотметочные (1–2 классы) не считаются «без оценок» —
      // иначе целый первый класс блокировал бы пакетное закрытие как «н/а».
      prisma.user.findMany({
        where: { role: "STUDENT" },
        select: { id: true, className: true },
      }),
    ]);

  const gradelessIds = new Set(
    classRows
      .filter((student) => assessmentOf(student.className) === "gradeless")
      .map((student) => student.id),
  );
  const lockBySubject = new Map(locks.map((lock) => [lock.subjectId, lock]));
  const lessonsBySubject = new Map(lessonCounts.map((row) => [row.subjectId, row._count._all]));
  const topiclessBySubject = new Map(topiclessCounts.map((row) => [row.subjectId, row._count._all]));

  // След за год: множество учеников предмета — оценка, «Н», уровень или печать
  // в любом периоде года (тот же предикат, что в getQuarterReview).
  const tracedBySubject = new Map<string, Set<string>>();
  for (const row of [...gradeTrace, ...absenceTrace, ...masteryTrace, ...stampTrace]) {
    const set = tracedBySubject.get(row.subjectId) ?? new Set<string>();
    set.add(row.studentId);
    tracedBySubject.set(row.subjectId, set);
  }

  // Оценки четверти, разложенные по (предмет, ученик) — для средних.
  const quarterItems = new Map<string, { value: number; weight: number }[]>();
  for (const grade of grades) {
    const key = `${grade.subjectId}|${grade.studentId}`;
    const list = quarterItems.get(key) ?? [];
    list.push({ value: grade.value, weight: grade.weight });
    quarterItems.set(key, list);
  }

  return subjects.map((subject) => {
    const traced = tracedBySubject.get(subject.id) ?? new Set<string>();
    let unassessed = 0;
    let borderline = 0;
    for (const studentId of traced) {
      // Безотметочный ученик не бывает «н/а» — у него и не должно быть оценок.
      if (gradelessIds.has(studentId)) continue;
      const items = quarterItems.get(`${subject.id}|${studentId}`) ?? [];
      if (items.length === 0) {
        unassessed += 1;
        continue;
      }
      if (isBorderlineAverage(weightedAverage(items))) borderline += 1;
    }
    const lock = lockBySubject.get(subject.id);
    return {
      subjectId: subject.id,
      subjectName: subject.name,
      locked: lock ? { closedAt: lock.closedAt, closedByName: lock.closedByName } : null,
      lessonsTotal: lessonsBySubject.get(subject.id) ?? 0,
      lessonsWithoutTopic: topiclessBySubject.get(subject.id) ?? 0,
      students: traced.size,
      unassessed,
      borderline,
    };
  });
}

/* ── Долги и пересдачи ────────────────────────────────────────────────────── */

export type DebtRow = {
  id: string;
  origin: string;
  note: string | null;
  student: { id: string; name: string; className: string | null };
  lesson: { id: string; date: Date; topic: string | null; quarter: number };
  /** Собирается в памяти, нигде не хранится: open / closedByGrade / cleared. */
  status: "open" | "closedByGrade" | "cleared";
  /** «Висит N дней» — со дня УРОКА (полночь UTC), а не с расторопности учителя. */
  daysOpen: number;
  /** Значение закрывшей оценки (slot 0), если долг закрыт оценкой. */
  closedGrade: number | null;
  clearedAt: Date | null;
  /** Четверть долга закрыта замком — пересдача только уроком текущей четверти. */
  quarterLocked: boolean;
};

/** Долги предмета за год: открытые сверху по давности, затем история. */
export async function getSubjectDebts(subjectId: string, year: number): Promise<DebtRow[]> {
  const [debts, locks] = await Promise.all([
    prisma.debt.findMany({
      where: { subjectId, year, lesson: LIVE_LESSON },
      select: {
        id: true,
        origin: true,
        note: true,
        clearedAt: true,
        student: { select: { id: true, name: true, className: true } },
        lesson: { select: { id: true, date: true, topic: true, quarter: true } },
      },
    }),
    prisma.quarterLock.findMany({ where: { subjectId, year }, select: { quarter: true } }),
  ]);
  if (debts.length === 0) return [];

  // Один запрос пар (студент, урок) — статус «закрыт оценкой» ВЫВОДИТСЯ.
  const grades = await prisma.grade.findMany({
    where: {
      subjectId,
      year,
      lessonId: { in: [...new Set(debts.map((debt) => debt.lesson.id))] },
      slot: 0,
    },
    select: { studentId: true, lessonId: true, value: true },
  });
  const gradeByPair = new Map(
    grades.map((grade) => [`${grade.studentId}|${grade.lessonId}`, grade.value]),
  );
  const lockedQuarters = new Set(locks.map((lock) => lock.quarter));
  const todayUtc = todayUtcMidnight();

  const rows: DebtRow[] = debts.map((debt) => {
    const closedGrade = gradeByPair.get(`${debt.student.id}|${debt.lesson.id}`) ?? null;
    const status: DebtRow["status"] = debt.clearedAt
      ? "cleared"
      : closedGrade !== null
        ? "closedByGrade"
        : "open";
    return {
      id: debt.id,
      origin: debt.origin,
      note: debt.note,
      student: debt.student,
      lesson: debt.lesson,
      status,
      daysOpen: Math.max(0, diffUtcDays(todayUtc, debt.lesson.date)),
      closedGrade,
      clearedAt: debt.clearedAt,
      quarterLocked: lockedQuarters.has(debt.lesson.quarter),
    };
  });

  // Открытые сверху, самые давние — первыми; история — свежее сверху.
  return rows.sort((a, b) => {
    const openA = a.status === "open" ? 0 : 1;
    const openB = b.status === "open" ? 0 : 1;
    if (openA !== openB) return openA - openB;
    return openA === 0
      ? a.lesson.date.getTime() - b.lesson.date.getTime()
      : b.lesson.date.getTime() - a.lesson.date.getTime();
  });
}

export type StudentDebt = {
  id: string;
  subject: { id: string; name: string };
  lesson: { date: Date; topic: string | null };
  daysOpen: number;
  note: string | null;
};

/** Открытые долги ученика за год — полоса в дневнике. Доступ — requireOwnChild (404). */
export async function getStudentOpenDebts(
  studentId: string,
  viewer: SessionUser,
  year: number,
): Promise<StudentDebt[]> {
  await requireOwnChild(viewer, studentId);

  const debts = await prisma.debt.findMany({
    where: { studentId, year, clearedAt: null, lesson: LIVE_LESSON },
    orderBy: { lesson: { date: "asc" } },
    select: {
      id: true,
      note: true,
      lessonId: true,
      lesson: {
        select: { date: true, topic: true, subject: { select: { id: true, name: true } } },
      },
    },
  });
  if (debts.length === 0) return [];

  // Минус закрытые оценкой: статус выводится, а не хранится.
  const grades = await prisma.grade.findMany({
    where: { studentId, lessonId: { in: debts.map((debt) => debt.lessonId) } },
    select: { lessonId: true },
  });
  const gradedLessons = new Set(grades.map((grade) => grade.lessonId));
  const todayUtc = todayUtcMidnight();

  return debts
    .filter((debt) => !gradedLessons.has(debt.lessonId))
    .map((debt) => ({
      id: debt.id,
      subject: debt.lesson.subject,
      lesson: { date: debt.lesson.date, topic: debt.lesson.topic },
      daysOpen: Math.max(0, diffUtcDays(todayUtc, debt.lesson.date)),
      note: debt.note,
    }));
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

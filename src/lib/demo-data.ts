import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Демонстрационные данные журнала — общий источник для двух сценариев:
 *  1. локальный `npm run db:seed` (prisma/seed.ts);
 *  2. демо-стенд на Vercel, где база живёт в /tmp и создаётся на холодном старте
 *     (см. src/lib/demo-bootstrap.ts).
 *
 * Правила проекта соблюдаются и здесь: оценки — целые 1..10, четверти — 1..4,
 * пароли только в виде bcrypt-хеша.
 */

const BCRYPT_ROUNDS = 10;

/** Детерминированный ГПСЧ — данные одинаковы при каждом запуске. */
function mulberry32(seed: number) {
  let state = seed;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Учебный год, который идёт сейчас: с сентября по август. */
export function academicYearStart(date = new Date()): number {
  return date.getMonth() + 1 >= 9 ? date.getFullYear() : date.getFullYear() - 1;
}

/** Дата урока — полночь UTC, как во всём приложении. */
function lessonDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

const SUBJECTS = [
  {
    name: "Математика",
    topics: [
      "Квадратные уравнения",
      "Теорема Виета",
      "Неравенства",
      "Функции и графики",
      "Прогрессии",
      "Тригонометрия",
      "Контрольная работа",
      "Работа над ошибками",
    ],
  },
  {
    name: "Физика",
    topics: [
      "Механическое движение",
      "Законы Ньютона",
      "Импульс тела",
      "Работа и мощность",
      "Лабораторная работа",
      "Энергия",
      "Давление",
      "Повторение",
    ],
  },
  {
    name: "Литература",
    topics: [
      "А. С. Пушкин. Лирика",
      "«Евгений Онегин»",
      "М. Ю. Лермонтов",
      "«Герой нашего времени»",
      "Сочинение",
      "Н. В. Гоголь. «Ревизор»",
      "Устный анализ текста",
      "Итоговый урок",
    ],
  },
];

/** «Способности» ученика задают правдоподобный разброс оценок. */
const STUDENTS = [
  { name: "Смирнов Алексей Иванович", email: "student@school.com", password: "student123", ability: 8.2 },
  { name: "Иванова Мария Петровна", email: "ivanova.m.p@school.com", password: "student123", ability: 9.1 },
  { name: "Петров Дмитрий Сергеевич", email: "petrov.d.s@school.com", password: "student123", ability: 6.4 },
  { name: "Козлова Анна Андреевна", email: "kozlova.a.a@school.com", password: "student123", ability: 7.6 },
  { name: "Новиков Егор Максимович", email: "novikov.e.m@school.com", password: "student123", ability: 5.2 },
  { name: "Сидорова Полина Олеговна", email: "sidorova.p.o@school.com", password: "student123", ability: 9.6 },
];

const CLASS_NAME = "9-А";

/**
 * Идентификаторы демо-данных ФИКСИРОВАНЫ, а не сгенерированы cuid().
 *
 * Причина: на serverless-стенде у каждого экземпляра функции свой /tmp, то есть
 * своя копия базы. Со случайными id страницу отдавал бы один экземпляр, а запись
 * уходила в другой — с чужими id и ошибкой внешнего ключа. Фиксированные id
 * делают копии идентичными, поэтому ссылки со страницы всегда валидны.
 */
const id = (...parts: (string | number)[]) => `demo-${parts.join("-")}`;

export type SeedSummary = {
  students: number;
  subjects: number;
  lessons: number;
  grades: number;
  year: number;
};

/**
 * Заполняет пустую базу демо-данными: администратор, учитель, 6 учеников,
 * 3 предмета и оценки за 1 и 2 четверти. Существующие данные не трогает —
 * очистку выполняет вызывающая сторона (prisma/seed.ts).
 */
export async function seedDemoData(prisma: PrismaClient): Promise<SeedSummary> {
  const random = mulberry32(20251);
  const year = academicYearStart();

  const quarterDates: Record<number, Date[]> = {
    1: [
      lessonDate(year, 9, 2),
      lessonDate(year, 9, 9),
      lessonDate(year, 9, 16),
      lessonDate(year, 9, 23),
      lessonDate(year, 9, 30),
      lessonDate(year, 10, 7),
      lessonDate(year, 10, 14),
      lessonDate(year, 10, 21),
    ],
    2: [
      lessonDate(year, 11, 11),
      lessonDate(year, 11, 18),
      lessonDate(year, 11, 25),
      lessonDate(year, 12, 2),
      lessonDate(year, 12, 9),
      lessonDate(year, 12, 16),
      lessonDate(year, 12, 23),
    ],
  };

  /** Оценка вокруг «способностей», всегда целая и в диапазоне 1..10. */
  const rollGrade = (ability: number) => {
    const noise = (random() - 0.5) * 3.4;
    return Math.min(10, Math.max(1, Math.round(ability + noise)));
  };

  await prisma.user.create({
    data: {
      id: id("user", "admin"),
      name: "Администратор Системы",
      email: "admin@school.com",
      password: await bcrypt.hash("admin123", BCRYPT_ROUNDS),
      role: "ADMIN",
    },
  });

  const teacher = await prisma.user.create({
    data: {
      id: id("user", "teacher"),
      name: "Смирнова Ольга Петровна",
      email: "teacher@school.com",
      password: await bcrypt.hash("teacher123", BCRYPT_ROUNDS),
      role: "TEACHER",
    },
  });

  const students: { id: string; ability: number }[] = [];
  for (const [index, student] of STUDENTS.entries()) {
    const record = await prisma.user.create({
      data: {
        id: id("student", index + 1),
        name: student.name,
        email: student.email,
        password: await bcrypt.hash(student.password, BCRYPT_ROUNDS),
        role: "STUDENT",
        className: CLASS_NAME,
      },
      select: { id: true },
    });
    students.push({ id: record.id, ability: student.ability });
  }

  const gradeRows: {
    id: string;
    value: number;
    studentId: string;
    lessonId: string;
    subjectId: string;
    quarter: number;
    teacherId: string;
  }[] = [];
  let lessonCount = 0;

  for (const [subjectIndex, subjectData] of SUBJECTS.entries()) {
    const subject = await prisma.subject.create({
      data: { id: id("subject", subjectIndex + 1), name: subjectData.name },
      select: { id: true },
    });

    for (const quarter of [1, 2] as const) {
      for (const [index, date] of quarterDates[quarter]!.entries()) {
        const lesson = await prisma.lesson.create({
          data: {
            id: id("lesson", subjectIndex + 1, quarter, index + 1),
            subjectId: subject.id,
            quarter,
            date,
            topic:
              subjectData.topics[(quarter - 1) * 4 + index] ?? subjectData.topics[index] ?? null,
            teacherId: teacher.id,
          },
          select: { id: true },
        });
        lessonCount += 1;

        for (const [studentIndex, student] of students.entries()) {
          // ~80% посещаемости: часть клеток остаётся пустой, как в жизни.
          if (random() > 0.8) continue;
          gradeRows.push({
            id: id("grade", subjectIndex + 1, quarter, index + 1, studentIndex + 1),
            value: rollGrade(student.ability),
            studentId: student.id,
            lessonId: lesson.id,
            subjectId: subject.id,
            quarter,
            teacherId: teacher.id,
          });
        }
      }
    }
  }

  await prisma.grade.createMany({ data: gradeRows });

  return {
    students: students.length,
    subjects: SUBJECTS.length,
    lessons: lessonCount,
    grades: gradeRows.length,
    year,
  };
}

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Начальные данные электронного журнала.
 *
 * Запуск: npm run db:seed  (или npm run setup — generate + push + seed)
 * Скрипт идемпотентен: он полностью очищает таблицы и создаёт данные заново.
 *
 * Правила проекта: оценки — целые 1..10, четверти — 1..4.
 */

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 10;

/** Детерминированный ГПСЧ — при каждом запуске получаются одинаковые оценки. */
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

const random = mulberry32(20251);

/** Учебный год, который идёт сейчас: с сентября по август. */
function academicYearStart(date = new Date()): number {
  return date.getMonth() + 1 >= 9 ? date.getFullYear() : date.getFullYear() - 1;
}

const YEAR = academicYearStart();

/** Дата урока в полночь UTC — так же, как их создаёт приложение. */
function lessonDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Даты уроков: 1 четверть — сентябрь-октябрь, 2 четверть — ноябрь-декабрь. */
const QUARTER_DATES: Record<number, Date[]> = {
  1: [
    lessonDate(YEAR, 9, 2),
    lessonDate(YEAR, 9, 9),
    lessonDate(YEAR, 9, 16),
    lessonDate(YEAR, 9, 23),
    lessonDate(YEAR, 9, 30),
    lessonDate(YEAR, 10, 7),
    lessonDate(YEAR, 10, 14),
    lessonDate(YEAR, 10, 21),
  ],
  2: [
    lessonDate(YEAR, 11, 11),
    lessonDate(YEAR, 11, 18),
    lessonDate(YEAR, 11, 25),
    lessonDate(YEAR, 12, 2),
    lessonDate(YEAR, 12, 9),
    lessonDate(YEAR, 12, 16),
    lessonDate(YEAR, 12, 23),
  ],
};

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

/** «Сильные» ученики получают более высокие оценки — данные выглядят правдоподобно. */
const STUDENTS: { name: string; email: string; password: string; ability: number }[] = [
  {
    name: "Смирнов Алексей Иванович",
    email: "student@school.com",
    password: "student123",
    ability: 8.2,
  },
  {
    name: "Иванова Мария Петровна",
    email: "ivanova.m.p@school.com",
    password: "student123",
    ability: 9.1,
  },
  {
    name: "Петров Дмитрий Сергеевич",
    email: "petrov.d.s@school.com",
    password: "student123",
    ability: 6.4,
  },
  {
    name: "Козлова Анна Андреевна",
    email: "kozlova.a.a@school.com",
    password: "student123",
    ability: 7.6,
  },
  {
    name: "Новиков Егор Максимович",
    email: "novikov.e.m@school.com",
    password: "student123",
    ability: 5.2,
  },
  {
    name: "Сидорова Полина Олеговна",
    email: "sidorova.p.o@school.com",
    password: "student123",
    ability: 9.6,
  },
];

const CLASS_NAME = "9-А";

/** Оценка вокруг «способностей» ученика, всегда целая и в диапазоне 1..10. */
function rollGrade(ability: number): number {
  const noise = (random() - 0.5) * 3.4;
  return Math.min(10, Math.max(1, Math.round(ability + noise)));
}

async function main() {
  console.log("🧹 Очистка базы данных…");
  await prisma.grade.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.user.deleteMany();

  console.log("👤 Создание пользователей…");

  const admin = await prisma.user.create({
    data: {
      name: "Администратор Системы",
      email: "admin@school.com",
      password: await bcrypt.hash("admin123", BCRYPT_ROUNDS),
      role: "ADMIN",
    },
  });

  const teacher = await prisma.user.create({
    data: {
      name: "Смирнова Ольга Петровна",
      email: "teacher@school.com",
      password: await bcrypt.hash("teacher123", BCRYPT_ROUNDS),
      role: "TEACHER",
    },
  });

  const students = [];
  for (const student of STUDENTS) {
    students.push({
      ability: student.ability,
      record: await prisma.user.create({
        data: {
          name: student.name,
          email: student.email,
          password: await bcrypt.hash(student.password, BCRYPT_ROUNDS),
          role: "STUDENT",
          className: CLASS_NAME,
        },
      }),
    });
  }

  console.log("📚 Создание предметов, уроков и оценок…");

  let gradeCount = 0;
  let lessonCount = 0;

  for (const subjectData of SUBJECTS) {
    const subject = await prisma.subject.create({ data: { name: subjectData.name } });

    for (const quarter of [1, 2] as const) {
      const dates = QUARTER_DATES[quarter]!;

      for (const [index, date] of dates.entries()) {
        const lesson = await prisma.lesson.create({
          data: {
            subjectId: subject.id,
            quarter,
            date,
            topic: subjectData.topics[(quarter - 1) * 4 + index] ?? subjectData.topics[index] ?? null,
            teacherId: teacher.id,
          },
        });
        lessonCount += 1;

        for (const student of students) {
          // ~80% посещаемости: часть ячеек остаётся пустой, как в реальном журнале.
          if (random() > 0.8) continue;

          await prisma.grade.create({
            data: {
              value: rollGrade(student.ability),
              studentId: student.record.id,
              lessonId: lesson.id,
              subjectId: subject.id,
              quarter,
              teacherId: teacher.id,
            },
          });
          gradeCount += 1;
        }
      }
    }
  }

  console.log("\n✅ База данных заполнена:");
  console.table([
    { Роль: "Администратор", Логин: admin.email, Пароль: "admin123" },
    { Роль: "Учитель", Логин: teacher.email, Пароль: "teacher123" },
    { Роль: "Ученик", Логин: "student@school.com", Пароль: "student123" },
  ]);
  console.log(
    `   Учеников: ${students.length} · Предметов: ${SUBJECTS.length} · ` +
      `Уроков: ${lessonCount} · Оценок: ${gradeCount}`,
  );
  console.log(`   Учебный год: ${YEAR}/${YEAR + 1}, заполнены 1 и 2 четверти.\n`);
}

main()
  .catch((error) => {
    console.error("❌ Ошибка при заполнении базы:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

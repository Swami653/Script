import { PrismaClient } from "@prisma/client";

import { seedDemoData } from "../src/lib/demo-data";

/**
 * Начальные данные электронного журнала.
 *
 * Запуск: npm run db:seed  (или npm run setup — generate + push + seed)
 * Скрипт идемпотентен: полностью очищает таблицы и создаёт данные заново.
 *
 * Сами данные описаны в src/lib/demo-data.ts — тот же модуль использует
 * демо-стенд на Vercel, где база создаётся на лету.
 */

const prisma = new PrismaClient();

async function main() {
  console.log("🧹 Очистка базы данных…");
  await prisma.grade.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.user.deleteMany();

  console.log("📚 Создание пользователей, предметов, уроков и оценок…");
  const summary = await seedDemoData(prisma);

  console.log("\n✅ База данных заполнена:");
  console.table([
    { Роль: "Администратор", Логин: "admin@school.com", Пароль: "admin123" },
    { Роль: "Учитель", Логин: "teacher@school.com", Пароль: "teacher123" },
    { Роль: "Ученик", Логин: "student@school.com", Пароль: "student123" },
  ]);
  console.log(
    `   Учеников: ${summary.students} · Предметов: ${summary.subjects} · ` +
      `Уроков: ${summary.lessons} · Оценок: ${summary.grades}`,
  );
  console.log(
    `   Учебный год: ${summary.year}/${summary.year + 1}, заполнены 1 и 2 четверти.\n`,
  );
}

main()
  .catch((error) => {
    console.error("❌ Ошибка при заполнении базы:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

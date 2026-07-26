import { PrismaClient } from "@prisma/client";

import { seedDemoData } from "../src/lib/demo-data";

/**
 * Идемпотентный сид для развёртывания.
 *
 * Запускается в сборке на Vercel сразу после `prisma migrate deploy`.
 * Если в базе уже есть пользователи — ничего не делает, поэтому повторные
 * деплои не портят данные. Чтобы залить демо-данные заново, используйте
 * локальный `npm run db:seed` (он очищает таблицы).
 */

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.count();
  if (users > 0) {
    console.log(`↷ В базе уже ${users} пользователей — сид пропущен.`);
    return;
  }

  console.log("🌱 База пустая, заливаем начальные данные…");
  const summary = await seedDemoData(prisma);
  console.log(
    `✓ Создано: учеников ${summary.students}, предметов ${summary.subjects}, ` +
      `уроков ${summary.lessons}, оценок ${summary.grades} (${summary.year}/${summary.year + 1}).`,
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

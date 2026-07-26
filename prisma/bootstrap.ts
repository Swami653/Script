import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Подготовка базы к работе. Запускается в сборке Vercel после `prisma migrate deploy`.
 *
 * 1. RESET_DATA=true — ПОЛНАЯ очистка: пользователи, предметы, уроки, оценки.
 *    Переменную выставляют вручную на один деплой и сразу убирают.
 * 2. Если администраторов в базе нет, создаётся один — из ADMIN_USERNAME
 *    и ADMIN_PASSWORD. Пароль сохраняется как временный: он виден в панели
 *    администратора до первого входа, после чего стирается.
 *
 * Скрипт идемпотентен: при обычном деплое он ничего не меняет.
 */

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 10;

async function main() {
  if (process.env.RESET_DATA === "true") {
    console.log("⚠️  RESET_DATA=true — очищаем базу…");
    await prisma.grade.deleteMany();
    await prisma.lesson.deleteMany();
    await prisma.subject.deleteMany();
    await prisma.quarterPeriod.deleteMany();
    await prisma.user.deleteMany();
    await prisma.appSetting.deleteMany();
    // Журнал изменений не связан внешними ключами — чистим явно.
    await prisma.auditLog.deleteMany();
    console.log("   база очищена");
  }

  const admins = await prisma.user.count({ where: { role: "ADMIN" } });
  if (admins > 0) {
    console.log(`↷ Администраторов: ${admins} — создавать нового не нужно.`);
    return;
  }

  const username = (process.env.ADMIN_USERNAME ?? "admin").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "Администратор";

  if (!password || password.length < 8) {
    throw new Error(
      "В базе нет администратора, а ADMIN_PASSWORD не задан (минимум 8 символов). " +
        "Добавьте переменные ADMIN_USERNAME и ADMIN_PASSWORD и повторите деплой.",
    );
  }

  await prisma.user.create({
    data: {
      name,
      username,
      password: await bcrypt.hash(password, BCRYPT_ROUNDS),
      // Виден в панели до первого входа — чтобы пароль можно было прочитать и сменить.
      tempPassword: password,
      role: "ADMIN",
      mustChangePassword: true,
    },
  });

  console.log(`✓ Создан администратор с логином «${username}».`);
}

main()
  .catch((error) => {
    console.error("❌ Ошибка подготовки базы:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

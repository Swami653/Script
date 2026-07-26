import { Download } from "lucide-react";
import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Резервные копии" };

/**
 * Резервные копии — раздел администратора.
 *
 * Журнал — юридически значимый документ, а единственная копия данных за год —
 * сама база. Эта страница даёт администратору страховку, которую он делает сам:
 * скачивание полного JSON-архива (маршрут /api/admin/backup) и памятку,
 * как восстанавливаться.
 */
export default async function BackupPage() {
  // Резервные копии видит и скачивает ТОЛЬКО администратор.
  await requirePageRole(["ADMIN"]);

  // Счётчики запрошены прямо здесь, без функции в queries.ts: этим цифрам нужен
  // один-единственный экран, а queries.ts параллельно меняет другая задача.
  const [students, teachers, subjects, lessons, trashedLessons, grades] = await Promise.all([
    prisma.user.count({ where: { role: "STUDENT" } }),
    prisma.user.count({ where: { role: "TEACHER" } }),
    prisma.subject.count(),
    prisma.lesson.count(),
    prisma.lesson.count({ where: { deletedAt: { not: null } } }),
    prisma.grade.count(),
  ]);

  const figures = [
    { value: students, label: pluralize(students, "ученик", "ученика", "учеников") },
    { value: teachers, label: pluralize(teachers, "учитель", "учителя", "учителей") },
    { value: subjects, label: pluralize(subjects, "предмет", "предмета", "предметов") },
    { value: lessons, label: pluralize(lessons, "урок", "урока", "уроков") },
    { value: grades, label: pluralize(grades, "оценка", "оценки", "оценок") },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Резервные копии</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Журнал — официальный документ школы, и единственный экземпляр его данных —
          база. Архив ниже — ваша страховка: скачивайте его регулярно и обязательно
          перед миграциями и деплоями.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Скачать архив</CardTitle>
          <p className="text-sm text-muted-foreground">
            Полная выгрузка в JSON: пользователи, предметы, уроки (включая корзину),
            оценки, отметки «Н», границы четвертей, настройки и журнал изменений.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Что именно скачивается — чтобы администратор видел объём данных */}
          <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-muted-foreground">
            {figures.map((figure) => (
              <div key={figure.label} className="flex items-baseline gap-1.5">
                <dt className="sr-only">{figure.label}</dt>
                <dd className="text-base font-bold tabular-nums text-foreground">
                  {figure.value}
                </dd>
                <span aria-hidden>{figure.label}</span>
              </div>
            ))}
          </dl>
          {trashedLessons > 0 && (
            <p className="text-xs text-muted-foreground">
              Из них в корзине: {trashedLessons}{" "}
              {pluralize(trashedLessons, "урок", "урока", "уроков")} — в архив они
              тоже входят.
            </p>
          )}

          <a
            href="/api/admin/backup"
            download
            className="focus-ring inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Download className="h-4 w-4" aria-hidden />
            Скачать архив
          </a>

          <p className="text-xs text-muted-foreground">
            Паролей в архиве нет ни в каком виде — в базе хранятся только
            bcrypt-хеши, и наружу они не выгружаются. Каждое скачивание
            записывается в журнал изменений.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Как восстановить</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-3 pl-5 text-sm">
            <li>
              <span className="font-semibold">Основной способ — восстановление на
              момент времени (PITR) в Neon.</span>{" "}
              База работает на Neon, и там есть Restore: в консоли Neon выберите
              момент до ошибки (до неудачной миграции, до случайного удаления) —
              и база вернётся целиком, вместе с паролями. Архив для этого не нужен.
            </li>
            <li>
              <span className="font-semibold">Архив — страховка на случай, если база
              потеряна целиком.</span>{" "}
              Удалён проект Neon, истекло окно восстановления, нужен переезд —
              тогда данные загружаются в новую базу из этого JSON: в нём все таблицы
              и версия схемы (имя последней применённой миграции), чтобы восстановление
              шло на ту же структуру базы.
            </li>
            <li>
              <span className="font-semibold">Пароли придётся выдать заново.</span>{" "}
              В архиве их нет — это правило проекта. После восстановления из архива
              сбросьте пароли пользователям в панели администратора и раздайте
              временные, как при первом запуске.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Alert tone="warning" title="Осторожно с RESET_DATA=true">
        Переменная окружения <code className="font-mono text-xs">RESET_DATA=true</code>{" "}
        стирает <span className="font-semibold">все данные</span> при следующем деплое —
        безвозвратно. Ставьте её только осознанно, сразу после деплоя убирайте, а перед
        таким деплоем обязательно скачайте архив.
      </Alert>
    </div>
  );
}

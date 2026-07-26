import type { Metadata } from "next";

import { BulkImportStudents } from "@/app/(app)/admin/bulk-import";
import { CreateUserForm } from "@/app/(app)/admin/create-user-form";
import { UsersTable } from "@/app/(app)/admin/users-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageRole } from "@/lib/auth-guards";
import { academicYearLabel } from "@/lib/grades";
import { getAdminStats, getAllUsers } from "@/lib/queries";
import { asRole } from "@/lib/roles";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Панель администратора" };

export default async function AdminPage() {
  const admin = await requirePageRole(["ADMIN"]);
  const [stats, users] = await Promise.all([getAdminStats(), getAllUsers()]);

  const figures = [
    { value: stats.students, forms: ["ученик", "ученика", "учеников"] as const },
    { value: stats.teachers, forms: ["учитель", "учителя", "учителей"] as const },
    { value: stats.admins, forms: ["администратор", "администратора", "администраторов"] as const },
    { value: stats.subjects, forms: ["предмет", "предмета", "предметов"] as const },
    { value: stats.lessons, forms: ["урок", "урока", "уроков"] as const },
    { value: stats.grades, forms: ["оценка", "оценки", "оценок"] as const },
  ].map((item) => ({
    value: item.value,
    label: pluralize(item.value, item.forms[0], item.forms[1], item.forms[2]),
  }));

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {academicYearLabel()} учебный год
        </p>
        <h1 className="mt-1 text-[1.75rem] font-extrabold leading-tight tracking-tight">
          Панель администратора
        </h1>
        {/* Состав школы одной строкой: цифры справочные, а не шесть равных плиток */}
        <dl className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-muted-foreground">
          {figures.map((figure) => (
            <div key={figure.label} className="flex items-baseline gap-1.5">
              <dt className="sr-only">{figure.label}</dt>
              <dd className="text-base font-bold tabular-nums text-foreground">{figure.value}</dd>
              <span aria-hidden>{figure.label}</span>
            </div>
          ))}
        </dl>
      </header>

      <section className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Массовый импорт учеников</CardTitle>
            <p className="text-sm text-muted-foreground">
              Вставьте список ФИО — по одному на строку или через запятую. Логины и
              временные пароли будут созданы автоматически.
            </p>
          </CardHeader>
          <CardContent>
            <BulkImportStudents />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Создать пользователя</CardTitle>
            <p className="text-sm text-muted-foreground">
              Ручное создание учётной записи с выбором роли.
            </p>
          </CardHeader>
          <CardContent>
            <CreateUserForm />
          </CardContent>
        </Card>
      </section>

      <section>
        <UsersTable
          currentUserId={admin.id}
          users={users.map((user) => ({
            id: user.id,
            name: user.name,
            email: user.email,
            role: asRole(user.role),
            className: user.className,
            mustChangePassword: user.mustChangePassword,
            grades: user._count.grades,
          }))}
        />
      </section>
    </div>
  );
}

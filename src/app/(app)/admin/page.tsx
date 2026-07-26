import { BookOpen, GraduationCap, ListChecks, ShieldCheck, UserCog, Users } from "lucide-react";
import type { Metadata } from "next";

import { BulkImportStudents } from "@/app/(app)/admin/bulk-import";
import { CreateUserForm } from "@/app/(app)/admin/create-user-form";
import { UsersTable } from "@/app/(app)/admin/users-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageRole } from "@/lib/auth-guards";
import { getAdminStats, getAllUsers } from "@/lib/queries";
import { asRole } from "@/lib/roles";

export const metadata: Metadata = { title: "Панель администратора" };

export default async function AdminPage() {
  const admin = await requirePageRole(["ADMIN"]);
  const [stats, users] = await Promise.all([getAdminStats(), getAllUsers()]);

  const cards = [
    { icon: Users, label: "Учеников", value: stats.students },
    { icon: GraduationCap, label: "Учителей", value: stats.teachers },
    { icon: ShieldCheck, label: "Администраторов", value: stats.admins },
    { icon: BookOpen, label: "Предметов", value: stats.subjects },
    { icon: ListChecks, label: "Уроков", value: stats.lessons },
    { icon: UserCog, label: "Оценок", value: stats.grades },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Панель администратора</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Управление учётными записями, массовый импорт учеников и сброс паролей.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <card.icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="leading-tight">
                <span className="block text-xl font-bold tabular-nums">{card.value}</span>
                <span className="block text-[11px] text-muted-foreground">{card.label}</span>
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
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

import { GraduationCap, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { getCurrentUser } from "@/lib/auth-guards";
import { ROLE_HOME } from "@/lib/roles";

export const metadata: Metadata = { title: "Вход" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(ROLE_HOME[user.role]);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_50%_-10%,hsl(var(--primary)/0.16),transparent)]"
      />

      <div className="relative grid w-full max-w-4xl gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <section className="hidden lg:block">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Проверка прав выполняется на сервере
          </div>
          <h1 className="text-4xl font-bold tracking-tight">
            Электронный журнал
            <span className="block text-primary">вашей школы</span>
          </h1>
          <p className="mt-4 max-w-md text-muted-foreground">
            10-балльная система оценок, четыре учебные четверти, автоматический расчёт
            средних баллов и годовых оценок.
          </p>

          <dl className="mt-8 grid grid-cols-3 gap-4">
            {[
              { term: "10", desc: "балльная система" },
              { term: "4", desc: "учебные четверти" },
              { term: "3", desc: "роли пользователей" },
            ].map((item) => (
              <div key={item.desc} className="rounded-xl border border-border bg-card p-4">
                <dt className="text-2xl font-bold text-primary">{item.term}</dt>
                <dd className="mt-1 text-xs text-muted-foreground">{item.desc}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6 shadow-lg sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <GraduationCap className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-semibold leading-tight">Вход в журнал</h2>
              <p className="text-sm text-muted-foreground">Введите выданные вам данные</p>
            </div>
          </div>

          <LoginForm />

          <div className="mt-6 rounded-lg border border-dashed border-border bg-muted/40 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Демонстрационные аккаунты
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">Администратор:</span>{" "}
                admin@school.com / admin123
              </li>
              <li>
                <span className="font-medium text-foreground">Учитель:</span>{" "}
                teacher@school.com / teacher123
              </li>
              <li>
                <span className="font-medium text-foreground">Ученик:</span>{" "}
                student@school.com / student123
              </li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}

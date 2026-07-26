import Link from "next/link";

import { LogoutButton, NavLinks, ThemeToggle } from "@/components/app-nav";
import { RoleBadge } from "@/components/ui/badge";
import { requirePageUser } from "@/lib/auth-guards";
import { formatYear, getActiveYear } from "@/lib/school-year";
import { ROLE_HOME, type Role } from "@/lib/roles";
import { initials } from "@/lib/utils";

const NAV_BY_ROLE: Record<Role, { href: string; label: string; exact?: boolean }[]> = {
  ADMIN: [
    { href: "/admin", label: "Панель управления", exact: true },
    { href: "/journal", label: "Журнал", exact: true },
    { href: "/journal/subjects", label: "Предметы" },
    { href: "/journal/trash", label: "Корзина" },
    { href: "/journal/students", label: "Ученики" },
    { href: "/journal/debts", label: "Долги" },
    { href: "/journal/year", label: "Учебный год" },
    { href: "/admin/audit", label: "Изменения" },
  ],
  TEACHER: [
    { href: "/journal", label: "Журнал", exact: true },
    { href: "/journal/subjects", label: "Предметы" },
    { href: "/journal/trash", label: "Корзина" },
    { href: "/journal/students", label: "Ученики" },
    { href: "/journal/debts", label: "Долги" },
    { href: "/journal/year", label: "Учебный год" },
  ],
  STUDENT: [{ href: "/student", label: "Мой дневник", exact: true }],
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Первый серверный рубеж: без сессии дальше не пускаем.
  const user = await requirePageUser();
  const navItems = NAV_BY_ROLE[user.role];
  const year = await getActiveYear();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-rule-strong bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/75">
        <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-4 px-4 sm:px-6">
          <Link
            href={ROLE_HOME[user.role]}
            className="focus-ring flex items-center gap-2 rounded-md"
          >
            {/* Знак — корешок журнала с закладкой: тот же приём, что и в сетке */}
            <span
              aria-hidden
              className="flex h-9 w-8 flex-col justify-between rounded-sm bg-primary px-1 py-1 shadow-[inset_3px_0_0_hsl(var(--primary-foreground)/0.35)]"
            >
              <span className="h-[2px] w-full rounded-full bg-primary-foreground/70" />
              <span className="h-[2px] w-full rounded-full bg-primary-foreground/70" />
              <span className="h-[2px] w-3/5 rounded-full bg-primary-foreground/70" />
            </span>
            <span className="hidden text-sm font-bold leading-tight tracking-tight sm:block">
              Классный
              <span className="block font-medium text-muted-foreground">журнал</span>
            </span>
          </Link>

          <NavLinks items={navItems} className="hidden md:flex" />

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/profile"
              className="focus-ring flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent"
              title="Профиль и смена пароля"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {initials(user.name)}
              </span>
              <span className="hidden text-left leading-tight lg:block">
                <span className="block max-w-[14rem] truncate text-sm font-medium">
                  {user.name}
                </span>
                <RoleBadge role={user.role} className="mt-0.5 px-1.5 py-0 text-[10px]" />
              </span>
            </Link>
            <LogoutButton />
          </div>
        </div>

        <div className="border-t border-rule px-4 py-2 md:hidden">
          <NavLinks items={navItems} className="overflow-x-auto" />
        </div>
      </header>

      {user.mustChangePassword && (
        <div className="border-b border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-sm text-amber-900 dark:text-amber-100 sm:px-6">
            <span className="font-medium">Вы вошли с временным паролем.</span>
            <span>Смените его, чтобы никто другой не мог войти под вами.</span>
            <Link href="/profile" className="ml-auto font-semibold underline">
              Сменить пароль
            </Link>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">{children}</main>

      <footer className="border-t border-rule py-4 text-center text-xs text-muted-foreground">
        {formatYear(year)} учебный год
      </footer>
    </div>
  );
}

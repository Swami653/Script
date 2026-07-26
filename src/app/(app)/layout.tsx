import { GraduationCap } from "lucide-react";
import Link from "next/link";

import { LogoutButton, NavLinks, ThemeToggle } from "@/components/app-nav";
import { RoleBadge } from "@/components/ui/badge";
import { requirePageUser } from "@/lib/auth-guards";
import { ROLE_HOME, type Role } from "@/lib/roles";
import { initials } from "@/lib/utils";

const NAV_BY_ROLE: Record<Role, { href: string; label: string; exact?: boolean }[]> = {
  ADMIN: [
    { href: "/admin", label: "Панель управления", exact: true },
    { href: "/journal", label: "Журнал", exact: true },
    { href: "/journal/subjects", label: "Предметы" },
    { href: "/journal/students", label: "Ученики" },
  ],
  TEACHER: [
    { href: "/journal", label: "Журнал", exact: true },
    { href: "/journal/subjects", label: "Предметы" },
    { href: "/journal/students", label: "Ученики" },
  ],
  STUDENT: [{ href: "/student", label: "Мой дневник", exact: true }],
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Первый серверный рубеж: без сессии дальше не пускаем.
  const user = await requirePageUser();
  const navItems = NAV_BY_ROLE[user.role];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-4 px-4 sm:px-6">
          <Link
            href={ROLE_HOME[user.role]}
            className="focus-ring flex items-center gap-2 rounded-md"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCap className="h-5 w-5" aria-hidden />
            </span>
            <span className="hidden text-sm font-semibold leading-tight sm:block">
              Электронный
              <span className="block text-muted-foreground">журнал</span>
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

        <div className="border-t border-border px-4 py-2 md:hidden">
          <NavLinks items={navItems} className="overflow-x-auto" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">{children}</main>

      <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground">
        Электронный журнал · 10-балльная система · 4 четверти
      </footer>
    </div>
  );
}

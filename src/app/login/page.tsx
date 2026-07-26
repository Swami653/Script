import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { getCurrentUser } from "@/lib/auth-guards";
import { academicYearLabel, gradeColorClasses } from "@/lib/grades";
import { ROLE_HOME } from "@/lib/roles";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Вход" };

/**
 * Разворот журнала на экране входа — не иллюстрация, а то, чем продукт является.
 * Данные показательные и подписаны как образец: настоящих оценок здесь быть не может,
 * пользователь ещё не вошёл.
 */
const SAMPLE_ROWS: { name: string; grades: (number | null)[] }[] = [
  { name: "Иванова М. П.", grades: [10, 9, null, 10, 9] },
  { name: "Козлова А. А.", grades: [8, 8, 9, null, 8] },
  { name: "Новиков Е. М.", grades: [6, null, 5, 7, 6] },
  { name: "Петров Д. С.", grades: [7, 6, 8, 7, null] },
  { name: "Сидорова П. О.", grades: [9, 10, 10, 9, 10] },
];

const SAMPLE_DATES = ["02.09", "09.09", "16.09", "23.09", "30.09"];

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(ROLE_HOME[user.role]);

  return (
    <main className="flex min-h-screen flex-col lg:flex-row">
      {/* Левый разворот — «бумага» */}
      <section className="ledger-paper relative hidden flex-1 border-r border-rule-strong px-10 py-12 lg:flex lg:flex-col lg:justify-center xl:px-16">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {academicYearLabel()} учебный год
          </p>
          <h1 className="mt-3 text-[3.25rem] font-extrabold leading-[0.95] tracking-[-0.03em]">
            Классный
            <br />
            журнал,
            <br />
            <span className="text-primary">который считает</span>
            <br />
            сам.
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            Десятибалльные оценки, четыре четверти, средний балл до сотых и годовая
            оценка — пересчитываются в тот момент, когда вы ставите цифру в клетку.
          </p>

          <figure className="mt-9">
            <div className="overflow-hidden rounded-lg border border-rule-strong bg-card shadow-sm">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="border-b-2 border-r border-rule-strong px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      Ученик
                    </th>
                    {SAMPLE_DATES.map((date) => (
                      <th
                        key={date}
                        scope="col"
                        className="w-12 border-b-2 border-rule-strong px-0 py-1.5 text-center text-[12px] font-medium tabular-nums"
                      >
                        {date}
                      </th>
                    ))}
                    <th
                      scope="col"
                      className="w-16 border-b-2 border-l border-rule-strong bg-secondary/40 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      Средний
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_ROWS.map((row) => {
                    const filled = row.grades.filter((g): g is number => g !== null);
                    const average = filled.reduce((a, b) => a + b, 0) / filled.length;
                    return (
                      <tr key={row.name}>
                        <th
                          scope="row"
                          className="border-b border-r border-rule px-3 py-0 text-left font-normal shadow-[inset_3px_0_0_hsl(var(--spine))]"
                        >
                          <span className="flex h-8 items-center">{row.name}</span>
                        </th>
                        {row.grades.map((grade, index) => (
                          <td
                            key={`${row.name}-${index}`}
                            className="border-b border-rule px-0 py-0.5 text-center"
                          >
                            <span
                              className={cn(
                                "mx-auto flex h-7 w-9 items-center justify-center rounded text-[15px] font-semibold tabular-nums",
                                grade === null ? "text-transparent" : gradeColorClasses(grade),
                              )}
                            >
                              {grade ?? "·"}
                            </span>
                          </td>
                        ))}
                        <td className="border-b border-l border-rule-strong bg-secondary/30 px-2 text-center text-[15px] font-semibold tabular-nums">
                          {average.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <figcaption className="mt-2 text-xs text-muted-foreground">
              Образец разворота: 1 четверть, средний балл пересчитан автоматически.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* Правая страница — вход */}
      <section className="flex flex-1 items-center justify-center bg-background px-5 py-10 lg:max-w-[30rem]">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold tracking-tight lg:hidden">Электронный журнал</h2>
          <p className="mb-8 mt-1 text-sm text-muted-foreground lg:hidden">
            10-балльная система · 4 четверти
          </p>

          <h2 className="hidden text-xl font-bold tracking-tight lg:block">Вход в журнал</h2>
          <p className="mb-7 mt-1 hidden text-sm text-muted-foreground lg:block">
            Логин и пароль выдаёт администратор.
          </p>

          <LoginForm />

          <p className="mt-6 border-t border-rule pt-5 text-[13px] leading-relaxed text-muted-foreground">
            Логин и пароль выдаёт администратор. Если пароль забыт — обратитесь
            к нему: восстановить старый пароль нельзя, но можно выдать новый.
          </p>
        </div>
      </section>
    </main>
  );
}

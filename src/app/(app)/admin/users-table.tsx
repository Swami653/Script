"use client";

import { Eye, EyeOff, KeyRound, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Flash, useFlash } from "@/components/flash";
import { Alert } from "@/components/ui/alert";
import { Badge, RoleBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { deleteUserAction, resetPasswordAction, updateUserRoleAction } from "@/lib/actions/users";
import { isGradelessClassName } from "@/lib/gradeless";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/roles";
import { cn } from "@/lib/utils";

type UserRow = {
  id: string;
  name: string;
  username: string;
  role: Role;
  className: string | null;
  /** Временный пароль виден, пока пользователь ни разу не входил. */
  tempPassword: string | null;
  hasLoggedIn: boolean;
  grades: number;
};

export function UsersTable({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const { flash, show, clear } = useFlash();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter && user.role !== roleFilter) return false;
      if (!needle) return true;
      return (
        user.name.toLowerCase().includes(needle) ||
        user.username.toLowerCase().includes(needle) ||
        (user.className ?? "").toLowerCase().includes(needle)
      );
    });
  }, [query, roleFilter, users]);

  const withTempPassword = users.filter((user) => user.tempPassword).length;

  function handleDelete(user: UserRow) {
    const warning =
      user.grades > 0
        ? `Удалить ${user.name}? Вместе с учётной записью удалится ${user.grades} оценок.`
        : `Удалить учётную запись ${user.name}?`;
    if (!window.confirm(warning)) return;

    startTransition(async () => {
      const result = await deleteUserAction({ userId: user.id });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      show("success", result.message ?? "Пользователь удалён");
      router.refresh();
    });
  }

  function handleResetPassword(user: UserRow) {
    if (
      !window.confirm(
        `Сбросить пароль для ${user.name}? Старый перестанет работать, а новый будет виден в таблице до первого входа.`,
      )
    )
      return;

    startTransition(async () => {
      const result = await resetPasswordAction({ userId: user.id });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      setRevealed((prev) => ({ ...prev, [user.id]: true }));
      show("success", `Новый пароль для ${user.username}: ${result.data.password}`);
      router.refresh();
    });
  }

  function handleRoleChange(user: UserRow, role: string) {
    startTransition(async () => {
      const result = await updateUserRoleAction({ userId: user.id, role });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      show("success", result.message ?? "Роль обновлена");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Пользователи ({users.length})</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск…"
                className="w-52 pl-9"
                aria-label="Поиск пользователя"
              />
            </div>
            <Select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              className="w-44"
              aria-label="Фильтр по роли"
            >
              <option value="">Все роли</option>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <Alert tone="info" title="Как устроен показ паролей">
          Пароль хранится в виде необратимого bcrypt-хеша, поэтому «подсмотреть» уже
          используемый пароль невозможно. Выданный вами временный пароль виден в столбце
          «Пароль» до первого входа пользователя — сейчас таких записей {withTempPassword}.
          После входа он стирается; если пароль забыт, нажмите «Сбросить пароль».
        </Alert>
      </CardHeader>

      <CardContent className="p-0">
        <div className="journal-scroll overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Пользователь</th>
                <th className="px-3 py-2.5 text-left font-semibold">Логин</th>
                <th className="px-3 py-2.5 text-left font-semibold">Пароль</th>
                <th className="px-3 py-2.5 text-left font-semibold">Роль</th>
                <th className="px-3 py-2.5 text-left font-semibold">Класс</th>
                <th className="px-3 py-2.5 text-center font-semibold">Оценок</th>
                <th className="px-3 py-2.5 text-right font-semibold">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {filtered.map((user) => (
                <tr key={user.id} className="group/row hover:bg-primary/[0.04]">
                  <td className="px-4 py-2">
                    <p className="truncate font-medium">
                      {user.name}
                      {user.id === currentUserId && (
                        <span className="ml-2 text-xs text-muted-foreground">(это вы)</span>
                      )}
                    </p>
                    {user.hasLoggedIn ? (
                      <p className="text-xs text-muted-foreground">уже входил в систему</p>
                    ) : (
                      <p className="text-xs text-amber-700 dark:text-amber-300">ещё не входил</p>
                    )}
                  </td>

                  <td className="px-3 py-2 font-mono text-xs">{user.username}</td>

                  <td className="px-3 py-2">
                    {user.tempPassword ? (
                      <button
                        type="button"
                        onClick={() =>
                          setRevealed((prev) => ({ ...prev, [user.id]: !prev[user.id] }))
                        }
                        className={cn(
                          "focus-ring flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-xs",
                          revealed[user.id]
                            ? "bg-amber-100 font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-100"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                        title={
                          revealed[user.id] ? "Скрыть пароль" : "Показать временный пароль"
                        }
                      >
                        {revealed[user.id] ? (
                          <>
                            <EyeOff className="h-3.5 w-3.5" aria-hidden />
                            {user.tempPassword}
                          </>
                        ) : (
                          <>
                            <Eye className="h-3.5 w-3.5" aria-hidden />
                            показать
                          </>
                        )}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground" title="Пароль известен только владельцу">
                        —
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-2">
                    {user.id === currentUserId ? (
                      <RoleBadge role={user.role} />
                    ) : (
                      <Select
                        value={user.role}
                        onChange={(event) => handleRoleChange(user, event.target.value)}
                        className="h-8 w-36 text-xs"
                        aria-label={`Роль пользователя ${user.name}`}
                        disabled={pending}
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </td>

                  <td className="px-3 py-2 text-muted-foreground">
                    {user.className ?? "—"}
                    {/* Бейдж — по тому же предикату, что и запрет оценок на
                        сервере: ошибка парсинга названия класса видна сразу */}
                    {user.role === "STUDENT" && isGradelessClassName(user.className) && (
                      <span
                        className="ml-1.5 inline-block rounded border border-primary/40 px-1 text-[10px] font-semibold uppercase tracking-wide text-primary"
                        title="1–2 класс: безотметочное обучение — печати и уровни вместо оценок"
                      >
                        безотметочный
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">{user.grades}</td>

                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Сбросить пароль"
                        onClick={() => handleResetPassword(user)}
                        disabled={pending}
                      >
                        <KeyRound className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Удалить пользователя"
                        className="text-muted-foreground opacity-60 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover/row:opacity-100"
                        onClick={() => handleDelete(user)}
                        disabled={pending || user.id === currentUserId}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Никого не найдено.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Flash message={flash} onClose={clear} />
    </Card>
  );
}

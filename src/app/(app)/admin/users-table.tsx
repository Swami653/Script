"use client";

import { KeyRound, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Flash, useFlash } from "@/components/flash";
import { Alert } from "@/components/ui/alert";
import { Badge, RoleBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { deleteUserAction, resetPasswordAction, updateUserRoleAction } from "@/lib/actions/users";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/roles";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  className: string | null;
  mustChangePassword: boolean;
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
  const [issuedPassword, setIssuedPassword] = useState<{ email: string; password: string } | null>(
    null,
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter && user.role !== roleFilter) return false;
      if (!needle) return true;
      return (
        user.name.toLowerCase().includes(needle) ||
        user.email.toLowerCase().includes(needle) ||
        (user.className ?? "").toLowerCase().includes(needle)
      );
    });
  }, [query, roleFilter, users]);

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
    if (!window.confirm(`Сбросить пароль для ${user.name}? Старый пароль перестанет работать.`))
      return;

    startTransition(async () => {
      const result = await resetPasswordAction({ userId: user.id });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      setIssuedPassword(result.data);
      show("success", "Пароль сброшен");
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

        {issuedPassword && (
          <Alert tone="warning" title="Новый пароль (показывается один раз)">
            <p className="font-mono text-sm">
              {issuedPassword.email} — <strong>{issuedPassword.password}</strong>
            </p>
            <button
              type="button"
              className="mt-1 text-xs underline"
              onClick={() => setIssuedPassword(null)}
            >
              Скрыть
            </button>
          </Alert>
        )}
      </CardHeader>

      <CardContent className="p-0">
        <div className="journal-scroll overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Пользователь</th>
                <th className="px-3 py-2.5 text-left font-semibold">Роль</th>
                <th className="px-3 py-2.5 text-left font-semibold">Класс</th>
                <th className="px-3 py-2.5 text-center font-semibold">Оценок</th>
                <th className="px-3 py-2.5 text-right font-semibold">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((user) => (
                <tr key={user.id} className="group/row hover:bg-primary/[0.04]">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {user.name}
                          {user.id === currentUserId && (
                            <span className="ml-2 text-xs text-muted-foreground">(это вы)</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                      </div>
                      {user.mustChangePassword && (
                        <Badge tone="warning" title="Пароль выдан автоматически">
                          временный пароль
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {user.id === currentUserId ? (
                      <RoleBadge role={user.role} />
                    ) : (
                      <Select
                        value={user.role}
                        onChange={(event) => handleRoleChange(user, event.target.value)}
                        className="h-8 w-40 text-xs"
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
                  <td className="px-3 py-2 text-muted-foreground">{user.className ?? "—"}</td>
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
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
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

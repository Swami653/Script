"use client";

import { Eye, EyeOff, Link2, Printer, Search, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Flash, useFlash } from "@/components/flash";
import { TelegramColumn } from "@/components/telegram-column";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import {
  createParentAction,
  linkParentAction,
  unlinkParentAction,
} from "@/lib/actions/family";
import type { ParentRow } from "@/lib/queries";
import { cn, pluralize } from "@/lib/utils";

type StudentOption = { id: string; name: string; className: string | null };

/** Данные для печатной памятки. Код Telegram добавляется отдельным действием. */
export type MemoData = {
  parentName: string;
  username: string;
  password: string;
  telegramCode?: string | null;
  deepLink?: string | null;
};

/**
 * Печать памятки родителю: адрес сайта, логин, временный пароль (и код
 * Telegram, если выдан). Данные берутся из ответов действий на клиенте —
 * повторно из БД пароль и код не достать (там хеши). Печатается
 * предупреждение «не оставляйте листок в дневнике ребёнка».
 */
export function printMemo(memo: MemoData) {
  const site = window.location.origin;
  const win = window.open("", "_blank", "width=640,height=760");
  if (!win) return;
  const esc = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  win.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>Памятка родителю</title>
<style>
  body { font-family: system-ui, sans-serif; color: #1B2432; margin: 40px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { margin: 6px 0; font-size: 14px; }
  .box { border: 2px solid #2C4A7C; border-radius: 8px; padding: 14px 16px; margin: 14px 0; }
  .mono { font-family: ui-monospace, monospace; font-size: 16px; font-weight: 700; }
  .warn { border: 1px dashed #A8321E; color: #A8321E; border-radius: 8px; padding: 10px 12px; font-size: 13px; }
  .muted { color: #666; font-size: 12px; }
</style></head><body>
<h1>Электронный журнал — доступ для родителя</h1>
<p>${esc(memo.parentName)}</p>
<div class="box">
  <p>Сайт: <span class="mono">${esc(site)}</span></p>
  <p>Логин: <span class="mono">${esc(memo.username)}</span></p>
  <p>Временный пароль: <span class="mono">${esc(memo.password)}</span></p>
  <p class="muted">При первом входе система попросит придумать свой пароль.</p>
</div>
${
  memo.telegramCode
    ? `<div class="box">
  <p>Уведомления в Telegram — отправьте боту код:</p>
  <p class="mono">${esc(memo.telegramCode)}</p>
  ${memo.deepLink ? `<p>Или откройте ссылку: <span class="mono">${esc(memo.deepLink)}</span></p>` : ""}
  <p class="muted">Код одноразовый и действует 72 часа.</p>
</div>`
    : ""
}
<p class="warn">Не оставляйте этот листок в дневнике или рюкзаке ребёнка: логин и пароль
дают доступ к оценкам всей семьи. Передавайте лично в руки.</p>
</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

export function ParentManager({
  parents,
  students,
}: {
  parents: ParentRow[];
  students: StudentOption[];
}) {
  const router = useRouter();
  const { flash, show, clear } = useFlash();
  const [pending, startTransition] = useTransition();

  /* ── Создание родителя ── */
  const [name, setName] = useState("");
  const [childFilter, setChildFilter] = useState("");
  const [selectedChildren, setSelectedChildren] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  /** Пароль, показанный один раз после создания, — для печати памятки. */
  const [freshPasswords, setFreshPasswords] = useState<Record<string, string>>({});

  const filteredStudents = useMemo(() => {
    const needle = childFilter.trim().toLowerCase();
    if (!needle) return students;
    return students.filter(
      (student) =>
        student.name.toLowerCase().includes(needle) ||
        (student.className ?? "").toLowerCase().includes(needle),
    );
  }, [childFilter, students]);

  function toggleChild(id: string) {
    setSelectedChildren((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleCreate() {
    startTransition(async () => {
      const result = await createParentAction({
        name,
        studentIds: [...selectedChildren],
      });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      setFreshPasswords((prev) => ({ ...prev, [result.data.id]: result.data.password }));
      setRevealed((prev) => ({ ...prev, [result.data.id]: true }));
      setName("");
      setSelectedChildren(new Set());
      show(
        "success",
        `${result.message}. Логин: ${result.data.username}, пароль: ${result.data.password}`,
      );
      router.refresh();
    });
  }

  function handleLink(parent: ParentRow, studentId: string) {
    if (!studentId) return;
    startTransition(async () => {
      const result = await linkParentAction({ parentId: parent.id, studentId });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      show("success", result.message ?? "Родитель привязан");
      router.refresh();
    });
  }

  function handleUnlink(parent: ParentRow, child: StudentOption) {
    if (
      !window.confirm(
        `Отвязать «${child.name}» от родителя «${parent.name}»? Родитель сразу потеряет доступ к дневнику и уведомления.`,
      )
    )
      return;
    startTransition(async () => {
      const result = await unlinkParentAction({ parentId: parent.id, studentId: child.id });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      show("success", result.message ?? "Родитель отвязан");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Создать родителя</CardTitle>
          <p className="text-sm text-muted-foreground">
            Логин и временный пароль создаются автоматически (как у учеников). Пароль
            показывается один раз и виден в таблице до первого входа.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="ФИО родителя, например: Иванова Анна Петровна"
            aria-label="ФИО родителя"
            maxLength={100}
          />

          <div>
            <div className="relative mb-2">
              <Search
                className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={childFilter}
                onChange={(event) => setChildFilter(event.target.value)}
                placeholder="Найти ребёнка…"
                className="pl-9"
                aria-label="Поиск ученика для привязки"
              />
            </div>
            <ul className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-rule p-1.5">
              {filteredStudents.map((student) => (
                <li key={student.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
                    <input
                      type="checkbox"
                      checked={selectedChildren.has(student.id)}
                      onChange={() => toggleChild(student.id)}
                      className="h-4 w-4 accent-[hsl(var(--primary))]"
                    />
                    <span className="min-w-0 flex-1 truncate">{student.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {student.className ?? "—"}
                    </span>
                  </label>
                </li>
              ))}
              {filteredStudents.length === 0 && (
                <li className="px-2 py-3 text-center text-xs text-muted-foreground">
                  Никого не найдено
                </li>
              )}
            </ul>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleCreate}
              disabled={pending || name.trim().length < 2}
              loading={pending}
            >
              <UserPlus className="h-4 w-4" aria-hidden />
              Создать
            </Button>
            {selectedChildren.size > 0 && (
              <span className="text-xs text-muted-foreground">
                будет привязан к {selectedChildren.size}{" "}
                {pluralize(selectedChildren.size, "ребёнку", "детям", "детям")}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Родители ({parents.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="journal-scroll overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Родитель</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Пароль</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Дети</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Telegram</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Памятка</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {parents.map((parent) => {
                  const memoPassword = parent.tempPassword ?? freshPasswords[parent.id] ?? null;
                  const linkedIds = new Set(parent.children.map((child) => child.id));
                  const linkable = students.filter((student) => !linkedIds.has(student.id));
                  return (
                    <tr key={parent.id} className="align-top hover:bg-primary/[0.04]">
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{parent.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {parent.username}
                        </p>
                        <p
                          className={cn(
                            "text-xs",
                            parent.lastLoginAt
                              ? "text-muted-foreground"
                              : "text-amber-700 dark:text-amber-300",
                          )}
                        >
                          {parent.lastLoginAt ? "уже входил в систему" : "ещё не входил"}
                        </p>
                      </td>

                      <td className="px-3 py-2.5">
                        {parent.tempPassword ? (
                          <button
                            type="button"
                            onClick={() =>
                              setRevealed((prev) => ({ ...prev, [parent.id]: !prev[parent.id] }))
                            }
                            className={cn(
                              "focus-ring flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-xs",
                              revealed[parent.id]
                                ? "bg-amber-100 font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-100"
                                : "text-muted-foreground hover:bg-accent",
                            )}
                            title={revealed[parent.id] ? "Скрыть пароль" : "Показать временный пароль"}
                          >
                            {revealed[parent.id] ? (
                              <>
                                <EyeOff className="h-3.5 w-3.5" aria-hidden />
                                {parent.tempPassword}
                              </>
                            ) : (
                              <>
                                <Eye className="h-3.5 w-3.5" aria-hidden />
                                показать
                              </>
                            )}
                          </button>
                        ) : (
                          <span
                            className="text-xs text-muted-foreground"
                            title="Пароль известен только владельцу"
                          >
                            —
                          </span>
                        )}
                      </td>

                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {parent.children.map((child) => (
                            <Badge key={child.id} tone="muted" className="gap-1 pr-1">
                              {child.name}
                              {child.className ? ` (${child.className})` : ""}
                              <button
                                type="button"
                                onClick={() => handleUnlink(parent, child)}
                                disabled={pending}
                                className="focus-ring rounded-full p-0.5 opacity-60 hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
                                title={`Отвязать ${child.name}`}
                                aria-label={`Отвязать ${child.name}`}
                              >
                                <X className="h-3 w-3" aria-hidden />
                              </button>
                            </Badge>
                          ))}
                          {parent.children.length === 0 && (
                            <span className="text-xs text-muted-foreground">
                              нет привязанных детей
                            </span>
                          )}
                        </div>
                        {linkable.length > 0 && (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            <Select
                              value=""
                              onChange={(event) => handleLink(parent, event.target.value)}
                              disabled={pending}
                              className="h-8 w-56 text-xs"
                              aria-label={`Привязать ребёнка к ${parent.name}`}
                            >
                              <option value="">Привязать ребёнка…</option>
                              {linkable.map((student) => (
                                <option key={student.id} value={student.id}>
                                  {student.name}
                                  {student.className ? ` (${student.className})` : ""}
                                </option>
                              ))}
                            </Select>
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2.5">
                        <TelegramColumn parent={parent} memoPassword={memoPassword} />
                      </td>

                      <td className="px-3 py-2.5 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!memoPassword}
                          title={
                            memoPassword
                              ? "Напечатать памятку с логином и паролем"
                              : "Пароль уже неизвестен (родитель входил) — сначала сбросьте его в таблице пользователей"
                          }
                          onClick={() =>
                            memoPassword &&
                            printMemo({
                              parentName: parent.name,
                              username: parent.username,
                              password: memoPassword,
                            })
                          }
                        >
                          <Printer className="h-3.5 w-3.5" aria-hidden />
                          Печать
                        </Button>
                      </td>
                    </tr>
                  );
                })}

                {parents.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Родителей пока нет. Создайте первого в форме выше — логин и пароль
                      появятся автоматически.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Flash message={flash} onClose={clear} />
    </div>
  );
}

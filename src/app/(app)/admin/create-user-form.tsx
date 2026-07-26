"use client";

import { Dices, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Flash, useFlash } from "@/components/flash";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select } from "@/components/ui/field";
import { createUserAction } from "@/lib/actions/users";
import { ROLE_LABELS, ROLES } from "@/lib/roles";

/** Пароль без похожих символов — его придётся диктовать вслух. */
function randomPassword(length = 8): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function CreateUserForm() {
  const router = useRouter();
  const { flash, show, clear } = useFlash();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
    role: "STUDENT" as string,
    className: "",
  });

  function update(patch: Partial<typeof form>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createUserAction(form);
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      setForm({ name: "", username: "", email: "", password: "", role: form.role, className: "" });
      show("success", result.message ?? "Пользователь создан");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5">
      <div className="space-y-1.5">
        <Label htmlFor="user-name">ФИО</Label>
        <Input
          id="user-name"
          value={form.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder="Смирнова Ольга Петровна"
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="user-username">Логин</Label>
        <Input
          id="user-username"
          value={form.username}
          onChange={(event) => update({ username: event.target.value })}
          placeholder="smirnova.o.p"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <FieldHint>Латиница, цифры, точка, дефис. Почта не нужна.</FieldHint>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="user-password">Пароль</Label>
        <div className="flex gap-2">
          <Input
            id="user-password"
            type="text"
            value={form.password}
            onChange={(event) => update({ password: event.target.value })}
            minLength={6}
            required
          />
          <Button
            type="button"
            variant="outline"
            title="Придумать пароль"
            onClick={() => update({ password: randomPassword() })}
          >
            <Dices className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <FieldHint>
          Минимум 6 символов. В базе — только bcrypt-хеш; этот пароль будет виден
          в таблице до первого входа пользователя.
        </FieldHint>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="user-role">Роль</Label>
          <Select
            id="user-role"
            value={form.role}
            onChange={(event) => update({ role: event.target.value })}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </div>

        {form.role === "STUDENT" && (
          <div className="space-y-1.5">
            <Label htmlFor="user-class">Класс</Label>
            <Input
              id="user-class"
              value={form.className}
              onChange={(event) => update({ className: event.target.value })}
              placeholder="9-А"
              maxLength={20}
            />
          </div>
        )}
      </div>

      <Button type="submit" loading={pending} className="w-full">
        <UserPlus className="h-4 w-4" aria-hidden />
        Создать пользователя
      </Button>

      <Flash message={flash} onClose={clear} />
    </form>
  );
}

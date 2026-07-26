"use client";

import { KeyRound } from "lucide-react";
import { useState, useTransition } from "react";

import { Flash, useFlash } from "@/components/flash";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label } from "@/components/ui/field";
import { changeOwnPasswordAction } from "@/lib/actions/users";

export function ChangePasswordForm() {
  const { flash, show, clear } = useFlash();
  const [pending, startTransition] = useTransition();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (newPassword !== repeatPassword) {
      show("error", "Новые пароли не совпадают");
      return;
    }

    startTransition(async () => {
      const result = await changeOwnPasswordAction({ currentPassword, newPassword });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
      show("success", result.message ?? "Пароль изменён");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="current-password">Текущий пароль</Label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="new-password">Новый пароль</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          minLength={6}
          required
        />
        <FieldHint>Минимум 6 символов.</FieldHint>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="repeat-password">Повторите новый пароль</Label>
        <Input
          id="repeat-password"
          type="password"
          autoComplete="new-password"
          value={repeatPassword}
          onChange={(event) => setRepeatPassword(event.target.value)}
          minLength={6}
          required
        />
      </div>

      <Button type="submit" loading={pending}>
        <KeyRound className="h-4 w-4" aria-hidden />
        Сменить пароль
      </Button>

      <Flash message={flash} onClose={clear} />
    </form>
  );
}

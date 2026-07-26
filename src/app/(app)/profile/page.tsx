import type { Metadata } from "next";

import { ChangePasswordForm } from "@/app/(app)/profile/change-password-form";
import { RoleBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageUser } from "@/lib/auth-guards";
import { initials } from "@/lib/utils";

export const metadata: Metadata = { title: "Профиль" };

export default async function ProfilePage() {
  const user = await requirePageUser();

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header className="flex items-center gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
          {initials(user.name)}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight">{user.name}</h1>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          <RoleBadge role={user.role} className="mt-1.5" />
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Смена пароля</CardTitle>
          <p className="text-sm text-muted-foreground">
            Если пароль был выдан администратором, обязательно смените его на свой.
          </p>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}

import * as React from "react";

import { cn } from "@/lib/utils";
import type { Role } from "@/lib/roles";

type Tone = "default" | "success" | "warning" | "danger" | "info" | "muted";

const TONES: Record<Tone, string> = {
  default: "bg-primary/10 text-primary",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
  danger: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  muted: "bg-muted text-muted-foreground",
};

export function Badge({
  tone = "default",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

const ROLE_TONES: Record<Role, Tone> = {
  ADMIN: "danger",
  TEACHER: "info",
  STUDENT: "success",
  // Родитель — «подпись в дневнике», чернильный тон default (bg-primary/10):
  // по образцу существующих тонов, без новых цветов данных.
  PARENT: "default",
};

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  const labels: Record<Role, string> = {
    ADMIN: "Администратор",
    TEACHER: "Учитель",
    STUDENT: "Ученик",
    PARENT: "Родитель",
  };
  return (
    <Badge tone={ROLE_TONES[role]} className={className}>
      {labels[role]}
    </Badge>
  );
}

"use client";

import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/field";
import { initials } from "@/lib/utils";

type Student = { id: string; name: string; email: string; className: string | null };

export function StudentsList({ students }: { students: Student[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return students;
    return students.filter(
      (student) =>
        student.name.toLowerCase().includes(needle) ||
        student.email.toLowerCase().includes(needle) ||
        (student.className ?? "").toLowerCase().includes(needle),
    );
  }, [query, students]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по фамилии, классу или e-mail…"
          className="pl-9"
          aria-label="Поиск ученика"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {students.length === 0
            ? "Учеников пока нет — добавьте их в панели администратора."
            : "Никого не найдено."}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {filtered.map((student) => (
            <li key={student.id}>
              <Link
                href={`/journal/students/${student.id}`}
                className="focus-ring flex items-center gap-3 p-3 transition-colors hover:bg-accent/50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {initials(student.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{student.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {student.email}
                  </span>
                </span>
                {student.className && (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {student.className}
                  </span>
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

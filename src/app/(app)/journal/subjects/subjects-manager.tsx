"use client";

import { BookPlus, Check, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Flash, useFlash } from "@/components/flash";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import {
  createSubjectAction,
  deleteSubjectAction,
  renameSubjectAction,
} from "@/lib/actions/subjects";

type Subject = { id: string; name: string; lessons: number; grades: number };

export function SubjectsManager({ subjects }: { subjects: Subject[] }) {
  const router = useRouter();
  const { flash, show, clear } = useFlash();
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createSubjectAction({ name });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      setName("");
      show("success", result.message ?? "Предмет добавлен");
      router.refresh();
    });
  }

  function handleRename(subjectId: string) {
    startTransition(async () => {
      const result = await renameSubjectAction({ subjectId, name: editingName });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      setEditingId(null);
      show("success", result.message ?? "Предмет переименован");
      router.refresh();
    });
  }

  function handleDelete(subject: Subject) {
    const warning =
      subject.grades > 0
        ? `Предмет «${subject.name}» содержит ${subject.grades} оценок. Удалить вместе с ними?`
        : `Удалить предмет «${subject.name}»?`;
    if (!window.confirm(warning)) return;

    startTransition(async () => {
      const result = await deleteSubjectAction({ subjectId: subject.id });
      if (!result.ok) {
        show("error", `${result.status}: ${result.error}`);
        return;
      }
      show("success", result.message ?? "Предмет удалён");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1 space-y-1.5">
              <Label htmlFor="subject-name">Новый предмет</Label>
              <Input
                id="subject-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Например: Информатика"
                maxLength={60}
                required
              />
            </div>
            <Button type="submit" loading={pending} disabled={name.trim().length < 2}>
              <BookPlus className="h-4 w-4" aria-hidden />
              Добавить
            </Button>
          </form>
        </CardContent>
      </Card>

      {subjects.length === 0 ? (
        <p className="rounded-lg border border-dashed border-rule-strong bg-card p-8 text-center text-sm text-muted-foreground">
          Предметов пока нет. Добавьте первый — он сразу появится в журнале.
        </p>
      ) : (
        <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule-strong bg-card">
          {subjects.map((subject) => (
            <li key={subject.id} className="group/row flex items-center gap-3 p-3 hover:bg-primary/[0.04]">
              {editingId === subject.id ? (
                <>
                  <Input
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    className="max-w-xs"
                    maxLength={60}
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleRename(subject.id);
                      if (event.key === "Escape") setEditingId(null);
                    }}
                  />
                  <Button size="sm" onClick={() => handleRename(subject.id)} loading={pending}>
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    Сохранить
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{subject.name}</p>
                    <p className="text-xs text-muted-foreground">
                      уроков: {subject.lessons} · оценок: {subject.grades}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Переименовать"
                    onClick={() => {
                      setEditingId(subject.id);
                      setEditingName(subject.name);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Удалить предмет"
                    className="text-muted-foreground opacity-60 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover/row:opacity-100"
                    onClick={() => handleDelete(subject)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <Flash message={flash} onClose={clear} />
    </div>
  );
}

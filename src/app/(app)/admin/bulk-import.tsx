"use client";

import { ClipboardCopy, Download, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Flash, useFlash } from "@/components/flash";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Textarea } from "@/components/ui/field";
import { bulkImportStudentsAction, type BulkImportResult } from "@/lib/actions/users";
import { downloadCsv, toCsv } from "@/lib/csv";
import { parseStudentNames } from "@/lib/students-import";

const PLACEHOLDER = `Иванов Иван Иванович
Петрова Мария Сергеевна
Сидоров Пётр Алексеевич

или через запятую: Козлов Илья, Новикова Анна`;

export function BulkImportStudents() {
  const router = useRouter();
  const { flash, show, clear } = useFlash();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [className, setClassName] = useState("");
  const [result, setResult] = useState<BulkImportResult | null>(null);

  // Живой предпросмотр: тот же парсер, что и на сервере.
  const preview = useMemo(() => parseStudentNames(text), [text]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const response = await bulkImportStudentsAction({
        text,
        className: className.trim() || undefined,
      });

      if (!response.ok) {
        show("error", `${response.status}: ${response.error}`);
        return;
      }

      setResult(response.data);
      setText("");
      show("success", response.message ?? "Импорт завершён");
      router.refresh();
    });
  }

  function copyCredentials() {
    if (!result) return;
    const lines = result.created.map((s) => `${s.name}\t${s.email}\t${s.password}`).join("\n");
    navigator.clipboard
      .writeText(`ФИО\tЛогин\tПароль\n${lines}`)
      .then(() => show("success", "Скопировано в буфер обмена"))
      .catch(() => show("error", "Не удалось скопировать"));
  }

  function downloadCredentials() {
    if (!result) return;
    downloadCsv(
      "ucheniki-logins.csv",
      toCsv(
        ["ФИО", "Логин", "Временный пароль"],
        result.created.map((s) => [s.name, s.email, s.password]),
      ),
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="import-text">Список учеников</Label>
          <Textarea
            id="import-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={PLACEHOLDER}
            className="min-h-[170px] font-mono text-[13px]"
            required
          />
          <FieldHint>
            Распознано имён: <span className="font-semibold text-foreground">{preview.length}</span>
            . Нумерация («1.», «2)») и лишние пробелы убираются автоматически, повторы
            отбрасываются.
          </FieldHint>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-36 space-y-1.5">
            <Label htmlFor="import-class">Класс</Label>
            <Input
              id="import-class"
              value={className}
              onChange={(event) => setClassName(event.target.value)}
              placeholder="9-А"
              maxLength={20}
            />
          </div>

          <FieldHint className="order-last w-full">
            Класс указывать не обязательно — его можно проставить позже.
          </FieldHint>

          <Button type="submit" loading={pending} disabled={preview.length === 0}>
            <UserPlus className="h-4 w-4" aria-hidden />
            Создать {preview.length > 0 ? `(${preview.length})` : ""}
          </Button>
        </div>
      </form>

      {preview.length > 0 && !result && (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Users className="h-3.5 w-3.5" aria-hidden />
            Предпросмотр
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {preview.slice(0, 24).map((name) => (
              <li
                key={name}
                className="rounded bg-card px-2 py-0.5 text-xs shadow-sm ring-1 ring-border"
              >
                {name}
              </li>
            ))}
            {preview.length > 24 && (
              <li className="px-2 py-0.5 text-xs text-muted-foreground">
                и ещё {preview.length - 24}…
              </li>
            )}
          </ul>
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <Alert tone="warning" title="Сохраните пароли — они показываются только один раз">
            В базе данных хранится только bcrypt-хеш. Если пароль утерян, его можно
            сбросить в таблице пользователей.
          </Alert>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={copyCredentials}>
              <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
              Скопировать
            </Button>
            <Button size="sm" variant="outline" onClick={downloadCredentials}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              Скачать CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
              Скрыть
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">ФИО</th>
                  <th className="px-3 py-2 text-left font-semibold">Логин</th>
                  <th className="px-3 py-2 text-left font-semibold">Пароль</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.created.map((student) => (
                  <tr key={student.email}>
                    <td className="px-3 py-1.5">{student.name}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{student.email}</td>
                    <td className="px-3 py-1.5 font-mono text-xs font-semibold">
                      {student.password}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.skipped.length > 0 && (
            <Alert tone="error" title={`Пропущено: ${result.skipped.length}`}>
              <ul className="mt-1 list-inside list-disc text-xs">
                {result.skipped.map((item) => (
                  <li key={item.name}>
                    {item.name} — {item.reason}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      )}

      <Flash message={flash} onClose={clear} />
    </div>
  );
}

import type { Metadata } from "next";

import { ParentManager } from "@/components/parent-manager";
import { requirePageRole } from "@/lib/auth-guards";
import { getParentsOverview, getStudents } from "@/lib/queries";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Семьи" };

/**
 * Раздел «Семьи»: создание родителей, привязка к детям, выдача кодов Telegram
 * и печать памяток. Только для ADMIN — requirePageRole первой строкой.
 */
export default async function ParentsPage() {
  await requirePageRole(["ADMIN"]);
  const [parents, students] = await Promise.all([getParentsOverview(), getStudents()]);

  const linkedStudents = new Set(
    parents.flatMap((parent) => parent.children.map((child) => child.id)),
  ).size;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-tight">Семьи</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {parents.length} {pluralize(parents.length, "родитель", "родителя", "родителей")} ·
          семейный доступ подключён у {linkedStudents} из {students.length}{" "}
          {pluralize(students.length, "ученика", "учеников", "учеников")}. Родитель видит только
          дневники своих детей; привязку и коды Telegram выдаёт администратор лично.
        </p>
      </header>

      <ParentManager
        parents={parents}
        students={students.map((student) => ({
          id: student.id,
          name: student.name,
          className: student.className,
        }))}
      />
    </div>
  );
}

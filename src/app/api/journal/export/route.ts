import { NextResponse, type NextRequest } from "next/server";

import { ForbiddenError, requireRole, UnauthorizedError } from "@/lib/auth-guards";
import { toCsv, withBom } from "@/lib/csv";
import { formatAverage, isValidQuarter, type Quarter } from "@/lib/grades";
import { prisma } from "@/lib/prisma";
import { getJournalData } from "@/lib/queries";
import { getActiveYear } from "@/lib/school-year";
import { GRADE_EDITOR_ROLES } from "@/lib/roles";
import { formatDateShort } from "@/lib/utils";

/**
 * Экспорт журнала в CSV (открывается в Excel).
 *
 * Пример Route Handler с той же серверной проверкой прав, что и Server Actions:
 * ученик получит 403 Forbidden, неавторизованный — 401.
 */
export async function GET(request: NextRequest) {
  try {
    await requireRole(GRADE_EDITOR_ROLES);

    const { searchParams } = request.nextUrl;
    const subjectId = searchParams.get("subject");
    const quarterParam = Number(searchParams.get("quarter"));
    const yearParam = Number(searchParams.get("year"));
    const className = searchParams.get("class");

    if (!subjectId) {
      return NextResponse.json({ error: "Не указан предмет" }, { status: 400 });
    }
    if (!isValidQuarter(quarterParam)) {
      return NextResponse.json({ error: "Четверть должна быть от 1 до 4" }, { status: 400 });
    }

    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
      select: { name: true },
    });
    if (!subject) {
      return NextResponse.json({ error: "Предмет не найден" }, { status: 404 });
    }

    const quarter = quarterParam as Quarter;
    const year = Number.isInteger(yearParam) ? yearParam : await getActiveYear();
    const data = await getJournalData(subjectId, quarter, year, className);

    const headers = [
      "Ученик",
      "Класс",
      ...data.lessons.map((lesson) => formatDateShort(lesson.date)),
      `Средний за ${quarter} четв.`,
      "Годовая",
    ];

    const rows = data.rows.map((row) => [
      row.student.name,
      row.student.className ?? "",
      // Две оценки за урок выгружаются как «10/9» — так же, как в журнале.
      ...data.lessons.map((lesson) =>
        (row.cells[lesson.id] ?? [])
          .sort((a, b) => a.slot - b.slot)
          .map((grade) => grade.value)
          .join("/"),
      ),
      formatAverage(row.average),
      row.year ?? "",
    ]);

    const csv = withBom(toCsv(headers, rows));
    const filename = `journal-${subject.name}-${year}-q${quarter}.csv`.replace(/\s+/g, "-");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("[export]", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

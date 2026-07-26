-- Типы оценок с весами, комментарии и отметки отсутствия «Н».

ALTER TABLE "Grade" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'regular';
ALTER TABLE "Grade" ADD COLUMN "weight" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Grade" ADD COLUMN "comment" TEXT;

CREATE TABLE "Absence" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "teacherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Absence_studentId_lessonId_key" ON "Absence"("studentId", "lessonId");
CREATE INDEX "Absence_studentId_subjectId_year_quarter_idx" ON "Absence"("studentId", "subjectId", "year", "quarter");

ALTER TABLE "Absence" ADD CONSTRAINT "Absence_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

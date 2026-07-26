-- Фаза 9 «Семья»: роль PARENT, штамп «Ознакомлен», привязка Telegram, outbox уведомлений.
-- Одна папка на всю фазу: migrate deploy применяет папки в строковой сортировке,
-- и номера 10+ легли бы раньше 2_* на свежей базе.

-- ── ParentLink: родитель ↔ ребёнок ──────────────────────────────────────────
CREATE TABLE "ParentLink" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "ParentLink_pkey" PRIMARY KEY ("id"),
    -- Второй рубеж за zod-схемами (стиль миграции 7_quarter_lock_debts).
    CONSTRAINT "ParentLink_not_self" CHECK ("parentId" <> "studentId")
);
CREATE UNIQUE INDEX "ParentLink_parentId_studentId_key" ON "ParentLink"("parentId", "studentId");
CREATE INDEX "ParentLink_studentId_idx" ON "ParentLink"("studentId");
ALTER TABLE "ParentLink" ADD CONSTRAINT "ParentLink_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParentLink" ADD CONSTRAINT "ParentLink_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- createdById намеренно без FK: снимок, паттерн AuditLog.

-- ── GradeAck: штамп «Ознакомлен» ────────────────────────────────────────────
CREATE TABLE "GradeAck" (
    "id" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "parentName" TEXT NOT NULL,
    "seenValue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GradeAck_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GradeAck_seenValue_range" CHECK ("seenValue" BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX "GradeAck_gradeId_parentId_key" ON "GradeAck"("gradeId", "parentId");
CREATE INDEX "GradeAck_parentId_createdAt_idx" ON "GradeAck"("parentId", "createdAt");
ALTER TABLE "GradeAck" ADD CONSTRAINT "GradeAck_gradeId_fkey"
    FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- parentId без FK: «подпись» переживает удаление родителя.

-- ── TelegramLink: чат ↔ пользователь ────────────────────────────────────────
CREATE TABLE "TelegramLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedAt" TIMESTAMP(3),
    CONSTRAINT "TelegramLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TelegramLink_userId_key" ON "TelegramLink"("userId");
CREATE UNIQUE INDEX "TelegramLink_chatId_key" ON "TelegramLink"("chatId");
ALTER TABLE "TelegramLink" ADD CONSTRAINT "TelegramLink_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- chatId — TEXT: телеграмный int64 не влезает в безопасный диапазон JS number.

-- ── TelegramLinkCode: одноразовый код (хранится ТОЛЬКО SHA-256-хеш) ─────────
CREATE TABLE "TelegramLinkCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TelegramLinkCode_codeHash_key" ON "TelegramLinkCode"("codeHash");
CREATE INDEX "TelegramLinkCode_userId_idx" ON "TelegramLinkCode"("userId");
ALTER TABLE "TelegramLinkCode" ADD CONSTRAINT "TelegramLinkCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── NotificationEvent: outbox уведомлений ───────────────────────────────────
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "lessonDate" TIMESTAMP(3) NOT NULL,
    "value" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NotificationEvent_value_range" CHECK ("value" BETWEEN 1 AND 10)
);
CREATE INDEX "NotificationEvent_sentAt_createdAt_idx" ON "NotificationEvent"("sentAt", "createdAt");
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Поля-снимки: сообщение «оценка 8 по математике за 24.07» переживает
-- правку и удаление оценки. Комментария учителя нет намеренно.

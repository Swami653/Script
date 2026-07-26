import { ZodError } from "zod";

import { ForbiddenError, UnauthorizedError } from "@/lib/auth-guards";

/**
 * Единый формат ответа Server Actions.
 * Ошибки НЕ бросаются в клиент — возвращается объект со статусом,
 * чтобы интерфейс мог показать понятное сообщение (в т.ч. 403 Forbidden).
 */
export type ActionResult<T = null> =
  | { ok: true; data: T; message?: string }
  | { ok: false; status: number; error: string };

export function actionOk<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function actionFail(error: string, status = 400): ActionResult<never> {
  return { ok: false, status, error };
}

/**
 * Доменный отказ, который можно БРОСАТЬ из общих хелперов (гвардов, guard-модулей):
 * actionError превратит его в ActionResult с тем же статусом. Так единая точка
 * проверки (например, requireWritableLesson) отказывает сама, не полагаясь на
 * то, что каждое действие не забудет проверить её результат.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/** Отказ «четверть закрыта»: 423 Locked. Текст объясняет, кто может переоткрыть. */
export class QuarterClosedError extends DomainError {
  constructor(quarter: number, year: number) {
    super(
      `${quarter} четверть ${year}/${year + 1} закрыта — изменения запрещены. ` +
        "Переоткрыть может администратор.",
      423,
    );
    this.name = "QuarterClosedError";
  }
}

/** Превращает исключение в ActionResult с корректным HTTP-подобным статусом. */
export function actionError(error: unknown): ActionResult<never> {
  if (error instanceof ForbiddenError) {
    return { ok: false, status: 403, error: error.message };
  }
  if (error instanceof UnauthorizedError) {
    return { ok: false, status: 401, error: error.message };
  }
  if (error instanceof ZodError) {
    return {
      ok: false,
      status: 400,
      error: error.issues.map((issue) => issue.message).join("; "),
    };
  }
  if (error instanceof DomainError) {
    return { ok: false, status: error.status, error: error.message };
  }
  if (error instanceof Error) {
    console.error("[action]", error);
    return { ok: false, status: 500, error: error.message || "Внутренняя ошибка сервера" };
  }
  console.error("[action] unknown error", error);
  return { ok: false, status: 500, error: "Внутренняя ошибка сервера" };
}

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
  if (error instanceof Error) {
    console.error("[action]", error);
    return { ok: false, status: 500, error: error.message || "Внутренняя ошибка сервера" };
  }
  console.error("[action] unknown error", error);
  return { ok: false, status: 500, error: "Внутренняя ошибка сервера" };
}

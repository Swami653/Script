"use server";

import { AuthError } from "next-auth";

import { signIn, signOut } from "@/auth";

export type LoginState = {
  error?: string;
  username?: string;
};

/**
 * Вход по логину и паролю.
 * Пароль проверяется bcrypt-сравнением в src/auth.ts, сессия — JWT.
 */
export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { error: "Введите логин и пароль", username };
  }

  try {
    // Успешный вход бросает NEXT_REDIRECT — его перехватывать нельзя.
    await signIn("credentials", { username, password, redirectTo: "/" });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      // Провайдер бросает CredentialsSignin с code="locked" при блокировке.
      if ((error as { code?: string }).code === "locked") {
        return {
          error:
            "Аккаунт временно заблокирован из-за нескольких неверных попыток. " +
            "Подождите 15 минут или обратитесь к администратору.",
          username,
        };
      }
      return { error: "Неверный логин или пароль", username };
    }
    throw error;
  }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

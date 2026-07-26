"use server";

import { AuthError } from "next-auth";

import { signIn, signOut } from "@/auth";

export type LoginState = {
  error?: string;
  email?: string;
};

/**
 * Вход по e-mail и паролю.
 * Пароль проверяется bcrypt-сравнением в src/auth.ts, сессия — JWT.
 */
export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Введите e-mail и пароль", email };
  }

  try {
    // Успешный вход бросает NEXT_REDIRECT — его перехватывать нельзя.
    await signIn("credentials", { email, password, redirectTo: "/" });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Неверный e-mail или пароль", email };
    }
    throw error;
  }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

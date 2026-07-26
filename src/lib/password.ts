import { randomInt } from "node:crypto";

/**
 * Генерация временных паролей. Только для серверного кода
 * (используется криптографически стойкий генератор из node:crypto).
 */

/** Алфавит без похожих символов: нет 0/O, 1/l/I — пароль легко продиктовать. */
const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateTempPassword(length = 8): string {
  let password = "";
  for (let i = 0; i < length; i += 1) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return password;
}

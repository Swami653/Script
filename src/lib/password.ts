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

/**
 * Алфавит кода привязки Telegram: верхний регистр без 0/O и 1/I —
 * код диктуется по телефону и вводится с памятки без ошибок.
 * 8 символов из 32 → 40 бит из CSPRNG.
 */
const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Одноразовый код привязки Telegram. В БД попадает ТОЛЬКО его SHA-256-хеш. */
export function generateLinkCode(length = 8): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  }
  return code;
}

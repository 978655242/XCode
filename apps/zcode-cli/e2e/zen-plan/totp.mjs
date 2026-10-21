// RFC 6238 TOTP（SHA-1/30s/6 位），与后端 pquerna/otp 默认参数一致，仅用于合成账号。
import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(secret) {
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error("invalid base32 secret");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

/** 避免在 30 秒窗口末尾提交导致服务端已滚动到下一个码。 */
export async function freshTotp(secret) {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 5_000) await new Promise((resolve) => setTimeout(resolve, remaining + 250));
  return totp(secret);
}

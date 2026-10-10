import {
  createCredentialCipherProvider,
  type CredentialCipherProvider,
} from "./credentialCipherProvider.js";

// XCODE: 只在Host导入时接收Main的key，立即移出env，禁止后续worker/terminal继承。
const secret = process.env.XCODE_PRIVATE_CREDENTIAL_SECRET;
delete process.env.XCODE_PRIVATE_CREDENTIAL_SECRET;
let cipher: CredentialCipherProvider | undefined;

// XCODE: 私有会话不得使用可由系统公开信息推导的旧凭据加密 key。
export function createPrivateCredentialCipherProvider(): CredentialCipherProvider {
  if (cipher) return cipher;
  if (
    !secret ||
    !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
    Buffer.from(secret, "base64url").length !== 32
  ) {
    throw Object.assign(new Error("Secure private credential storage is unavailable"), {
      code: "XCODE_SECURE_STORAGE_UNAVAILABLE",
    });
  }
  cipher = createCredentialCipherProvider({ env: { ZCODE_CREDENTIAL_SECRET: secret } });
  return cipher;
}

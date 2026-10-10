import { createHash, randomBytes } from "node:crypto";
import {
  NEW_API_PROVIDER_ID,
  NEW_API_CALLBACK_URI,
  NEW_API_CLIENT_ID,
  parseNewApiAuthorizationCallback,
  type NewApiSessionBundle,
  type OAuthProviderMeta,
} from "@zcode/shared";
import { NewApiClient, NewApiClientError } from "../../new-api/newApiClient.js";

// XCODE: 私有目的 adapter 不实现官方 OAuthTokenSet 接口，避免通过 Renderer 暴露主账号密钥。
export class NewApiProviderAdapter {
  readonly providerId = NEW_API_PROVIDER_ID;
  readonly meta: OAuthProviderMeta = {
    id: NEW_API_PROVIDER_ID,
    displayName: "New API",
    enabled: true,
    order: 0,
  };
  readonly redirectUri = NEW_API_CALLBACK_URI;

  constructor(readonly client: NewApiClient) {}

  createAuthorization(): { state: string; codeVerifier: string; authorizeUrl: string } {
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const url = new URL("/api/xcode/v1/auth/authorize", this.client.origin);
    url.search = new URLSearchParams({
      client_id: NEW_API_CLIENT_ID,
      response_type: "code",
      redirect_uri: this.redirectUri,
      state,
      code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return { state, codeVerifier, authorizeUrl: url.toString() };
  }

  parseCallback(raw: string): { state: string; code: string } {
    const parsed = parseNewApiAuthorizationCallback(raw);
    if (!parsed) throw new NewApiClientError("XCODE_AUTH_REQUEST_INVALID", 400);
    return parsed;
  }

  exchangeCode(code: string, codeVerifier: string): Promise<NewApiSessionBundle> {
    return this.client.exchangeAuthorizationCode({ code, codeVerifier });
  }

  refresh(session: NewApiSessionBundle): Promise<NewApiSessionBundle> {
    return this.client.refreshSession({
      sessionId: session.session_id,
      refreshToken: session.refresh_token,
    });
  }

  logout(session: NewApiSessionBundle): Promise<void> {
    return this.client.logoutSession({
      sessionId: session.session_id,
      refreshToken: session.refresh_token,
    });
  }
}

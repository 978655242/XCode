import multiavatar from "@multiavatar/multiavatar/esm";

const avatarCache = new Map<string, string>();
const CACHE_LIMIT = 128;

export function getAccountAvatarDataUri(userId: string): string | null {
  const id = userId.trim();
  if (!id || (/^\d+$/u.test(id) && !/^[1-9]\d*$/u.test(id))) return null;
  const namespace = /^[1-9]\d*$/u.test(id) ? "new-api" : "account";
  const seed = `aiscoo:${namespace}:multiavatar:v1:${id}`;
  const cached = avatarCache.get(seed);
  if (cached) return cached;
  try {
    const svg = multiavatar(seed);
    if (!svg) return null;
    const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    if (avatarCache.size >= CACHE_LIMIT) avatarCache.delete(avatarCache.keys().next().value!);
    avatarCache.set(seed, uri);
    return uri;
  } catch {
    return null;
  }
}

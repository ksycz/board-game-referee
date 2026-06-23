const STORAGE_KEY = "referee_access_key";
const URL_PARAM_NAMES = ["access", "access_key", "key"] as const;

export function initAccessKeyFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  for (const name of URL_PARAM_NAMES) {
    const value = params.get(name)?.trim();
    if (!value) {
      continue;
    }
    sessionStorage.setItem(STORAGE_KEY, value);
    params.delete(name);
    const query = params.toString();
    const cleanUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", cleanUrl);
    return;
  }
}

export function getAccessKey(): string {
  const stored = sessionStorage.getItem(STORAGE_KEY)?.trim();
  if (stored) {
    return stored;
  }
  if (!import.meta.env.DEV) {
    return "";
  }
  return import.meta.env.VITE_API_ACCESS_KEY?.trim() ?? "";
}

export function setAccessKey(key: string): void {
  const trimmed = key.trim();
  if (trimmed) {
    sessionStorage.setItem(STORAGE_KEY, trimmed);
  } else {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

export function clearAccessKey(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

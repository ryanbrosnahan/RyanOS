export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export function apiPath(path: string): string {
  const base = apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
  return `${base}${path}`;
}

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: init.credentials ?? "include"
  });
}

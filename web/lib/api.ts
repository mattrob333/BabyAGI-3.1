const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN || "";

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (API_TOKEN) {
    headers["Authorization"] = `Bearer ${API_TOKEN}`;
  }
  const res = await fetch(url, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

export function apiStreamUrl(path: string): string {
  return `${API_URL}${path}`;
}

export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (API_TOKEN) {
    headers["Authorization"] = `Bearer ${API_TOKEN}`;
  }
  return headers;
}

export { API_URL };

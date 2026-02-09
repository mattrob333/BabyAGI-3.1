const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN || "";

// All backend calls are routed through /api/* which Next.js rewrites to the
// Python backend.  This avoids conflicts with Next.js page routes at paths
// like /tools, /memory, /metrics that would otherwise intercept fetch calls.
const API_PREFIX = "/api";

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_URL}${API_PREFIX}${path}`;
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
  return `${API_URL}${API_PREFIX}${path}`;
}

export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (API_TOKEN) {
    headers["Authorization"] = `Bearer ${API_TOKEN}`;
  }
  return headers;
}

export { API_URL };

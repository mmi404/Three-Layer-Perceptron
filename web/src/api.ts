const BASE = import.meta.env.VITE_API_URL ?? '/api';

export type ApiError = { code: string; message: string; requestId: string };

/**
 * Fetch wrapper with the things that matter on a bad connection:
 * a timeout, retries with exponential backoff + JITTER, and a typed error.
 *
 * Jitter is not decoration: without it, every client that failed at the same
 * moment retries at the same moment and you get a thundering herd.
 */
export async function api<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const { timeoutMs = 8000, retries = 2, ...rest } = init;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${BASE}${path}`, {
        ...rest,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(rest.headers ?? {}) },
      });

      if (res.status === 204) return undefined as T;

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        // 4xx is our fault, not the network's — never retry it.
        const retryable = res.status >= 500 || res.status === 429;
        if (retryable && attempt < retries) {
          await backoff(attempt);
          continue;
        }
        throw Object.assign(new Error(body?.error?.message ?? res.statusText), {
          api: body?.error as ApiError | undefined,
          status: res.status,
        });
      }

      return body as T;
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      const isNetwork = err instanceof TypeError;
      if ((isAbort || isNetwork) && attempt < retries) {
        await backoff(attempt);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('Unreachable');
}

function backoff(attempt: number): Promise<void> {
  const base = 300 * 2 ** attempt;
  const jitter = Math.random() * base * 0.3;
  return new Promise((r) => setTimeout(r, base + jitter));
}

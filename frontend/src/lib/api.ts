/**
 * Acces a l'API. Un seul endroit sait parler au serveur, pour que la session,
 * le jeton anti-falsification et le format d'erreur ne soient pas reecrits a
 * chaque appel.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

const CSRF_COOKIE = 'mailfind.csrf';

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  requestId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string | undefined;
  readonly requestId: string | undefined;

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.status = problem.status;
    this.code = problem.code;
    this.title = problem.title;
    this.detail = problem.detail;
    this.requestId = problem.requestId;
  }
}

function readCsrfToken(): string | undefined {
  const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith(`${CSRF_COOKIE}=`));
  return entry?.slice(CSRF_COOKIE.length + 1);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);

  if (init.body !== undefined) headers.set('content-type', 'application/json');

  if (method !== 'GET' && method !== 'HEAD') {
    const token = readCsrfToken();
    if (token !== undefined) headers.set('x-csrf-token', token);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    // Le cookie de session voyage avec chaque appel : sans cela, l'API ne
    // saurait jamais qui parle.
    credentials: 'include',
  });

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    if (isProblem(payload)) throw new ApiError(payload);
    throw new ApiError({
      type: 'about:blank',
      title: 'Erreur inattendue',
      status: response.status,
      code: 'unexpected_error',
      detail: "Le serveur n'a pas repondu comme prevu.",
    });
  }

  return payload as T;
}

function isProblem(value: unknown): value is Problem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'title' in value &&
    'status' in value
  );
}

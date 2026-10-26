/**
 * Cliente HTTP. Cookies httpOnly (credentials 'include'), cabecera CSRF en TODAS las peticiones,
 * errores `{error:{code,message}}` → ApiError y un reintento tras 401 vía POST /api/auth/refresh.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/forgot', '/auth/reset', '/invitations/accept'];
const PUBLIC_PAGES = ['/login', '/forgot', '/reset', '/invite'];

let refreshing: Promise<boolean> | null = null;

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'X-Requested-With': 'holidaytracker', Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function refreshSession(): Promise<boolean> {
  refreshing ??= send('POST', '/auth/refresh')
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function redirectToLogin() {
  const here = window.location.pathname;
  if (PUBLIC_PAGES.some((p) => here.startsWith(p))) return;
  const from = encodeURIComponent(here + window.location.search);
  window.location.assign(`/login?from=${from}`);
}

async function toError(res: Response): Promise<ApiError> {
  let code = 'HTTP_ERROR';
  let message = `Error ${res.status}`;
  let details: unknown;
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
    if (data.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
      details = data.error.details;
    }
  } catch {
    /* cuerpo no JSON */
  }
  return new ApiError(res.status, code, message, details);
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await send(method, path, body);
  } catch {
    throw new ApiError(0, 'NETWORK', 'No se puede conectar con el servidor. Revisa tu conexión.');
  }
  if (res.status === 401 && !NO_REFRESH.includes(path)) {
    const ok = await refreshSession();
    if (ok) {
      res = await send(method, path, body);
    } else {
      if (path !== '/auth/me') redirectToLogin();
      throw await toError(res);
    }
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Ha ocurrido un error inesperado.';
}

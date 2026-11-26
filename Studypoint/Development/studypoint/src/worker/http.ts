// Small HTTP helpers shared by every API route (ARCHITECTURE §3.2).
// The full security headers (CSP etc.) and the error format arrive in T0.13.

export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export type ApiError = {
  error: { code: string; message: string };
};

/** JSON response with the API's standard headers. */
export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...API_SECURITY_HEADERS, ...extraHeaders },
  });
}

/** Error response. `message` is shown to Alex, so keep it plain and never include secrets or stack traces. */
export function apiError(status: number, code: string, message: string): Response {
  const body: ApiError = { error: { code, message } };
  return json(body, status);
}

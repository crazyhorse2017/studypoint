// Pure routing helpers (ARCHITECTURE A12b): no React, no DOM, so they're unit-tested locally.
// The React hooks that use them live in router.ts.

export type RouteParams = Record<string, string>;

/** Match "/source/:id" against "/source/abc". Returns params, or null. Trailing slashes are ignored. */
export function matchPath(pattern: string, pathname: string): RouteParams | null {
  const split = (p: string) => p.replace(/\/+$/, '').split('/').filter(Boolean);
  const pat = split(pattern);
  const parts = split(pathname);
  if (pat.length !== parts.length) return null;
  const params: RouteParams = {};
  for (let i = 0; i < pat.length; i += 1) {
    const seg = pat[i] as string;
    const part = parts[i] as string;
    if (seg.startsWith(':')) {
      let value: string;
      try {
        value = decodeURIComponent(part);
      } catch {
        return null;
      }
      params[seg.slice(1)] = value;
    } else if (seg !== part) {
      return null;
    }
  }
  return params;
}

/** Build "/source/:id" + {id} + query into a URL path, encoding every value. */
export function buildPath(pattern: string, params: RouteParams = {}, query: Record<string, string | number | undefined> = {}): string {
  const path = pattern.replace(/:([A-Za-z_]\w*)/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined) throw new Error(`Missing route param "${name}" for ${pattern}`);
    return encodeURIComponent(v);
  });
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export type ClickLike = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean };

/** Should a click on an internal link be handled by the router (instead of the browser)? */
export function shouldInterceptClick(e: ClickLike, target: string | null, href: string, origin: string): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (target && target !== '_self') return false;
  try {
    return new URL(href, origin).origin === origin;
  } catch {
    return false;
  }
}

/** Is a nav item active for this path? Today ("/") is only active on "/" itself. */
export function isActive(itemTo: string, pathname: string): boolean {
  return itemTo === '/' ? pathname === '/' : pathname === itemTo || pathname.startsWith(`${itemTo}/`);
}

// First-run setup (AUTH-07): with a one-time Cloudflare API token, create the Cloudflare Access login for
// this Worker so only the deployer's emails can open it, and brand the login page as Studyflare.
// The token is used for this one request and never stored or logged.
//
// Why a stranger can't hijack an unconfigured deployment: every step runs in the account that owns
// THIS Worker's workers.dev address (checked first), and the emails come from the ALLOWED_EMAILS var
// the deployer typed, never from the request.

import type { StoredConfig } from './config.ts';

const API = 'https://api.cloudflare.com/client/v4';
export const PEOPLE_POLICY_NAME = 'Studyflare people';
const BRAND_POLICY_NAME = 'Public login logo';

/** Paper style colours (DESIGN §3), repeated here because the login page is Cloudflare's, not ours. */
export const LOGIN_DESIGN = {
  background_color: '#fbf8f2',
  text_color: '#2b2620',
  header_text: 'Studyflare',
  footer_text: 'Your private study space. Only invited emails can sign in.',
};

export class SetupError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SetupError';
    this.status = status;
  }
}

export type SetupInput = { token: string; host: string; emails: readonly string[]; fetchImpl?: typeof fetch };
export type SetupOutcome = { stored: StoredConfig; orgCreated: boolean; branded: boolean };

type CfEnvelope = { success?: boolean; result?: unknown; errors?: Array<{ code?: number; message?: string }> };
type CfCall = (method: string, path: string, body?: unknown) => Promise<{ ok: boolean; status: number; result: unknown }>;

/** "studyflare.alex.workers.dev" → { script: "studyflare", subdomain: "alex" }. */
export function parseWorkersDevHost(host: string): { script: string; subdomain: string } | null {
  const m = /^([a-z0-9-]+)\.([a-z0-9-]+)\.workers\.dev$/.exec(host.trim().toLowerCase());
  return m && m[1] && m[2] ? { script: m[1], subdomain: m[2] } : null;
}

function makeCall(token: string, fetchImpl: typeof fetch): CfCall {
  return async (method, path, body) => {
    let res: Response;
    try {
      res = await fetchImpl(API + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new SetupError(502, "Cloudflare couldn't be reached. Try again in a minute.");
    }
    let data: CfEnvelope = {};
    try {
      data = (await res.json()) as CfEnvelope;
    } catch {
      data = {};
    }
    return { ok: res.ok && data.success !== false, status: res.status, result: data.result };
  };
}

const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

async function must(call: CfCall, method: string, path: string, body: unknown, failure: string): Promise<Record<string, unknown>> {
  const r = await call(method, path, body);
  if (!r.ok) throw new SetupError(r.status === 401 || r.status === 403 ? 403 : 502, failure);
  return (r.result ?? {}) as Record<string, unknown>;
}

const TOKEN_HELP = 'Check the token has the three permissions the setup page lists, then try again.';

/** Find the account that owns this workers.dev address. */
async function findAccount(call: CfCall, script: string, subdomain: string): Promise<string> {
  const accounts = await call('GET', '/accounts?per_page=50');
  if (!accounts.ok) throw new SetupError(403, `Cloudflare didn't accept that token. ${TOKEN_HELP}`);
  for (const a of list(accounts.result)) {
    const id = str(a['id']);
    if (!id) continue;
    const sub = await call('GET', `/accounts/${id}/workers/subdomain`);
    if (!sub.ok || str((sub.result as Record<string, unknown> | null)?.['subdomain']) !== subdomain) continue;
    const worker = await call('GET', `/accounts/${id}/workers/scripts/${script}/settings`);
    if (worker.ok) return id;
  }
  throw new SetupError(403, `That token can't see the Cloudflare account this Studyflare runs in. ${TOKEN_HELP}`);
}

export async function runSetup(input: SetupInput): Promise<SetupOutcome> {
  const where = parseWorkersDevHost(input.host);
  if (!where) throw new SetupError(400, 'Open Studyflare at its workers.dev address to run setup.');
  if (input.emails.length === 0) {
    throw new SetupError(400, 'ALLOWED_EMAILS is empty. Add your email to it in the Worker settings, then reload this page.');
  }
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(input.token.trim())) throw new SetupError(400, "That doesn't look like a Cloudflare API token.");
  const call = makeCall(input.token.trim(), input.fetchImpl ?? fetch);
  const account = await findAccount(call, where.script, where.subdomain);
  const acct = `/accounts/${account}/access`;
  const host = input.host.toLowerCase();

  // 1. Zero Trust organisation (the login page lives at <team>.cloudflareaccess.com).
  let orgCreated = false;
  let branded = false;
  const orgRes = await call('GET', `${acct}/organizations`);
  let org = orgRes.ok ? ((orgRes.result ?? null) as Record<string, unknown> | null) : null;
  if (!org || !str(org['auth_domain'])) {
    const created = await call('POST', `${acct}/organizations`, {
      name: 'Studyflare',
      auth_domain: `${where.subdomain}.cloudflareaccess.com`,
      login_design: { ...LOGIN_DESIGN, logo_path: `https://${host}/brand/logo.svg` },
    });
    if (!created.ok) {
      throw new SetupError(409, 'Cloudflare Zero Trust isn’t turned on for this account yet. Open one.dash.cloudflare.com once, pick the Free plan, then run setup again.');
    }
    org = (created.result ?? {}) as Record<string, unknown>;
    orgCreated = true;
    branded = true;
  } else {
    // Brand an existing login page only if nobody has customised it (it may be shared with other apps).
    const design = (org['login_design'] ?? {}) as Record<string, unknown>;
    if (!str(design['header_text']) && !str(design['logo_path'])) {
      const patched = await call('PATCH', `${acct}/organizations`, { login_design: { ...LOGIN_DESIGN, logo_path: `https://${host}/brand/logo.svg` } });
      branded = patched.ok;
    }
  }
  const teamDomain = str(org['auth_domain']);
  if (!teamDomain) throw new SetupError(502, "Cloudflare didn't return the login address. Try again.");

  // 2. Email one-time PIN login (Cloudflare's built-in method; passkeys can be added later).
  const idps = await call('GET', `${acct}/identity_providers`);
  if (!list(idps.result).some((p) => p['type'] === 'onetimepin')) {
    await must(call, 'POST', `${acct}/identity_providers`, { name: 'One-time PIN', type: 'onetimepin', config: {} }, `Couldn't turn on email PIN login. ${TOKEN_HELP}`);
  }

  // 3. The Access application for this address, reused if it already exists.
  const apps = list((await call('GET', `${acct}/apps?per_page=100`)).result);
  const findApp = (domain: string) => apps.find((a) => str(a['domain'])?.toLowerCase() === domain);
  let app = findApp(host);
  if (!app) {
    app = await must(call, 'POST', `${acct}/apps`, {
      name: 'Studyflare', domain: host, type: 'self_hosted', session_duration: '720h', app_launcher_visible: false,
    }, `Couldn't create the Studyflare login. ${TOKEN_HELP}`);
  }
  const appId = str(app['id']);
  const aud = str(app['aud']);
  if (!appId || !aud) throw new SetupError(502, "Cloudflare didn't return the login's id. Try again.");

  // 4. The allow policy: exactly the deployer's emails (Settings → People adds more later).
  const include = input.emails.map((email) => ({ email: { email } }));
  const policies = list((await call('GET', `${acct}/apps/${appId}/policies`)).result);
  const existing = policies.find((p) => p['name'] === PEOPLE_POLICY_NAME);
  const policyBody = { name: PEOPLE_POLICY_NAME, decision: 'allow', include, precedence: 1 };
  const policy = existing && str(existing['id'])
    ? await must(call, 'PUT', `${acct}/apps/${appId}/policies/${String(existing['id'])}`, policyBody, `Couldn't save who can sign in. ${TOKEN_HELP}`)
    : await must(call, 'POST', `${acct}/apps/${appId}/policies`, policyBody, `Couldn't save who can sign in. ${TOKEN_HELP}`);
  const policyId = str(policy['id']);
  if (!policyId) throw new SetupError(502, "Cloudflare didn't return the sign-in rule's id. Try again.");

  // 5. Let the login page load the logo: a bypass for /brand/ only (nothing private lives there).
  let brandAppId: string | null = null;
  if (branded) {
    let brandApp = findApp(`${host}/brand`);
    if (!brandApp) {
      brandApp = await must(call, 'POST', `${acct}/apps`, { name: 'Studyflare login logo', domain: `${host}/brand`, type: 'self_hosted', app_launcher_visible: false }, `Couldn't publish the login logo. ${TOKEN_HELP}`);
      const id = str(brandApp['id']);
      if (id) await must(call, 'POST', `${acct}/apps/${id}/policies`, { name: BRAND_POLICY_NAME, decision: 'bypass', include: [{ everyone: {} }], precedence: 1 }, `Couldn't publish the login logo. ${TOKEN_HELP}`);
    }
    brandAppId = str(brandApp['id']);
  }

  const stored: StoredConfig = { team_domain: teamDomain, aud, account_id: account, app_id: appId, policy_id: policyId, setup_at: String(Date.now()) };
  if (brandAppId) stored.brand_app_id = brandAppId;
  return { stored, orgCreated, branded };
}

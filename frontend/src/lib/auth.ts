import { loadConfig } from './config';

/*
 * Organizer sign-in uses the Cognito Hosted UI with the OAuth 2.0 authorization-code flow + PKCE.
 * No client secret exists in the browser. Tokens are kept in sessionStorage (cleared when the tab closes).
 */
const TOKENS_KEY = 'eventx.tokens';
const VERIFIER_KEY = 'eventx.pkce';
const STATE_KEY = 'eventx.state';

interface Tokens { accessToken: string; idToken: string; expiresAt: number }

export interface OrganizerUser { email: string; groups: string[]; isOrganizer: boolean }

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  arr.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len = 48): string {
  return b64url(crypto.getRandomValues(new Uint8Array(len)));
}

const redirectUri = () => `${window.location.origin}/callback`;

export async function signIn(): Promise<void> {
  const cfg = await loadConfig();
  const verifier = randomString();
  const state = randomString(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.userPoolClientId,
    redirect_uri: redirectUri(),
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  window.location.assign(`${cfg.cognitoDomain}/oauth2/authorize?${params}`);
}

export async function completeSignIn(search: string): Promise<void> {
  const cfg = await loadConfig();
  const params = new URLSearchParams(search);
  const error = params.get('error_description') ?? params.get('error');
  if (error) throw new Error(error);
  const code = params.get('code');
  const state = params.get('state');
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!code || !verifier || state !== sessionStorage.getItem(STATE_KEY)) throw new Error('Invalid sign-in response. Please try again.');
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  const res = await fetch(`${cfg.cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.userPoolClientId,
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error('Could not complete sign-in.');
  const body = (await res.json()) as { access_token: string; id_token: string; expires_in: number };
  const tokens: Tokens = { accessToken: body.access_token, idToken: body.id_token, expiresAt: Date.now() + body.expires_in * 1000 };
  sessionStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

function getTokens(): Tokens | null {
  const raw = sessionStorage.getItem(TOKENS_KEY);
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Tokens;
    if (t.expiresAt - 30_000 < Date.now()) {
      sessionStorage.removeItem(TOKENS_KEY);
      return null;
    }
    return t;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return getTokens()?.accessToken ?? null;
}

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(decodeURIComponent(escape(atob(payload))));
}

export function currentUser(): OrganizerUser | null {
  const t = getTokens();
  if (!t) return null;
  const claims = decodeJwt(t.idToken);
  const groups = (claims['cognito:groups'] as string[] | undefined) ?? [];
  return { email: String(claims.email ?? ''), groups, isOrganizer: groups.includes('organizers') };
}

export async function signOut(): Promise<void> {
  sessionStorage.removeItem(TOKENS_KEY);
  const cfg = await loadConfig();
  const params = new URLSearchParams({ client_id: cfg.userPoolClientId, logout_uri: `${window.location.origin}/` });
  window.location.assign(`${cfg.cognitoDomain}/logout?${params}`);
}

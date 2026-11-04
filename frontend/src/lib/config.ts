export interface AppConfig {
  apiUrl: string;
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  cognitoDomain: string;
}

let cached: Promise<AppConfig> | undefined;

/** Runtime config is written to /config.json by the CDK deployment, so the build is environment-agnostic. */
export function loadConfig(): Promise<AppConfig> {
  cached ??= fetch('/config.json', { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error('config.json not found');
      return r.json() as Promise<AppConfig>;
    })
    .then((c) => ({ ...c, apiUrl: c.apiUrl.replace(/\/$/, ''), cognitoDomain: c.cognitoDomain.replace(/\/$/, '') }));
  return cached;
}

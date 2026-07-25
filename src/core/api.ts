import { CoreApiClient } from '@storymee/api-client';

/** Resolve gateway base URL from storage snapshot or defaults. */
export function resolveGatewayBase(gflowUrl?: string): string {
  let apiBase = (gflowUrl || "https://hub.storymee.com").trim();
  if (apiBase.includes("ws://")) apiBase = apiBase.replace("ws://", "http://");
  else if (apiBase.includes("wss://")) apiBase = apiBase.replace("wss://", "https://");
  if (!apiBase.includes("://")) apiBase = "https://" + apiBase;
  return apiBase.replace(/\/+$/, "");
}

/**
 * Stable worker key for WS + Hub-wide routes.
 * Prefer hub_api_key so switching UI provider does NOT change connection identity.
 */
export function pickStableApiKey(data: {
  hub_api_key?: string;
  gflow_api_key?: string;
  dreamina_api_key?: string;
  picsart_api_key?: string;
  topview_api_key?: string;
}): string {
  return (
    data.hub_api_key ||
    data.gflow_api_key ||
    data.dreamina_api_key ||
    data.picsart_api_key ||
    data.topview_api_key ||
    ""
  );
}

/**
 * Prefer the shared hub_api_key for worker routes (/worker/v1/jobs, etc.).
 * Fall back to any provider key. Worker routes always require API-key auth.
 */
export async function getHubApiClient(
  _enforceApiPrefix: boolean = false,
  options?: { auth?: boolean; apiKeyOverride?: string | null }
): Promise<CoreApiClient> {
  return new Promise((resolve) => {
    chrome.storage.local.get([
      "gflowUrl",
      "hub_api_key",
      "selected_provider",
      "dreamina_api_key",
      "picsart_api_key",
      "topview_api_key",
      "gflow_api_key"
    ], (data: any) => {
      const apiBase = resolveGatewayBase(data.gflowUrl as string);
      const useAuth = options?.auth !== false;
      const apiKey =
        options?.apiKeyOverride === null
          ? ""
          : (options?.apiKeyOverride ?? pickStableApiKey(data));

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (useAuth && apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
        headers["x-api-key"] = apiKey;
      }

      const client = new CoreApiClient({
        baseURL: apiBase,
        // Never force /api prefix — StoryMee gateway uses /internal/v1 and /worker/v1
        enforceApiPrefix: false,
        headers: headers as any
      });

      // Browser/extension forbids setting User-Agent on XHR/fetch — strip it or Chrome logs + may drop request
      stripForbiddenBrowserHeaders(client);

      resolve(client);
    });
  });
}

/** Native fetch fallback for Jobs (more reliable in extension MV3 than axios edge cases). */
export async function fetchJobsRaw(
  gflowUrl: string,
  apiKey?: string
): Promise<{ ok: boolean; status: number; body: any; url: string; error?: string }> {
  const base = resolveGatewayBase(gflowUrl);
  const paths = [
    "/worker/v1/jobs?limit=100",
    "/worker/v1/jobs?limit=50",
  ];
  let last: { ok: boolean; status: number; body: any; url: string; error?: string } = {
    ok: false,
    status: 0,
    body: null,
    url: "",
    error: "no attempt",
  };

  for (const path of paths) {
    const url = `${base}${path}`;
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      // Only send Bearer when non-empty — invalid key returns success + empty list
      if (apiKey && apiKey.trim()) {
        headers["Authorization"] = `Bearer ${apiKey.trim()}`;
        headers["x-api-key"] = apiKey.trim();
      }
      const res = await fetch(url, { method: "GET", headers, credentials: "omit" });
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      last = { ok: res.ok, status: res.status, body, url };
      if (res.ok && body) return last;
    } catch (e: any) {
      last = { ok: false, status: 0, body: null, url, error: e?.message || String(e) };
    }
  }
  return last;
}

/** Chrome extension cannot set User-Agent; remove it from axios defaults + requests. */
function stripForbiddenBrowserHeaders(client: CoreApiClient) {
  try {
    const axiosInstance = (client as any).client;
    if (!axiosInstance) return;

    const scrub = (headers: any) => {
      if (!headers) return;
      delete headers['User-Agent'];
      delete headers['user-agent'];
      if (headers.common) {
        delete headers.common['User-Agent'];
        delete headers.common['user-agent'];
      }
    };

    scrub(axiosInstance.defaults?.headers);
    scrub(axiosInstance.defaults?.headers?.common);

    axiosInstance.interceptors.request.use((config: any) => {
      scrub(config.headers);
      if (config.headers?.set) {
        try {
          config.headers.delete?.('User-Agent');
          config.headers.delete?.('user-agent');
        } catch { /* ignore */ }
      }
      return config;
    });
  } catch {
    /* ignore */
  }
}

/** Extract job arrays from heterogeneous Hub response envelopes. */
export function extractJobsArray(res: any): any[] | null {
  if (!res) return null;
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.data)) return res.data;
  if (Array.isArray(res.jobs)) return res.jobs;
  if (Array.isArray(res.items)) return res.items;
  if (res.data && Array.isArray(res.data.jobs)) return res.data.jobs;
  if (res.data && Array.isArray(res.data.items)) return res.data.items;
  if (res.data && Array.isArray(res.data.data)) return res.data.data;
  return null;
}

export function isJobsResponseOk(res: any): boolean {
  if (!res) return false;
  if (Array.isArray(res)) return true;
  if (res.status === 'success' || res.status === 'ok' || res.success === true) return true;
  if (extractJobsArray(res) !== null) return true;
  return false;
}

/**
 * Canonical account-list paths on StoryMee Gateway (dev-hub / hub).
 *
 * Confirmed routes:
 * - Dreamina (IAM): GET /worker/v1/dreamina/accounts  → { status, accounts[] }
 * - TopView (IAM):  GET /worker/v1/topview/accounts
 * - Cookie pool:    GET /worker/v1/account/cookies?provider=X&decrypt=true
 * - GFlow rotation: GET /worker/v1/account/rotation/gflow/accounts
 *                   GET /internal/v1/account/rotation/gflow/accounts
 */
export function accountListPaths(provider: string): string[] {
  const p = provider.toUpperCase().replace(/-/g, '_');
  const isGflow =
    p === 'GFLOW' ||
    p === 'GOOGLE_FLOW' ||
    p === 'GOOGLE_ULTRA' ||
    p === 'GOOGLE_LABS_ULTRA' ||
    p.includes('GOOGLE') ||
    p.includes('LABS');

  if (isGflow) {
    return [
      '/worker/v1/account/rotation/gflow/accounts',
      '/internal/v1/account/rotation/gflow/accounts',
      '/worker/v1/account/cookies?provider=GFLOW&decrypt=true',
    ];
  }

  if (p === 'DREAMINA') {
    return [
      '/worker/v1/dreamina/accounts',
      '/worker/v1/account/cookies?provider=DREAMINA&decrypt=true',
      '/worker/v1/account/cookies?provider=DREAMINA',
    ];
  }

  if (p === 'TOPVIEW') {
    return [
      '/worker/v1/topview/accounts',
      '/worker/v1/account/cookies?provider=TOPVIEW&decrypt=true',
    ];
  }

  if (p === 'PICSART') {
    return [
      '/worker/v1/picsart/accounts',
      '/worker/v1/account/cookies?provider=PICSART&decrypt=true',
    ];
  }

  return [
    `/worker/v1/account/cookies?provider=${p}&decrypt=true`,
    `/worker/v1/account/cookies?provider=${p}`,
  ];
}

export function mapAccountRow(acc: any): {
  email: string;
  cookieStr: string;
  points: number;
  status: string;
  lastChecked: any;
  pool?: string;
  oauthToken?: string;
} {
  let cookieStrVal = '';
  if (typeof acc.cookies === 'string') {
    cookieStrVal = acc.cookies;
  } else if (typeof acc.cookiesJson === 'string') {
    cookieStrVal = acc.cookiesJson;
  } else if (acc.cookies && typeof acc.cookies === 'object') {
    cookieStrVal = Array.isArray(acc.cookies)
      ? acc.cookies.map((c: any) => `${c.name}=${c.value}`).join('; ')
      : JSON.stringify(acc.cookies);
  } else {
    cookieStrVal = acc.cookieStr || acc.cookie_str || '';
  }

  // GFlow rotation rows often ship oauthToken instead of cookies
  const oauthToken = acc.oauthToken || acc.oauth_token || '';

  const ptsVal = Math.max(
    acc.points !== undefined && acc.points !== null ? Number(acc.points) : 0,
    acc.credits !== undefined && acc.credits !== null ? Number(acc.credits) : 0,
    acc.tokenBalance !== undefined && acc.tokenBalance !== null ? Number(acc.tokenBalance) : 0,
    // GFlow ultra heuristic when pool has token but no numeric points
    oauthToken || acc.hasOauthToken ? 1000 : 0
  );

  return {
    email: acc.email || acc.accountEmail || '',
    cookieStr: cookieStrVal,
    points: ptsVal,
    status: acc.status || (ptsVal > 0 ? 'ACTIVE' : 'LOW_CREDIT'),
    lastChecked: acc.lastChecked || acc.last_checked || acc.lastUsed || acc.updatedAt || null,
    pool: acc.pool,
    oauthToken: oauthToken || undefined,
  };
}

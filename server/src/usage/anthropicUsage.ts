import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const SUCCESS_CACHE_MS = 5 * 60_000;
const TRANSIENT_ERROR_CACHE_MS = 15 * 60_000;
const DEFAULT_CREDENTIALS_KEY = '<default>';

export type UsageWindow = {
  utilization?: number;
  resetsAt?: string;
};

export type SharedUsage = {
  available: boolean;
  reason?: string;
  /** The values are from the last successful request while a refresh is delayed. */
  stale?: boolean;
  /** The failure should recover without changing account credentials. */
  temporary?: boolean;
  plan?: string;
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  sevenDayOpus?: UsageWindow;
  fetchedAt?: number;
};

type Credentials = {
  accessToken?: string;
  expiresAt?: number;
  subscriptionType?: string;
};

type CacheEntry = {
  value: SharedUsage;
  at: number;
  ttl: number;
};

const cache = new Map<string, CacheEntry>();
const lastSuccessful = new Map<string, SharedUsage>();
const inFlight = new Map<string, Promise<SharedUsage>>();

/**
 * Read the shared subscription's rate-limit windows from the same endpoint the
 * Claude Code TUI /usage screen uses. Strictly read-only: we never refresh the
 * OAuth token here — a concurrent write-back could race Claude Code's own
 * refresh and rotate the refresh token out from under the whole team. When the
 * access token is stale we degrade and let the next agent launch heal it.
 */
export async function getSharedUsage(credentialsPath?: string): Promise<SharedUsage> {
  const key = credentialsPath ?? DEFAULT_CREDENTIALS_KEY;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < cached.ttl) return cached.value;

  // Every browser polls the same shared account. Coalesce cache misses so a
  // cohort of clients crossing the expiry boundary produces one upstream call.
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = fetchSharedUsage(credentialsPath)
    .then((result) => {
      let value = result;
      let ttl = SUCCESS_CACHE_MS;

      if (result.available) {
        lastSuccessful.set(key, result);
      } else if (result.temporary) {
        ttl = TRANSIENT_ERROR_CACHE_MS;
        const previous = lastSuccessful.get(key);
        if (previous) {
          value = {
            ...previous,
            stale: true,
            reason: result.reason,
          };
        }
      }

      cache.set(key, { value, at: Date.now(), ttl });
      return value;
    })
    .finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

export function clearSharedUsageCache(): void {
  cache.clear();
  lastSuccessful.clear();
  inFlight.clear();
}

async function fetchSharedUsage(credentialsPath?: string): Promise<SharedUsage> {
  const creds = await readCredentials(credentialsPath);
  if (!creds?.accessToken) {
    return { available: false, reason: 'no subscription credentials on this server' };
  }
  if (creds.expiresAt && creds.expiresAt < Date.now()) {
    return {
      available: false,
      temporary: true,
      reason: 'subscription token is refreshing; try again shortly',
      plan: creds.subscriptionType,
    };
  }
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      if (res.status === 429) {
        return {
          available: false,
          temporary: true,
          reason: 'usage refresh rate limited; retrying later',
          plan: creds.subscriptionType,
        };
      }
      if (res.status >= 500) {
        return {
          available: false,
          temporary: true,
          reason: 'usage service temporarily unavailable; retrying later',
          plan: creds.subscriptionType,
        };
      }
      return { available: false, reason: `usage endpoint returned ${res.status}`, plan: creds.subscriptionType };
    }
    const body = (await res.json()) as Record<string, unknown>;
    return {
      available: true,
      plan: creds.subscriptionType,
      fiveHour: pickWindow(body.five_hour),
      sevenDay: pickWindow(body.seven_day),
      sevenDayOpus: pickWindow(body.seven_day_opus),
      fetchedAt: Date.now(),
    };
  } catch (e) {
    return {
      available: false,
      temporary: true,
      reason: `usage refresh failed: ${(e as Error).message}`,
      plan: creds.subscriptionType,
    };
  }
}

async function readCredentials(credentialsPath?: string): Promise<Credentials | undefined> {
  const path = credentialsPath ?? join(homedir(), '.claude', '.credentials.json');
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const oauth = (parsed.claudeAiOauth ?? parsed) as Record<string, unknown>;
    return {
      accessToken: typeof oauth.accessToken === 'string' ? oauth.accessToken : undefined,
      expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : undefined,
      subscriptionType: typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : undefined,
    };
  } catch {
    return undefined;
  }
}

function pickWindow(raw: unknown): UsageWindow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const utilization = typeof o.utilization === 'number' ? o.utilization : undefined;
  const resetsAt = typeof o.resets_at === 'string' ? o.resets_at : undefined;
  if (utilization === undefined && resetsAt === undefined) return undefined;
  return { utilization, resetsAt };
}

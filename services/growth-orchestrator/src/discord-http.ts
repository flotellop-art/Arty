import { fetchWithTimeout } from "./http-timeout";
import { readJsonBodyLimited, readTextBodyLimited } from "./bounded-body";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 300;
const DEFAULT_REQUEST_TIMEOUT_MS = 4_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 10_000;

export interface DiscordRequestOptions {
  maxAttempts?: number;
  requestTimeoutMs?: number;
  totalTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryDelayMs(response: Response, attempt: number): Promise<number> {
  const retryAfterHeader = response.headers.get("Retry-After");
  const headerSeconds = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
  if (Number.isFinite(headerSeconds) && headerSeconds >= 0) {
    return Math.min(24 * 60 * 60 * 1000, headerSeconds * 1000);
  }

  if (response.status === 429) {
    try {
      const body = await readJsonBodyLimited<{ retry_after?: number }>(response.clone(), 64 * 1024, 2_000);
      if (Number.isFinite(body.retry_after) && (body.retry_after ?? -1) >= 0) {
        return Math.min(24 * 60 * 60 * 1000, (body.retry_after ?? 0) * 1000);
      }
    } catch {
      // Le fallback exponentiel ci-dessous reste borne.
    }
  }

  return Math.min(10_000, DEFAULT_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1));
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Execute une requete Discord et ne transforme jamais un refus HTTP en succes.
 * Les erreurs reseau, 429 et 5xx sont retentees de facon bornee.
 */
export async function discordFetchOrThrow(
  url: string,
  init: RequestInit,
  context: string,
  options: DiscordRequestOptions = {},
): Promise<Response> {
  const maxAttempts = Math.min(5, Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const requestTimeoutMs = Math.min(10_000, Math.max(250, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS));
  const totalTimeoutMs = Math.min(30_000, Math.max(requestTimeoutMs, options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS));
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();
  const method = (init.method ?? "GET").toUpperCase();
  const networkRetryIsSafe = method === "GET" || method === "PUT" || method === "PATCH" || method === "DELETE";
  let lastNetworkError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remainingMs = totalTimeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      lastNetworkError = new Error("retry budget exhausted");
      break;
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(url, init, Math.min(requestTimeoutMs, remainingMs));
    } catch (error) {
      lastNetworkError = error;
      if (!networkRetryIsSafe || attempt === maxAttempts) break;
      await sleep(Math.min(10_000, DEFAULT_RETRY_DELAY_MS * 2 ** (attempt - 1)));
      continue;
    }

    if (response.ok) return response;

    if (shouldRetry(response.status) && attempt < maxAttempts) {
      const remainingAfterResponse = totalTimeoutMs - (Date.now() - startedAt);
      const delayMs = await retryDelayMs(response, attempt);
      if (delayMs > Math.max(0, remainingAfterResponse)) {
        throw new Error(`${context} rate limited beyond retry budget`);
      }
      if (delayMs > 0) await sleep(delayMs);
      continue;
    }

    const detail = (await readTextBodyLimited(response, 64 * 1024, 2_000)).slice(0, 200);
    throw new Error(`${context} failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  throw new Error(`${context} network failure: ${String(lastNetworkError)}`);
}

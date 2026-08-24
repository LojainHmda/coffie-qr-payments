import { AFS_REQUEST_TIMEOUT_MS } from "./constants";
import { AfsError } from "./errors";
import type { AfsConfig, AfsResult } from "./types";

/**
 * Thin, isolated HTTP client for AFS. Every AFS call in the application goes
 * through here, so authentication, timeouts, error mapping and log sanitising
 * live in exactly one place.
 *
 * The access token is attached here and nowhere else, and is never returned,
 * logged, or included in an error.
 */

interface AfsRequestOptions {
  /** Path relative to the configured base URL, e.g. "v1/checkouts". */
  path: string;
  method: "GET" | "POST";
  /** Sent as application/x-www-form-urlencoded (AFS does not accept JSON). */
  form?: Record<string, string>;
  query?: Record<string, string>;
  signal?: AbortSignal;
}

export interface AfsHttpResponse<T> {
  httpStatus: number;
  data: T;
}

function buildUrl(config: AfsConfig, path: string, query?: Record<string, string>): string {
  const url = new URL(path.replace(/^\/+/, ""), config.baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export async function afsRequest<T extends { result?: AfsResult }>(
  config: AfsConfig,
  options: AfsRequestOptions,
): Promise<AfsHttpResponse<T>> {
  const url = buildUrl(config, options.path, options.query);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.accessToken}`,
    Accept: "application/json",
  };

  let body: string | undefined;
  if (options.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
    body = new URLSearchParams(options.form).toString();
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method,
      headers,
      body,
      cache: "no-store",
      signal: options.signal ?? AbortSignal.timeout(AFS_REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    throw new AfsError(
      timedOut ? "TIMEOUT" : "NETWORK",
      timedOut
        ? `AFS did not respond within ${AFS_REQUEST_TIMEOUT_MS}ms`
        : "Could not reach the AFS gateway",
      {
        publicMessage: "The payment gateway is currently unreachable. Please try again.",
        httpStatus: 504,
        // Path only — the query string can carry the entityId.
        details: { path: options.path, method: options.method },
        cause,
      },
    );
  }

  const raw = await response.text();
  let data: T;
  try {
    data = JSON.parse(raw) as T;
  } catch (cause) {
    throw new AfsError("PARSE", "AFS returned a non-JSON response", {
      publicMessage: "Unexpected response from the payment gateway.",
      httpStatus: 502,
      details: { path: options.path, httpStatus: response.status },
      cause,
    });
  }

  // AFS reports business failures with HTTP 2xx and a result.code, and
  // auth/'400 Bad Request' style problems with a non-2xx status.
  if (!response.ok && !data.result) {
    throw new AfsError("HTTP", `AFS responded with HTTP ${response.status}`, {
      publicMessage: "The payment gateway rejected the request.",
      httpStatus: response.status === 401 || response.status === 403 ? 500 : 502,
      details: { path: options.path, httpStatus: response.status },
    });
  }

  return { httpStatus: response.status, data };
}

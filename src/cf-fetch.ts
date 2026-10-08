import {
	outgoingAgent,
	outgoingFetch,
	REQUEST_TIMEOUT_MS,
	socketTimeouts,
} from "./outgoing.ts";

const CF_TIMEOUT_MS = 12_000;
/** Extra attempts after no response at all (abort, reset, connect timeout) */
const CF_NET_RETRIES = 1;
/** Extra attempts after 429 / 5xx. Background writes get none */
const CF_HTTP_RETRIES = 2;
/** Longest pause we accept from Retry-After; past that the caller sees the error */
export const CF_RETRY_CAP_MS = 2_000;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

export const cfAgent = {
	connections: 64,
	pipelining: 1,
	keepAliveTimeout: 30_000,
	keepAliveMaxTimeout: 60_000,
	headersTimeout: CF_TIMEOUT_MS,
	bodyTimeout: REQUEST_TIMEOUT_MS,
	...socketTimeouts(CF_TIMEOUT_MS, { minVersion: "TLSv1.3" }),
};

// cfFetch is the only retry layer for Cloudflare: no undici retry interceptor here
const agent = outgoingAgent(cfAgent, { retry: false });

export type CfFetchInit = {
	method?: string;
	headers?: Record<string, string>;
	body?: string | Buffer | Uint8Array;
	/** Best-effort cache write: fail on the first 429/5xx instead of backing off */
	background?: boolean;
	/** Hand back the unread body: no overall deadline (the agent's header/idle timeouts still apply) */
	stream?: boolean;
};

export type CfResponse = {
	ok: boolean;
	status: number;
	headers: { get: (name: string) => string | null };
	body: ReadableStream<Uint8Array> | null;
	arrayBuffer: () => Promise<ArrayBuffer>;
	text: () => Promise<string>;
	json: () => Promise<unknown>;
};

/** No response at all (abort, socket reset, connect timeout) — never an HTTP status */
export function isNoResponseError(err: unknown): boolean {
	for (let cur = err, depth = 0; cur && depth < 4; depth++) {
		const e = cur as { name?: string; code?: string; cause?: unknown };
		if (
			e.name === "TimeoutError" ||
			e.name === "AbortError" ||
			e.name === "ConnectTimeoutError" ||
			e.name === "HeadersTimeoutError" ||
			e.name === "SocketError" ||
			e.code === "UND_ERR_CONNECT_TIMEOUT" ||
			e.code === "UND_ERR_HEADERS_TIMEOUT" ||
			e.code === "UND_ERR_SOCKET" ||
			e.code === "ECONNRESET" ||
			e.code === "ETIMEDOUT" ||
			e.code === "EPIPE"
		)
			return true;
		cur = e.cause;
	}
	return false;
}

/** Wait before retry `n` (0-based): Retry-After (seconds or HTTP date) when given, capped */
export function retryDelayMs(
	retryAfter: string | null | undefined,
	n: number,
	now = Date.now(),
): number {
	const fallback = 250 * 2 ** n;
	let ms = fallback;
	const raw = retryAfter?.trim();
	if (raw) {
		const sec = Number(raw);
		if (Number.isFinite(sec)) ms = sec * 1000;
		else {
			const at = Date.parse(raw);
			if (Number.isFinite(at)) ms = at - now;
		}
	}
	return Math.min(CF_RETRY_CAP_MS, Math.max(0, ms));
}

export async function cfFetch(
	url: string,
	init: CfFetchInit = {},
): Promise<CfResponse> {
	let netRetries = 0;
	let httpRetries = 0;
	for (;;) {
		let res: Awaited<ReturnType<typeof outgoingFetch>>;
		try {
			res = await outgoingFetch(url, {
				method: init.method,
				headers: init.headers,
				body: init.body,
				signal: init.stream ? undefined : AbortSignal.timeout(CF_TIMEOUT_MS),
				dispatcher: agent,
			});
		} catch (err) {
			// KV/R2 PUTs are idempotent, so retrying any method once is safe
			if (netRetries < CF_NET_RETRIES && isNoResponseError(err)) {
				netRetries += 1;
				continue;
			}
			throw err;
		}
		if (
			!init.background &&
			RETRY_STATUS.has(res.status) &&
			httpRetries < CF_HTTP_RETRIES
		) {
			const wait = retryDelayMs(res.headers.get("retry-after"), httpRetries);
			httpRetries += 1;
			await res.body?.cancel().catch(() => undefined);
			await new Promise((resolve) => setTimeout(resolve, wait));
			continue;
		}
		return res;
	}
}

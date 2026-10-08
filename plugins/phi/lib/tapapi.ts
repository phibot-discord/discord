import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "../../../src/logger.ts";
import {
	type OutgoingInit,
	outgoingAgent,
	outgoingFetch,
	socketTimeouts,
} from "../../../src/outgoing.ts";
import { PHI_PROXY_KEY, PROXY_KEY_HEADER } from "./const.ts";

export const TAPAPI_TIMEOUT_MS = 30_000;
export const TAPAPI_SAVE_TIMEOUT_MS = 45_000;
export const TAPAPI_QR_POLL_TIMEOUT_MS = 15_000;
const TAPAPI_MAX_ATTEMPTS = 4;
const TAP_RETRY_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);
const TAP_CN_HOST = /(?:^|\.)tapapis\.cn$|(?:^|\.)tapfiles\.cn$/i;
const DEFAULT_TAP_PROXY = "https://phi-ill-sync.ymyk.workers.dev/tap-proxy";

function tapProxyBase(): string {
	const raw = process.env.TAP_PROXY_URL;
	if (raw === "" || raw === "off") return "";
	return (raw || DEFAULT_TAP_PROXY).replace(/\/+$/, "");
}

/** CN TapTap is a direct Chinese IP; this Next host cannot SYN to it */
export function tapCnProxyUrl(url: string | URL): string | undefined {
	const base = tapProxyBase();
	if (!base) return;
	try {
		const host = (typeof url === "string" ? new URL(url) : url).hostname;
		if (!TAP_CN_HOST.test(host)) return;
		return base;
	} catch {
		return;
	}
}

export const tapAgent = {
	...socketTimeouts(TAPAPI_TIMEOUT_MS),
	headersTimeout: TAPAPI_SAVE_TIMEOUT_MS,
	bodyTimeout: TAPAPI_SAVE_TIMEOUT_MS,
};

// tapFetch retries dropped sockets itself; undici only retries 429/5xx here
const agent = outgoingAgent(
	{
		connections: 8,
		pipelining: 1,
		keepAliveTimeout: 10_000,
		keepAliveMaxTimeout: 30_000,
		...tapAgent,
	},
	{ retry: "status" },
);

type TapHttp = (
	url: string | URL,
	init?: Record<string, unknown>,
) => Promise<Response>;

export function tapProxyForwardHeaders(
	url: string | URL,
	init: RequestInit = {},
	proxyKey = PHI_PROXY_KEY,
): Headers {
	const headers = new Headers(init.headers);
	headers.set("x-tap-target", String(url));
	if (proxyKey) headers.set(PROXY_KEY_HEADER, proxyKey);
	const mac = headers.get("authorization");
	if (mac) headers.set("x-tap-authorization", mac);
	return headers;
}

const defaultTapHttp: TapHttp = (url, init = {}) => {
	const proxy = tapCnProxyUrl(url);
	if (!proxy) {
		return outgoingFetch(url, { ...init, dispatcher: agent } as OutgoingInit);
	}
	return outgoingFetch(proxy, {
		...init,
		headers: tapProxyForwardHeaders(url, init as RequestInit),
		dispatcher: agent,
	} as OutgoingInit);
};

let tapHttp: TapHttp = defaultTapHttp;

export function setTapHttpForTest(fn?: TapHttp) {
	tapHttp = fn ?? defaultTapHttp;
}

export class TapApiError extends Error {
	readonly timeout: boolean;

	constructor(message: string, timeout = false) {
		super(message);
		this.name = "TapApiError";
		this.timeout = timeout;
	}
}

export function isTimeoutError(err: unknown): boolean {
	let cur: unknown = err;
	for (let i = 0; i < 4 && cur; i++) {
		if (!(cur instanceof Error)) return false;
		if (
			cur.name === "TimeoutError" ||
			cur.name === "AbortError" ||
			cur.name === "ConnectTimeoutError" ||
			cur.name === "HeadersTimeoutError" ||
			cur.name === "BodyTimeoutError"
		) {
			return true;
		}
		const code = (cur as { code?: string }).code;
		if (typeof code === "string" && /TIMEOUT/i.test(code)) return true;
		if (/timeout|timed out|aborted/i.test(cur.message)) return true;
		cur = cur.cause;
	}
	return false;
}

function toTapApiError(err: unknown): TapApiError {
	if (err instanceof TapApiError) return err;
	const timeout = isTimeoutError(err);
	const message = err instanceof Error ? err.message : "TapAPI request failed";
	return new TapApiError(timeout ? "TapAPI timed out" : message, timeout);
}

export function isTapApiFailure(err: unknown): boolean {
	return err instanceof TapApiError || isTimeoutError(err);
}

type TapWaitStore = { notify: () => void; sent: boolean };

const tapWait = new AsyncLocalStorage<TapWaitStore>();

export function withTapWait<T>(
	notify: () => void,
	fn: () => Promise<T>,
): Promise<T> {
	return tapWait.run({ notify, sent: false }, fn);
}

function errCode(err: unknown): string | undefined {
	return err && typeof err === "object" && "code" in err
		? String((err as { code?: unknown }).code || "")
		: undefined;
}

function errChain(err: unknown): string {
	const bits: string[] = [];
	let cur: unknown = err;
	for (let i = 0; i < 5 && cur; i++) {
		if (cur instanceof Error) {
			const code = errCode(cur);
			bits.push(
				[cur.name, cur.message, code]
					.filter((p) => p && p !== "undefined")
					.join(" "),
			);
			cur = cur.cause;
			continue;
		}
		bits.push(String(cur));
		break;
	}
	return bits.join(" <- ") || String(err);
}

/** Kernel SYN to TapTap often dies ~15s; undici's 30s connect timer never fires */
export function isRetryableTapNet(err: unknown): boolean {
	if (err instanceof TapApiError) return err.timeout;
	let cur: unknown = err;
	for (let i = 0; i < 4 && cur; i++) {
		if (!(cur instanceof Error)) return false;
		const code = errCode(cur) || "";
		if (
			/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|EPIPE|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/i.test(
				code,
			)
		) {
			return true;
		}
		if (cur.name === "TypeError" && /fetch failed/i.test(cur.message)) {
			return true;
		}
		if (isTimeoutError(cur)) return true;
		cur = cur.cause;
	}
	return false;
}

export function tapRemainMs(
	started: number,
	timeoutMs: number,
	now = performance.now(),
) {
	return Math.max(1_000, Math.floor(timeoutMs - (now - started)));
}

function withTimeout(
	signal: AbortSignal | null | undefined,
	timeoutMs: number,
) {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function tapFetch(
	url: string | URL,
	init: RequestInit = {},
	timeoutMs = TAPAPI_TIMEOUT_MS,
): Promise<Response> {
	const ctx = tapWait.getStore();
	if (ctx && !ctx.sent) {
		ctx.sent = true;
		try {
			ctx.notify();
		} catch {}
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	const method = (init.method ?? "GET").toUpperCase();
	const started = performance.now();
	let last: unknown;
	for (let attempt = 1; attempt <= TAPAPI_MAX_ATTEMPTS; attempt++) {
		const remain = tapRemainMs(started, timeoutMs);
		try {
			const res = await tapHttp(url, {
				...init,
				signal: withTimeout(init.signal, remain),
				dispatcher: agent,
			});
			const ms = Math.round(performance.now() - started);
			// undici already retried these (idempotent methods): TapTap is unavailable
			if (res.status >= 500 || res.status === 429) {
				logger.warn(`tap ${method} ${tapUrl(url)} ${res.status} ${ms}ms`);
				throw new TapApiError(`TapAPI ${res.status} ${res.statusText}`);
			}
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				if (!isOauthWait(res.status, text)) {
					logger.warn(
						`tap ${method} ${tapUrl(url)} ${res.status} ${ms}ms${text ? ` ${text.slice(0, 160)}` : ""}`,
					);
				}
				return new Response(text, { status: res.status, headers: res.headers });
			}
			return res;
		} catch (err) {
			last = err;
			if (err instanceof TapApiError && /TapAPI \d+/.test(err.message)) {
				throw err;
			}
			const elapsed = Math.round(performance.now() - started);
			const retry =
				attempt < TAPAPI_MAX_ATTEMPTS &&
				timeoutMs - elapsed > 2_000 &&
				TAP_RETRY_METHODS.has(method) &&
				isRetryableTapNet(err);
			logger.warn(
				`tap ${method} ${tapUrl(url)} fail ${elapsed}ms try ${attempt}${retry ? " retry" : ""} ${errChain(err)}`,
			);
			if (!retry) break;
		}
	}
	throw toTapApiError(last);
}

function tapUrl(url: string | URL) {
	try {
		const u = typeof url === "string" ? new URL(url) : url;
		return `${u.host}${u.pathname}`;
	} catch {
		return String(url);
	}
}

function isOauthWait(status: number, body: string) {
	if (status !== 400 && status !== 401 && status !== 428) return false;
	return /authorization_pending|authorization_waiting|slow_down/i.test(body);
}

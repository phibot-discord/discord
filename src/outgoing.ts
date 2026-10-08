import {
	Agent,
	type Dispatcher,
	type HeadersInit,
	interceptors,
	setGlobalDispatcher,
	type RequestInit as UndiciRequestInit,
	fetch as undiciFetch,
} from "undici";

export const REQUEST_TIMEOUT_MS = 30_000;

export function socketTimeouts(
	ms = REQUEST_TIMEOUT_MS,
	connect?: Record<string, unknown>,
) {
	return {
		connectTimeout: ms,
		connect: { timeout: ms, ...connect },
	};
}

/** Undici ALPN-h2 against TapTap closes the stream with NGHTTP2_PROTOCOL_ERROR */
export const outgoingAgentDefaults = { allowH2: false as const };

/** Longest Retry-After the retry interceptor waits; past that the caller sees the 429/5xx */
export const RETRY_AFTER_CAP_MS = 2_000;

/**
 * Which layer retries: by default undici retries idempotent requests; "status" only 429/5xx
 * (tapFetch retries the rest); false none (cfFetch retries everything)
 */
export function outgoingAgent(
	opts?: ConstructorParameters<typeof Agent>[0],
	{ retry = true }: { retry?: boolean | "status" } = {},
): Dispatcher {
	const agent = new Agent({ ...outgoingAgentDefaults, ...opts });
	if (!retry) return agent;
	return agent.compose(
		interceptors.retry({
			maxRetries: 2,
			minTimeout: 100,
			maxTimeout: RETRY_AFTER_CAP_MS,
			methods: ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"],
			...(retry === "status" ? { errorCodes: [], throwOnError: false } : {}),
		}),
	);
}

const defaultAgent = outgoingAgent({
	connections: 16,
	pipelining: 1,
	keepAliveTimeout: 10_000,
	keepAliveMaxTimeout: 30_000,
	headersTimeout: REQUEST_TIMEOUT_MS,
	bodyTimeout: REQUEST_TIMEOUT_MS,
	...socketTimeouts(),
});

setGlobalDispatcher(defaultAgent);

export type OutgoingInit = {
	method?: string;
	headers?: HeadersInit;
	body?: RequestInit["body"] | Buffer | Uint8Array | string;
	signal?: AbortSignal | null;
	dispatcher?: Dispatcher;
};

/**
 * Use undici's `fetch` (not Next's, not `request()`)
 * Next.js `fetch` drops `dispatcher` (10s connect)
 * `request()` skips fetch headers and TapTap RST the socket ("other side closed")
 * Node `FormData` is not undici's brand — it is sent as the text `[object FormData]`
 */
export async function outgoingFetch(
	url: string | URL,
	init: OutgoingInit = {},
): Promise<Response> {
	const res = await undiciFetch(String(url), {
		method: init.method,
		headers: init.headers,
		body: init.body as UndiciRequestInit["body"],
		signal: init.signal ?? undefined,
		dispatcher: init.dispatcher ?? defaultAgent,
		redirect: "follow",
	});
	return res as unknown as Response;
}

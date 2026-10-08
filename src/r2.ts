import { cfFetch } from "./cf-fetch.ts";
import { logger } from "./logger.ts";

type CacheMode = "default" | "no-store";

export type R2Config = {
	accountId: string;
	apiToken: string;
	bucket: string;
	prefix: string;
	htmlPrefix: string;
	publicBase: string;
};

const mem = new Map<string, Buffer>();
const inflight = new Map<string, Promise<Buffer | undefined>>();
let memBytes = 0;
const MEM_MAX_BYTES = 256 * 1024 * 1024;
const missing = new Map<string, number>();
const MISSING_TTL_MS = 15 * 60 * 1000;
const MISSING_MAX = 4_000;

function knownMissing(key: string) {
	const until = missing.get(key);
	if (until == null) return false;
	if (until > Date.now()) return true;
	missing.delete(key);
	return false;
}

function rememberMissing(key: string) {
	missing.delete(key);
	missing.set(key, Date.now() + MISSING_TTL_MS);
	while (missing.size > MISSING_MAX) {
		const oldest = missing.keys().next().value;
		if (oldest === undefined) break;
		missing.delete(oldest);
	}
}

function normalizePublicBase(raw: string | undefined): string {
	const t = (raw || "").trim().replace(/\/+$/, "");
	if (!t) return "";
	if (/^https?:\/\//i.test(t)) return t;
	return `https://${t}`;
}

export function r2BucketName(raw = process.env.CLOUDFLARE_R2_BUCKET) {
	const t = raw?.trim() || "";
	if (t === "off" || t === "none") return "";
	if (!t || t === "[SENSITIVE]") return "phi-web-assets";
	return t;
}

export function r2Config(): R2Config {
	return {
		accountId: process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || "",
		apiToken: process.env.CLOUDFLARE_API_TOKEN?.trim() || "",
		bucket: r2BucketName(),
		prefix: (process.env.CLOUDFLARE_R2_ILL_PREFIX ?? "original_ill").replace(
			/\/+$/,
			"",
		),
		htmlPrefix: (process.env.CLOUDFLARE_R2_HTML_PREFIX ?? "html").replace(
			/\/+$/,
			"",
		),
		publicBase: normalizePublicBase(process.env.CLOUDFLARE_R2_PUBLIC_BASE),
	};
}

export function r2Ready(cfg = r2Config()): boolean {
	if (cfg.publicBase) return true;
	return r2WriteReady(cfg);
}

export function r2WriteReady(cfg = r2Config()): boolean {
	return Boolean(cfg.accountId && cfg.apiToken && cfg.bucket);
}

export function publicObjectUrl(
	key: string,
	cfg = r2Config(),
): string | undefined {
	if (!cfg.publicBase) return;
	const path = key
		.replace(/^\//, "")
		.split("/")
		.map(encodeURIComponent)
		.join("/");
	return `${cfg.publicBase}/${path}`;
}

function objectUrl(cfg: R2Config, key: string): string {
	return `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/r2/buckets/${encodeURIComponent(cfg.bucket)}/objects/${key
		.split("/")
		.map(encodeURIComponent)
		.join("/")}`;
}

function remember(key: string, buf: Buffer) {
	const prev = mem.get(key);
	if (prev) memBytes -= prev.byteLength;
	mem.delete(key);
	mem.set(key, buf);
	memBytes += buf.byteLength;
	while (memBytes > MEM_MAX_BYTES && mem.size > 1) {
		const oldest = mem.keys().next().value as string;
		const evicted = mem.get(oldest);
		mem.delete(oldest);
		if (evicted) memBytes -= evicted.byteLength;
	}
}

async function readPublic(
	cfg: R2Config,
	key: string,
): Promise<Buffer | false | undefined> {
	const url = publicObjectUrl(key, cfg);
	if (!url) return;
	const res = await cfFetch(url);
	if (res.ok) return Buffer.from(await res.arrayBuffer());
	if (res.status === 404) return false;
	logger.warn(`r2 public ${res.status} ${key}`);
	return undefined;
}

async function readApi(
	cfg: R2Config,
	key: string,
): Promise<Buffer | false | undefined> {
	if (!cfg.accountId || !cfg.apiToken || !cfg.bucket) return undefined;
	const res = await cfFetch(objectUrl(cfg, key), {
		headers: { Authorization: `Bearer ${cfg.apiToken}` },
	});
	if (res.ok) return Buffer.from(await res.arrayBuffer());
	if (res.status === 404) return false;
	logger.warn(`r2 get ${res.status} ${key}`);
	return undefined;
}

/** After a public-domain failure fall back to the API for a while, then try the fast path again */
let publicBrokenUntil = 0;
const PUBLIC_RETRY_MS = 60_000;

/** `false` = definitely absent (404), `undefined` = unknown/error */
async function loadR2Object(key: string): Promise<Buffer | false | undefined> {
	const cfg = r2Config();
	if (cfg.publicBase && Date.now() >= publicBrokenUntil) {
		try {
			const pub = await readPublic(cfg, key);
			if (Buffer.isBuffer(pub) || pub === false) return pub;
		} catch (err) {
			// Requests already in flight all fail together; report the outage once
			if (Date.now() >= publicBrokenUntil) {
				logger.warn(
					`r2 public paused ${PUBLIC_RETRY_MS / 1000}s: ${err instanceof Error ? err.message : err}`,
				);
			}
			publicBrokenUntil = Date.now() + PUBLIC_RETRY_MS;
		}
	}
	return readApi(cfg, key);
}

export type R2Stream = {
	body: ReadableStream<Uint8Array>;
	length?: number;
};

async function openStream(
	url: string,
	headers?: Record<string, string>,
): Promise<R2Stream | false | undefined> {
	// fetch inflates a compressed body, so its Content-Length would be the wrong
	// size: ask for the bytes as stored, and drop the length if they still come encoded
	const res = await cfFetch(url, {
		headers: { ...headers, "Accept-Encoding": "identity" },
		stream: true,
	});
	if (res.ok && res.body) {
		const encoding = (res.headers.get("content-encoding") || "identity")
			.trim()
			.toLowerCase();
		const length = Number(res.headers.get("content-length"));
		return {
			body: res.body,
			length:
				encoding === "identity" && Number.isFinite(length) && length > 0
					? length
					: undefined,
		};
	}
	await res.body?.cancel().catch(() => undefined);
	if (res.status === 404) return false;
	logger.warn(`r2 stream ${res.status} ${url.replace(/^.*\/objects\//, "")}`);
	return undefined;
}

/**
 * Large objects (Phira packs): the body is piped to the client instead of being
 * buffered, so a response is not held to the 4.5 MB function body limit
 */
export async function streamR2Object(
	key: string,
): Promise<R2Stream | undefined> {
	const k = key.replace(/^\//, "");
	if (knownMissing(k)) return undefined;
	const cfg = r2Config();
	const pub = publicObjectUrl(k, cfg);
	if (pub && Date.now() >= publicBrokenUntil) {
		try {
			const got = await openStream(pub);
			if (got === false) {
				rememberMissing(k);
				return undefined;
			}
			if (got) return got;
		} catch (err) {
			logger.warn(
				`r2 public stream failed: ${err instanceof Error ? err.message : err}`,
			);
		}
	}
	if (!r2WriteReady(cfg)) return undefined;
	const got = await openStream(objectUrl(cfg, k), {
		Authorization: `Bearer ${cfg.apiToken}`,
	});
	if (got === false) rememberMissing(k);
	return got || undefined;
}

export async function fetchR2Object(
	key: string,
	opts: { cache?: CacheMode; negative?: boolean } = {},
): Promise<Buffer | undefined> {
	const k = key.replace(/^\//, "");
	const noStore = opts.cache === "no-store";
	const negative = opts.negative !== false;
	if (!noStore) {
		const hot = mem.get(k);
		if (hot) {
			remember(k, hot);
			return hot;
		}
	}
	if (negative && knownMissing(k)) return undefined;
	const pending = inflight.get(k);
	if (pending) return pending;
	const job = loadR2Object(k)
		.then((buf) => {
			if (buf === false) {
				if (negative) rememberMissing(k);
				return undefined;
			}
			if (buf?.byteLength && !noStore) remember(k, buf);
			return buf;
		})
		.finally(() => inflight.delete(k));
	inflight.set(k, job);
	return job;
}

export async function putR2Object(
	key: string,
	body: Buffer,
	contentType = "application/octet-stream",
	extra: {
		contentDisposition?: string;
		cache?: CacheMode;
		/** Best-effort cache write: no backoff on 429/5xx */
		background?: boolean;
	} = {},
): Promise<void> {
	const cfg = r2Config();
	if (!r2WriteReady(cfg)) {
		throw new Error("R2 write is not configured");
	}
	const k = key.replace(/^\//, "");
	const headers: Record<string, string> = {
		Authorization: `Bearer ${cfg.apiToken}`,
		"Content-Type": contentType,
	};
	if (extra.contentDisposition) {
		headers["Content-Disposition"] = extra.contentDisposition;
	}
	const res = await cfFetch(objectUrl(cfg, k), {
		method: "PUT",
		headers,
		body,
		background: extra.background,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`R2 PUT ${k} failed: ${res.status} ${text}`.slice(0, 500));
	}
	missing.delete(k);
	if (extra.cache !== "no-store") remember(k, body);
}

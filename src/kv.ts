import { readFileSync } from "node:fs";
import { runInBackground } from "./background.ts";
import { cfFetch } from "./cf-fetch.ts";
import { logger } from "./logger.ts";
import type { Kv } from "./sdk/index.ts";

type KvSetOptions = {
	ttlMs?: number;
	nx?: boolean;
	/** Best-effort cache write: no backoff on 429/5xx */
	background?: boolean;
};
type KvIncrOptions = {
	ttlMs?: number;
	blocking?: boolean;
};
type Envelope = { d: string; e?: number };

export type KvConfig = {
	accountId: string;
	namespaceId: string;
	apiToken: string;
};

export type KvStore = {
	get: (key: string) => Promise<string | null>;
	set: (
		key: string,
		value: unknown,
		options?: KvSetOptions,
	) => Promise<string | null>;
	del: (...keys: Array<string | string[]>) => Promise<number>;
	keys: (pattern?: string) => Promise<string[]>;
	incr: (key: string, options?: KvIncrOptions) => Promise<number>;
	expire: (key: string, seconds: number) => Promise<number>;
	ttlMs: (key: string) => Promise<number>;
};

export type KvBundle = {
	store: KvStore;
	db: Kv;
};

const CF_MIN_TTL_SEC = 60;

function asString(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value);
}

function parseEnvelope(raw: string): Envelope {
	if (raw.startsWith("{")) {
		try {
			const parsed = JSON.parse(raw) as { d?: unknown; e?: unknown };
			if (typeof parsed.d === "string") {
				return {
					d: parsed.d,
					e: typeof parsed.e === "number" ? parsed.e : undefined,
				};
			}
		} catch {
			/* raw string */
		}
	}
	return { d: raw };
}

function encodeEnvelope(env: Envelope): string {
	return JSON.stringify(env);
}

function alive(env: Envelope | undefined, now = Date.now()): env is Envelope {
	if (!env) return false;
	return env.e == null || env.e > now;
}

function remainingMs(env: Envelope | undefined, now = Date.now()): number {
	if (!env) return -2;
	if (env.e == null) return -1;
	const n = env.e - now;
	return n > 0 ? n : -2;
}

function globToPrefix(pattern: string): string {
	const star = pattern.indexOf("*");
	return star === -1 ? pattern : pattern.slice(0, star);
}

function globToRegExp(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`);
}

export type RemoteKv = {
	label: string;
	getRaw: (key: string) => Promise<string | undefined>;
	putRaw: (
		key: string,
		value: string,
		ttlSec?: number,
		opts?: { background?: boolean },
	) => Promise<void>;
	delRaw: (key: string, opts?: { background?: boolean }) => Promise<void>;
	listRaw: (prefix: string) => Promise<string[]>;
	ping: () => Promise<void>;
};

function restRemote(cfg: KvConfig): RemoteKv {
	const accountId = cfg.accountId.trim();
	const namespaceId = cfg.namespaceId.trim();
	const apiToken = cfg.apiToken.trim();
	if (!accountId || !namespaceId || !apiToken) {
		throw new Error(
			"Cloudflare KV is not configured. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID, and CLOUDFLARE_API_TOKEN.",
		);
	}
	const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
	const headers = { Authorization: `Bearer ${apiToken}` };

	return {
		label: namespaceId,
		getRaw: async (key) => {
			const res = await cfFetch(`${base}/values/${encodeURIComponent(key)}`, {
				headers,
			});
			if (res.status === 404) return undefined;
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new Error(
					`KV GET ${key} failed: ${res.status} ${text}`.slice(0, 500),
				);
			}
			return (await res.text()) || undefined;
		},
		putRaw: async (key, value, ttlSec, opts) => {
			const url = ttlSec
				? `${base}/values/${encodeURIComponent(key)}?expiration_ttl=${ttlSec}`
				: `${base}/values/${encodeURIComponent(key)}`;
			const res = await cfFetch(url, {
				method: "PUT",
				headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
				body: value,
				background: opts?.background,
			});
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new Error(
					`KV PUT ${key} failed: ${res.status} ${text}`.slice(0, 500),
				);
			}
		},
		delRaw: async (key, opts) => {
			const res = await cfFetch(`${base}/values/${encodeURIComponent(key)}`, {
				method: "DELETE",
				headers,
				background: opts?.background,
			});
			if (!res.ok && res.status !== 404) {
				const text = await res.text().catch(() => "");
				throw new Error(
					`KV DELETE ${key} failed: ${res.status} ${text}`.slice(0, 500),
				);
			}
		},
		listRaw: async (prefix) => {
			const names: string[] = [];
			let cursor = "";
			for (;;) {
				const params = new URLSearchParams({ limit: "1000" });
				if (prefix) params.set("prefix", prefix);
				if (cursor) params.set("cursor", cursor);
				const res = await cfFetch(`${base}/keys?${params}`, { headers });
				if (!res.ok) {
					const text = await res.text().catch(() => "");
					throw new Error(
						`KV LIST failed: ${res.status} ${text}`.slice(0, 500),
					);
				}
				const body = (await res.json()) as {
					success?: boolean;
					result?: { name: string }[];
					result_info?: { cursor?: string };
				};
				if (!body.success) throw new Error("KV LIST failed");
				for (const item of body.result || []) names.push(item.name);
				const next = body.result_info?.cursor;
				if (!next) break;
				cursor = next;
			}
			return names;
		},
		ping: async () => {
			const res = await cfFetch(`${base}/keys?limit=10`, { headers });
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new Error(`KV ping failed: ${res.status} ${text}`.slice(0, 400));
			}
		},
	};
}

type OverlayEntry = { env: Envelope; at: number; write: boolean };

const OVERLAY_MAX = 1_000;
const OVERLAY_MAX_AGE_MS = 60_000;
const OVERLAY_WRITE_MS = 5_000;
const MISS_TTL_MS = 3_000;
/** Bans are rare and set by the bot; a missing ban key is trusted for a minute */
const BAN_MISS_TTL_MS = 60_000;
const BAN_KEY = /:banSessionToken:/;
const MISS_MAX = 2_000;
const BIND_KEY =
	/:userToken:|:save:|:notes:|:hisb30:|:history:|:manualSave:|:webShare/;

/** Dev only: `PHI_LOCAL_DATA=1` swaps Cloudflare KV for an in-memory store */
export function localDataMode(): boolean {
	return (
		process.env.PHI_LOCAL_DATA === "1" && process.env.NODE_ENV !== "production"
	);
}

/** Dev-only in-memory KV with one bound user, seeded from PHI_LOCAL_SAVE */
function localRemote(): RemoteKv {
	const mem = new Map<string, string>();
	const uid = process.env.PHI_LOCAL_UID?.trim() || "local-dev";
	const token = "localdevtoken000000000000";
	const savePath = process.env.PHI_LOCAL_SAVE?.trim() || "data/raw-save.json";
	try {
		mem.set(
			`phi:save:${token}`,
			readFileSync(/*turbopackIgnore: true*/ savePath, "utf8"),
		);
		mem.set(`phi:userToken:${uid}`, token);
	} catch (err) {
		logger.warn(
			`local kv: no save at ${savePath} (${err instanceof Error ? err.message : err})`,
		);
	}
	return {
		label: "local",
		getRaw: async (key) => mem.get(key),
		putRaw: async (key, value) => {
			mem.set(key, value);
		},
		delRaw: async (key) => {
			mem.delete(key);
		},
		listRaw: async (prefix) =>
			[...mem.keys()].filter((k) => k.startsWith(prefix)),
		ping: async () => {},
	};
}

/** No ping on connect: a KV LIST per cold start is a wasted API call; the first read reports problems */
export async function connectKv(
	cfg: KvConfig,
	remote: (cfg: KvConfig) => RemoteKv = restRemote,
): Promise<KvBundle> {
	if (localDataMode()) {
		logger.warn("kv: PHI_LOCAL_DATA=1, using the in-memory dev store");
		return createKv(localRemote());
	}
	return createKv(remote(cfg));
}

export function createKv(remote: RemoteKv): KvBundle & { label: string } {
	const overlay = new Map<string, OverlayEntry>();
	const knownMissing = new Map<string, number>();
	const writeTail = new Map<string, Promise<unknown>>();
	const readInflight = new Map<string, Promise<Envelope | undefined>>();

	const evictOldest = (map: Map<string, unknown>, max: number) => {
		while (map.size > max) {
			const oldest = map.keys().next().value;
			if (oldest === undefined) break;
			map.delete(oldest);
		}
	};
	const missFresh = (key: string) => {
		const until = knownMissing.get(key);
		if (until == null) return false;
		if (until > Date.now()) return true;
		knownMissing.delete(key);
		return false;
	};
	const markMiss = (key: string) => {
		if (/:userToken:|:save:/.test(key)) return;
		knownMissing.delete(key);
		knownMissing.set(
			key,
			Date.now() + (BAN_KEY.test(key) ? BAN_MISS_TTL_MS : MISS_TTL_MS),
		);
		evictOldest(knownMissing, MISS_MAX);
	};
	const clearMiss = (key: string) => {
		knownMissing.delete(key);
	};
	const remember = (key: string, env: Envelope, write: boolean) => {
		overlay.delete(key);
		overlay.set(key, { env, at: Date.now(), write });
		evictOldest(overlay, OVERLAY_MAX);
	};
	const rememberWrite = (key: string, env: Envelope) => {
		remember(key, env, true);
		clearMiss(key);
	};
	const forget = (key: string) => {
		overlay.delete(key);
	};
	const overlayFresh = (key: string, entry: OverlayEntry, now: number) => {
		if (!alive(entry.env, now)) return false;
		const age = now - entry.at;
		if (entry.write && age < OVERLAY_WRITE_MS) return true;
		return !BIND_KEY.test(key) && age < OVERLAY_MAX_AGE_MS;
	};

	const enqueue = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
		const prev = writeTail.get(key) ?? Promise.resolve();
		const next = prev.then(fn, fn);
		const tail: Promise<unknown> = next.then(
			() => undefined,
			() => undefined,
		);
		writeTail.set(key, tail);
		void tail.then(() => {
			if (writeTail.get(key) === tail) writeTail.delete(key);
		});
		return next;
	};

	const putRemote = async (
		key: string,
		envl: Envelope,
		opts?: { background?: boolean },
	) => {
		const ttlSec =
			envl.e != null
				? Math.max(CF_MIN_TTL_SEC, Math.ceil((envl.e - Date.now()) / 1000))
				: undefined;
		await remote.putRaw(key, encodeEnvelope(envl), ttlSec, opts);
	};

	const delRemote = (key: string, opts?: { background?: boolean }) =>
		remote.delRaw(key, opts);

	const getRemote = async (key: string): Promise<Envelope | undefined> => {
		const pending = readInflight.get(key);
		if (pending) return pending;
		const job = (async () => {
			const raw = await remote.getRaw(key);
			if (!raw) return undefined;
			const envl = parseEnvelope(raw);
			if (!alive(envl)) {
				forget(key);
				markMiss(key);
				delRemote(key, { background: true }).catch(() => undefined);
				return undefined;
			}
			clearMiss(key);
			if (!BIND_KEY.test(key)) remember(key, envl, false);
			return envl;
		})().finally(() => readInflight.delete(key));
		readInflight.set(key, job);
		return job;
	};

	const listRemote = (prefix: string) => remote.listRaw(prefix);

	const read = async (key: string): Promise<Envelope | undefined> => {
		if (missFresh(key)) return undefined;
		const local = overlay.get(key);
		if (local) {
			if (overlayFresh(key, local, Date.now())) return local.env;
			forget(key);
		}
		const env = await getRemote(key);
		if (!env) markMiss(key);
		return env;
	};

	const write = async (
		key: string,
		value: unknown,
		options?: KvSetOptions,
	): Promise<string | null> => {
		const ttlMs = options?.ttlMs;
		const env: Envelope = {
			d: asString(value),
			e: ttlMs != null ? Date.now() + ttlMs : undefined,
		};
		return enqueue(key, async () => {
			if (options?.nx) {
				const existing = await read(key);
				if (existing) return null;
			}
			rememberWrite(key, env);
			try {
				await putRemote(key, env, { background: options?.background });
			} catch (err) {
				forget(key);
				throw err;
			}
			return "OK";
		});
	};

	const get = async (key: string): Promise<string | null> => {
		const env = await read(key);
		return env ? env.d : null;
	};

	const del = async (...keys: Array<string | string[]>): Promise<number> => {
		const flat = keys.flat().filter(Boolean);
		let n = 0;
		for (const key of flat) {
			forget(key);
			markMiss(key);
			await enqueue(key, () => delRemote(key));
			n += 1;
		}
		return n;
	};

	const keys = async (pattern = "*"): Promise<string[]> => {
		const re = globToRegExp(pattern);
		const prefix = globToPrefix(pattern);
		const listed = await listRemote(prefix === "*" ? "" : prefix);
		const names = new Set<string>(listed.filter((name) => re.test(name)));
		const now = Date.now();
		for (const [key, entry] of overlay) {
			if (!alive(entry.env, now)) {
				forget(key);
				continue;
			}
			if (re.test(key)) names.add(key);
		}
		return [...names];
	};

	const store: KvStore = {
		get,
		set: write,
		del,
		keys,
		incr: async (key, options = {}) => {
			const bump = (env: Envelope | undefined): Envelope => ({
				d: String(Number(env?.d || 0) + 1),
				e:
					env?.e ??
					(options.ttlMs != null ? Date.now() + options.ttlMs : undefined),
			});
			if (options.blocking !== false) {
				return enqueue(key, async () => {
					const next = bump(await read(key));
					rememberWrite(key, next);
					try {
						await putRemote(key, next);
					} catch (err) {
						forget(key);
						throw err;
					}
					return Number(next.d);
				});
			}
			const now = Date.now();
			let local = overlay.get(key);
			if (!local || !overlayFresh(key, local, now)) {
				await read(key);
				local = overlay.get(key);
			}
			const next = bump(local && alive(local.env, now) ? local.env : undefined);
			rememberWrite(key, next);
			runInBackground(
				enqueue(key, async () => {
					try {
						await putRemote(key, next, { background: true });
					} catch (err) {
						forget(key);
						throw err;
					}
				}),
				(err) =>
					logger.warn(
						`kv incr ${key} deferred write failed: ${err instanceof Error ? err.message : err}`,
					),
			);
			return Number(next.d);
		},
		expire: async (key, seconds) => {
			const env = await read(key);
			if (!env) return 0;
			await write(key, env.d, { ttlMs: seconds * 1000 });
			return 1;
		},
		ttlMs: async (key) => remainingMs(await read(key)),
	};

	const db: Kv = {
		get: async (key) => (await get(key)) ?? undefined,
		set: async (key, value, ttlMs) => {
			await write(key, value, ttlMs ? { ttlMs } : undefined);
		},
		del: async (key) => {
			await del(key);
		},
		keys: (prefix = "") => keys(prefix ? `${prefix}*` : "*"),
		ping: async () => {
			await remote.ping();
			return "PONG";
		},
		close: async () => undefined,
	};

	return { store, db, label: remote.label };
}

import { createHash } from "node:crypto";
import { kvKey } from "../plugins/phi/lib/const.ts";
import { runInBackground } from "./background.ts";
import { parseCachedHeight } from "./card-image-cache.ts";
import type { KvStore } from "./kv.ts";
import { logger } from "./logger.ts";
import { fetchR2Object, putR2Object, r2WriteReady } from "./r2.ts";

const CARD_TTL_MS = 6 * 60 * 60 * 1000;
const CARD_R2_PREFIX = "web-cards";

const pngBufferCache = new Map<string, Buffer>();
const PNG_BUFFER_CACHE_BYTES = 64 * 1024 * 1024;
let pngBufferBytes = 0;
const heightMem = new Map<string, number>();
const HEIGHT_MEM_MAX = 200;

function rememberPng(key: string, bytes: Buffer) {
	const prev = pngBufferCache.get(key);
	if (prev) pngBufferBytes -= prev.byteLength;
	pngBufferCache.delete(key);
	pngBufferCache.set(key, bytes);
	pngBufferBytes += bytes.byteLength;
	while (pngBufferBytes > PNG_BUFFER_CACHE_BYTES && pngBufferCache.size > 1) {
		const oldest = pngBufferCache.keys().next().value;
		if (oldest === undefined) break;
		const evicted = pngBufferCache.get(oldest);
		pngBufferCache.delete(oldest);
		if (evicted) pngBufferBytes -= evicted.byteLength;
	}
}

function rememberHeightMem(id: string, height: number) {
	heightMem.delete(id);
	if (heightMem.size >= HEIGHT_MEM_MAX) {
		const oldest = heightMem.keys().next().value;
		if (oldest !== undefined) heightMem.delete(oldest);
	}
	heightMem.set(id, height);
}

function heightCacheKey(id: string) {
	return kvKey("cardHeight", id);
}

export async function readCachedHeight(
	store: PngStore["store"],
	id: string,
): Promise<number | undefined> {
	const hot = heightMem.get(id);
	if (hot) return hot;
	try {
		const n = parseCachedHeight(await store.get(heightCacheKey(id)));
		if (n) rememberHeightMem(id, n);
		return n;
	} catch (err) {
		logger.warn(
			`height cache read skipped: ${err instanceof Error ? err.message : err}`,
		);
		return undefined;
	}
}

async function persistHeight(
	store: PngStore["store"],
	id: string,
	height: number,
) {
	try {
		await store.set(heightCacheKey(id), String(height), {
			ttlMs: CARD_TTL_MS,
			background: true,
		});
	} catch (err) {
		logger.warn(
			`height cache write skipped: ${err instanceof Error ? err.message : err}`,
		);
	}
}

export async function writeCachedHeight(
	store: PngStore["store"],
	id: string,
	height: number,
): Promise<void> {
	const n = parseCachedHeight(height);
	if (!n) return;
	rememberHeightMem(id, n);
	runInBackground(persistHeight(store, id, n));
}

export function cardEtag(parts: string[]): string {
	return createHash("sha256")
		.update(parts.join("|"))
		.digest("hex")
		.slice(0, 24);
}

export function cacheKey(kind: string, userId: string, etag: string): string {
	return kvKey("webCard", "png", kind, userId, etag);
}

type PngStore = { store: KvStore };

function r2CardKey(key: string) {
	return `${CARD_R2_PREFIX}/${key}.jpg`;
}

export function cardDownloadFilename(kind: string): string {
	return `${kind.replace(/[^\w.-]+/g, "_")}.jpg`;
}

export function cardFilenameFromCacheKey(key: string): string {
	return cardDownloadFilename(key.split(":")[3] || "card");
}

export type CachedCard = { bytes: Buffer; store: "mem" | "r2" | "kv" };

export function durableCardStore(store: CachedCard["store"]): "r2" | "kv" {
	if (store === "kv") return "kv";
	if (store === "r2") return "r2";
	return r2WriteReady() ? "r2" : "kv";
}

export type CardCacheOpts = { durable?: boolean };

export async function readCachedPng(
	host: PngStore,
	key: string,
	opts: CardCacheOpts = {},
): Promise<CachedCard | undefined> {
	const hot = pngBufferCache.get(key);
	if (hot) {
		rememberPng(key, hot);
		return { bytes: hot, store: "mem" };
	}
	if (opts.durable === false) return undefined;
	if (r2WriteReady()) {
		const buf = await fetchR2Object(r2CardKey(key), {
			cache: "no-store",
			negative: false,
		});
		if (buf?.byteLength) {
			rememberPng(key, buf);
			return { bytes: buf, store: "r2" };
		}
		return undefined;
	}
	const raw = await host.store.get(key);
	if (!raw) return undefined;
	const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "base64");
	rememberPng(key, bytes);
	return { bytes, store: "kv" };
}

async function persistPng(host: PngStore, key: string, bytes: Buffer) {
	try {
		if (r2WriteReady()) {
			await putR2Object(r2CardKey(key), bytes, "image/jpeg", {
				contentDisposition: `attachment; filename="${cardFilenameFromCacheKey(key)}"`,
				cache: "no-store",
				background: true,
			});
			return;
		}
		await host.store.set(key, bytes.toString("base64"), {
			ttlMs: CARD_TTL_MS,
			background: true,
		});
	} catch (err) {
		logger.warn(
			`card cache write skipped: ${err instanceof Error ? err.message : err}`,
		);
	}
}

export async function writeCachedPng(
	host: PngStore,
	key: string,
	bytes: Buffer,
	opts: CardCacheOpts = {},
): Promise<void> {
	rememberPng(key, bytes);
	if (opts.durable === false) return;
	runInBackground(persistPng(host, key, bytes));
}

import type { ImageSource, Node } from "@takumi-rs/core";
import { extractEmojis } from "takumi-js/helpers/emoji";

/** One emoji SVG is a few KB; jsdelivr answers in well under a second when it is up */
const FETCH_TIMEOUT_MS = 3_000;
/** Noto emoji SVGs are 1–30 KB; a body past this is not an emoji */
const MAX_BYTES = 128 * 1024;
/** A failed URL is not retried on every render, only after this */
const RETRY_MS = 10 * 60_000;
const CACHE_MAX = 512;
/** Fetched bytes kept in total; one card's emoji are well under 1 MB */
const CACHE_MAX_BYTES = 8 * 1024 * 1024;

export type FetchImage = (url: string) => Promise<Uint8Array | undefined>;

type Entry = {
	at: number;
	failed: boolean;
	/** Counted against `CACHE_MAX_BYTES` once the bytes arrive */
	size: number;
	bytes: Promise<Uint8Array | undefined>;
};

const cache = new Map<string, Entry>();
let cachedBytes = 0;

function isRemote(src: unknown): src is string {
	return typeof src === "string" && /^https?:\/\//i.test(src);
}

function startsWith(bytes: Uint8Array, sig: number[], at = 0) {
	return sig.every((v, i) => bytes[at + i] === v);
}

/** Is it a decodable image (PNG, JPEG, GIF, WebP signature or a complete SVG)? */
export function looksLikeImage(bytes: Uint8Array): boolean {
	if (!bytes.byteLength) return false;
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return true;
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return true;
	if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return true;
	if (
		startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
	)
		return true;
	// TextDecoder drops a leading BOM
	const text = new TextDecoder().decode(bytes).trim();
	return (
		/^<(svg[\s>]|\?xml|!--)/i.test(text) &&
		/<svg[\s>]/i.test(text) &&
		/<\/svg>$/i.test(text)
	);
}

/** The body, or undefined once it passes `max` bytes (without buffering the rest) */
async function readCapped(
	res: Response,
	max: number,
): Promise<Uint8Array | undefined> {
	const reader = res.body?.getReader();
	if (!reader) return;
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel().catch(() => {});
			return;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.byteLength;
	}
	return out;
}

/** Only an `image/*` answer within `MAX_BYTES` counts; anything else is a miss */
export async function fetchImage(url: string): Promise<Uint8Array | undefined> {
	try {
		const res = await fetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		const type = res.headers.get("content-type") ?? "";
		const length = Number(res.headers.get("content-length"));
		if (!res.ok || !/^image\//i.test(type) || length > MAX_BYTES) {
			await res.body?.cancel().catch(() => {});
			return;
		}
		return await readCapped(res, MAX_BYTES);
	} catch {
		return;
	}
}

function remove(url: string) {
	const entry = cache.get(url);
	if (!entry) return;
	cachedBytes -= entry.size;
	cache.delete(url);
}

function trim() {
	for (const url of cache.keys()) {
		if (cache.size <= CACHE_MAX && cachedBytes <= CACHE_MAX_BYTES) break;
		remove(url);
	}
}

/**
 * Bytes for a remote image, fetched once per process and shared by concurrent
 * renders. Bytes that do not look like an image are treated as a failed fetch
 */
export function remoteImageBytes(
	url: string,
	fetchOne: FetchImage = fetchImage,
	now = Date.now(),
): Promise<Uint8Array | undefined> {
	const hit = cache.get(url);
	if (hit && !(hit.failed && now - hit.at >= RETRY_MS)) {
		cache.delete(url);
		cache.set(url, hit);
		return hit.bytes;
	}
	const entry: Entry = {
		at: now,
		failed: false,
		size: 0,
		bytes: fetchOne(url).then(
			(bytes) => (bytes && looksLikeImage(bytes) ? bytes : undefined),
			() => undefined,
		),
	};
	void entry.bytes.then((bytes) => {
		if (!bytes) {
			entry.failed = true;
			return;
		}
		if (cache.get(url) !== entry) return;
		entry.size = bytes.byteLength;
		cachedBytes += entry.size;
		trim();
	});
	remove(url);
	cache.set(url, entry);
	trim();
	return entry.bytes;
}

/** Treat these URLs as failed fetches (e.g. Takumi could not decode them) */
export function markRemoteImagesFailed(
	urls: Iterable<string>,
	now = Date.now(),
) {
	for (const url of urls) {
		remove(url);
		cache.set(url, {
			at: now,
			failed: true,
			size: 0,
			bytes: Promise.resolve(undefined),
		});
	}
	trim();
}

export function clearRemoteImageCache() {
	cache.clear();
	cachedBytes = 0;
}

/** Entry count and counted bytes, for tests */
export function remoteImageCacheSize() {
	return { entries: cache.size, bytes: cachedBytes };
}

/** Cheap pre-check on the HTML: without a pictographic character there is no emoji to extract */
export function mayHaveEmoji(html: string): boolean {
	return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(html);
}

/** `<img>` srcs over http(s). Emoji become such images once `extractEmojis` ran */
export function remoteImageUrls(node: Node): string[] {
	const out = new Set<string>();
	const walk = (n: Node) => {
		if (n.type === "image") {
			if (isRemote(n.src)) out.add(n.src);
		} else if (n.type === "container") {
			for (const child of n.children ?? []) if (child) walk(child);
		}
	};
	walk(node);
	return [...out];
}

/** The tree without the remote `<img>`s in `gone` */
export function dropRemoteImages(node: Node, gone: Set<string>): Node {
	if (node.type !== "container" || !node.children) return node;
	return {
		...node,
		children: node.children
			.filter(
				(c) => !(c?.type === "image" && isRemote(c.src) && gone.has(c.src)),
			)
			.map((c) => (c ? dropRemoteImages(c, gone) : c)),
	};
}

/** Fetch emoji SVGs before the raster lock; an unfetchable one is left out, never fails the render */
export async function withRemoteImages(
	tree: Node,
	opts: { emoji?: boolean; fetchOne?: FetchImage } = {},
): Promise<{ node: Node; images: ImageSource[] }> {
	const fetchOne = opts.fetchOne ?? fetchImage;
	const node =
		opts.emoji === false ? tree : (extractEmojis(tree, "noto") as Node);
	const urls = remoteImageUrls(node);
	if (!urls.length) return { node, images: [] };
	const fetched = await Promise.all(
		urls.map(async (src) => ({
			src,
			data: await remoteImageBytes(src, fetchOne),
		})),
	);
	const images: ImageSource[] = [];
	const gone = new Set<string>();
	for (const { src, data } of fetched) {
		if (data) images.push({ src, data });
		else gone.add(src);
	}
	return { node: gone.size ? dropRemoteImages(node, gone) : node, images };
}

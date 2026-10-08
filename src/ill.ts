import { existsSync as fsExists } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { logger } from "./logger.ts";
import { illDir } from "./paths.ts";
import { fetchR2Object, r2Config } from "./r2.ts";

const CACHE_ROOT = process.env.PHI_ILL_CACHE?.trim() || "/tmp/phi-web-ill";
const ILL_FETCH_CONCURRENCY = 48;

async function poolAll<T>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<void>,
) {
	if (!items.length) return;
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			for (;;) {
				const i = next++;
				if (i >= items.length) return;
				await fn(items[i]!);
			}
		}),
	);
}

function pngName(id: string): string {
	return id.replace(/\.0$/, ".png");
}

export function songIllPath(
	originalIll: string,
	id: string,
	kind: "common" | "blur" | "low" = "common",
	sp = false,
): string {
	const png = pngName(id);
	if (sp) return join(originalIll, "SP", png);
	if (kind === "blur") return join(originalIll, "illBlur", png);
	if (kind === "low") return join(originalIll, "illLow", png);
	return join(originalIll, "ill", png);
}

export function chapIllPath(originalIll: string, name: string): string {
	return join(originalIll, "chap", `${name}.png`);
}

function underIllTree(absPath: string): string | undefined {
	const ill = illDir().replace(/\\/g, "/");
	const n = absPath.replace(/\\/g, "/");
	if (n === ill || n.startsWith(`${ill}/`))
		return n.slice(ill.length).replace(/^\//, "");
	const marker = "/original_ill/";
	const i = n.indexOf(marker);
	if (i >= 0) return n.slice(i + marker.length);
	return undefined;
}

const HTML_IMAGE_RE = /\/html\/((?:avatar|otherimg)\/[^/]+)$/;

function decodeEntities(s: string): string {
	return s.replace(
		/&(amp|#38|#x26|#39|#x27|quot|#34|lt|gt);/gi,
		(_m, e: string) =>
			(
				({
					amp: "&",
					"#38": "&",
					"#x26": "&",
					"#39": "'",
					"#x27": "'",
					quot: '"',
					"#34": '"',
					lt: "<",
					gt: ">",
				}) as Record<string, string>
			)[e.toLowerCase()] ?? _m,
	);
}

export function assetKeyOf(rawPath: string): string | undefined {
	const absPath = decodeEntities(rawPath);
	const ill = underIllTree(absPath);
	if (ill) {
		const prefix = r2Config().prefix;
		return prefix ? `${prefix}/${ill}` : ill;
	}
	const html = HTML_IMAGE_RE.exec(absPath.replace(/\\/g, "/"))?.[1];
	if (html) return `${r2Config().htmlPrefix}/${html}`;
	return undefined;
}

export function fallbackKeyOf(key: string): string | undefined {
	const { prefix, htmlPrefix } = r2Config();
	const illBase = prefix ? `${prefix}/ill/` : "ill/";
	if (key.startsWith(illBase)) {
		return `${prefix ? `${prefix}/` : ""}illLow/${key.slice(illBase.length)}`;
	}
	const avatarBase = `${htmlPrefix}/avatar/`;
	const defaultAvatar = `${avatarBase}Introduction.png`;
	if (key.startsWith(avatarBase) && key !== defaultAvatar) return defaultAvatar;
	return undefined;
}

async function fetchBytes(key: string): Promise<Buffer | undefined> {
	const buf = await fetchR2Object(key, { cache: "no-store" });
	if (buf?.byteLength) return buf;
	return undefined;
}

function diskPath(key: string) {
	return join(/*turbopackIgnore: true*/ CACHE_ROOT, key);
}

type Located = { dest: string; fetched: boolean };
const locating = new Map<string, Promise<Located | undefined>>();

/** Write via a temp name + rename so a concurrent reader never sees a partial file */
async function writeAtomic(dest: string, buf: Buffer) {
	await mkdir(/*turbopackIgnore: true*/ dirname(dest), { recursive: true });
	const tmp = `${dest}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	await writeFile(/*turbopackIgnore: true*/ tmp, buf);
	await rename(/*turbopackIgnore: true*/ tmp, dest);
}

/** Path of the cached file for R2 `key`, downloading it once (then its fallback) */
function locateAsset(key: string): Promise<Located | undefined> {
	const pending = locating.get(key);
	if (pending) return pending;
	const job = (async () => {
		const candidates = [key, fallbackKeyOf(key)].filter((k): k is string =>
			Boolean(k),
		);
		for (const candidate of candidates) {
			const dest = diskPath(candidate);
			if (fsExists(/*turbopackIgnore: true*/ dest))
				return { dest, fetched: false };
			const buf = await fetchBytes(candidate);
			if (!buf) continue;
			await writeAtomic(dest, buf);
			return { dest, fetched: true };
		}
		logger.warn(`asset r2 miss ${key}`);
		return undefined;
	})().finally(() => locating.delete(key));
	locating.set(key, job);
	return job;
}

/** One pass over the HTML for all path rewrites (instead of one split/join per jacket) */
export function applyIllPaths(html: string, map: Map<string, string>): string {
	const froms = [...map.keys()].filter((from) => from !== map.get(from));
	if (!froms.length) return html;
	const re = new RegExp(
		froms
			.sort((a, b) => b.length - a.length)
			.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
			.join("|"),
		"g",
	);
	return html.replace(re, (hit) => map.get(hit) ?? hit);
}

/** Start downloading images before they are needed (runs while other card data is fetched) */
export function prefetchIlls(paths: Array<string | undefined>): void {
	const wanted = paths.filter((p): p is string => Boolean(p));
	if (!wanted.length) return;
	void hydrateIlls(wanted).catch(() => undefined);
}

/** Template image path → local disk path, pulling jackets / avatars / icons from R2 on first use */
export async function hydrateIlls(
	paths: string[],
	concurrency = ILL_FETCH_CONCURRENCY,
): Promise<Map<string, string>> {
	const mapped = new Map<string, string>();
	const wanted: Array<[path: string, key: string]> = [];
	for (const p of new Set(paths)) {
		const key = p ? assetKeyOf(p) : undefined;
		if (!key) continue;
		// A local copy (git clone of the jackets, bundled icons) wins; R2 only fills what is missing
		const local = decodeEntities(p);
		if (fsExists(local)) {
			if (local !== p) mapped.set(p, local);
			continue;
		}
		wanted.push([p, key]);
	}
	if (!wanted.length) return mapped;
	const started = performance.now();
	let hits = 0;
	let fetched = 0;
	await poolAll(wanted, concurrency, async ([path, key]) => {
		const hit = await locateAsset(key);
		if (!hit) return;
		mapped.set(path, hit.dest);
		hits += 1;
		if (hit.fetched) fetched += 1;
	});
	if (fetched) {
		logger.ok(
			`assets ${hits}/${wanted.length} (${fetched} fetched) in ${Math.round(performance.now() - started)}ms → ${CACHE_ROOT}`,
		);
	} else if (!hits) logger.warn(`assets miss ${wanted.length}`);
	return mapped;
}

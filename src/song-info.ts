import {
	existsSync as fsExists,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getInfo } from "../plugins/phi/lib/get-info.ts";
import {
	INFO_FILE_KV_KEY,
	type InfoFileCache,
	parseInfoFileCache,
} from "../plugins/phi/lib/info-file.ts";
import { applyPhiVersion } from "../plugins/phi/lib/version.ts";
import { runInBackground } from "./background.ts";
import { logger } from "./logger.ts";
import { assetsDir } from "./paths.ts";
import { fetchR2Object, r2Ready } from "./r2.ts";
import { mountBytes } from "./vfs.ts";

export const INFO_STATE_KEY = "_sync/info.json";
const INFO_FILES = [
	"avatar.txt",
	"chaplist.yaml",
	"info.csv",
	"infolist.json",
	"nicklist.yaml",
	"notesInfo.json",
	"spinfo.json",
	"tips.txt",
] as const;

const CACHE_ROOT = process.env.PHI_INFO_CACHE?.trim() || "/tmp/phi-web-info";
const CHECK_MS = 60_000;
const BUNDLED = "bundled";

export type InfoSyncState = {
	commit?: string;
	/** Files ill-sync still has to copy: a count, or (older Workers) the list itself */
	pending?: number | unknown[];
	phigros?: string;
	phigrosVerNum?: number;
	levelsSha?: string;
	/** sha of R2 `info/aliases.json`, written by the same cron */
	aliasesSha?: string;
};

export type HydrateResult = {
	commit: string;
	phigros?: string;
	phigrosVerNum?: number;
	levelsSha?: string;
	aliasesSha?: string;
	/** Info files this call mounted; empty when the mounted set was already current */
	mounted: string[];
	/** `mounted` came straight from R2 rather than the /tmp cache */
	fresh: boolean;
};

type GetObject = (key: string) => Promise<Buffer | undefined>;

type HydrateOpts = {
	getObject: GetObject;
	assetsDir: string;
	cacheRoot: string;
	files?: readonly string[];
	prefix?: string;
};

let gitRevision = BUNDLED;
/** `levelsSha` from `_sync/info.json` */
let syncLevelsSha: string | undefined;
/** sha of the KV `phi:infoFile` csv mounted over info.csv, if any */
let kvLevelsSha: string | undefined;
/** KV csv sha the mounted notesInfo.json is at least as new as */
let notesSha: string | undefined;
let syncAliasesSha: string | undefined;
/** Which cached info set is in the VFS, so an unchanged sync state does not re-read /tmp */
let mountedFor: string | undefined;
let initedCommit: string | undefined;
let checkedAt = 0;
let inflight: Promise<void> | undefined;
/**
 * A revision with missing info files: arrived files wait while the last complete set stays in use
 * After MAX_INFO_TRIES they're mounted as partial; the missing ones keep retrying
 */
let staged:
	| {
			key: string;
			got: Map<string, Buffer>;
			tries: number;
			/** Files mounted when the check gave up; the rest still hold the older copy */
			partial?: Set<string>;
	  }
	| undefined;
const MAX_INFO_TRIES = 5;
const PARTIAL_RETRY_EVERY = 10;
const PARTIAL = "+partial";

/** Revision of the mounted info files; moves before `getInfo` re-parses them */
export function catalogRevision(): string {
	const levels = kvLevelsSha ?? syncLevelsSha;
	return levels ? `${gitRevision}:${levels}` : gitRevision;
}

/** Revision getInfo holds; key anything built from getInfo on this */
export function loadedCatalogRevision(): string {
	return initedCommit ?? catalogRevision();
}

/** Approved-alias snapshot sha from the last `_sync/info.json` read; undefined until ill-sync writes one */
export function aliasesSha(): string | undefined {
	return syncAliasesSha;
}

const reloadListeners = new Set<() => void>();

/** Runs after `getInfo` re-parses a newer catalog (the Discord bot re-indexes song aliases) */
export function onCatalogReload(fn: () => void): void {
	reloadListeners.add(fn);
}

export function resetSongInfoForTest() {
	gitRevision = BUNDLED;
	syncLevelsSha = undefined;
	kvLevelsSha = undefined;
	notesSha = undefined;
	syncAliasesSha = undefined;
	mountedFor = undefined;
	initedCommit = undefined;
	checkedAt = 0;
	inflight = undefined;
	staged = undefined;
}

function applyRevision(
	state: {
		commit?: string;
		levelsSha?: string;
		phigros?: string;
		phigrosVerNum?: number;
	},
	mounted: string[] = [],
	fresh = false,
): HydrateResult {
	gitRevision = state.commit || BUNDLED;
	if (state.levelsSha) syncLevelsSha = state.levelsSha;
	// A remount replaced the KV overlays; refresh() puts them back
	if (mounted.includes("info.csv")) kvLevelsSha = undefined;
	if (mounted.includes("notesInfo.json")) notesSha = undefined;
	return {
		commit: gitRevision,
		phigros: state.phigros,
		phigrosVerNum: state.phigrosVerNum,
		levelsSha: kvLevelsSha ?? syncLevelsSha,
		aliasesSha: syncAliasesSha,
		mounted,
		fresh,
	};
}

/** ill-sync has copied every file for `commit` */
export function syncReady(state: InfoSyncState | undefined): boolean {
	if (!state?.commit) return false;
	const pending = state.pending;
	if (pending == null || pending === 0) return true;
	return Array.isArray(pending) && pending.length === 0;
}

function cacheId(state?: InfoSyncState): string {
	if (!state?.commit) return "";
	return `${state.commit}:${state.levelsSha ?? ""}`;
}

export function applyLevelsCsv(
	assets: string,
	cache: InfoFileCache,
	cacheRoot?: string,
) {
	const buf = Buffer.from(cache.csv);
	if (cacheRoot) persistFile(cacheRoot, "info.csv", buf);
	mountInfoFile(assets, "info.csv", buf);
	kvLevelsSha = cache.sha;
}

/** Note counts for the unpacker's csv. The bundled notesInfo predates those songs */
export function applyNotesInfo(
	assets: string,
	buf: Buffer,
	cacheRoot?: string,
) {
	if (cacheRoot) persistFile(cacheRoot, "notesInfo.json", buf);
	mountInfoFile(assets, "notesInfo.json", buf);
}

function infoPrefix(): string {
	return (process.env.CLOUDFLARE_R2_INFO_PREFIX ?? "info").replace(/\/+$/, "");
}

function parseState(buf: Buffer | undefined): InfoSyncState | undefined {
	if (!buf?.byteLength) return undefined;
	try {
		const parsed = JSON.parse(buf.toString("utf8")) as InfoSyncState;
		if (!parsed || typeof parsed !== "object") return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

function metaPath(cacheRoot: string): string {
	return join(cacheRoot, "_meta.json");
}

function readCacheMeta(cacheRoot: string): InfoSyncState | undefined {
	try {
		return parseState(
			readFileSync(/*turbopackIgnore: true*/ metaPath(cacheRoot)),
		);
	} catch {
		return undefined;
	}
}

function writeCacheMeta(cacheRoot: string, meta: InfoSyncState) {
	mkdirSync(/*turbopackIgnore: true*/ cacheRoot, { recursive: true });
	writeFileSync(
		/*turbopackIgnore: true*/ metaPath(cacheRoot),
		JSON.stringify(meta),
	);
}

function mountInfoFile(assets: string, name: string, buf: Buffer) {
	mountBytes(join(assets, "info", name), buf);
}

function mountCached(
	assets: string,
	cacheRoot: string,
	files: readonly string[],
): boolean {
	for (const name of files) {
		const dest = join(/*turbopackIgnore: true*/ cacheRoot, name);
		if (!fsExists(/*turbopackIgnore: true*/ dest)) return false;
	}
	for (const name of files) {
		const dest = join(/*turbopackIgnore: true*/ cacheRoot, name);
		mountInfoFile(assets, name, readFileSync(/*turbopackIgnore: true*/ dest));
	}
	return true;
}

function persistFile(cacheRoot: string, name: string, buf: Buffer) {
	mkdirSync(/*turbopackIgnore: true*/ cacheRoot, { recursive: true });
	writeFileSync(/*turbopackIgnore: true*/ join(cacheRoot, name), buf);
}

export async function hydrateSongInfo(
	opts: HydrateOpts,
): Promise<HydrateResult> {
	const files = opts.files ?? INFO_FILES;
	const prefix = (opts.prefix ?? infoPrefix()).replace(/\/+$/, "");
	const state = parseState(await opts.getObject(INFO_STATE_KEY));
	// Alias sync does not wait for `pending`; an unreadable state keeps the last sha
	if (state) {
		syncAliasesSha =
			typeof state.aliasesSha === "string" && state.aliasesSha
				? state.aliasesSha
				: undefined;
	}
	const cached = readCacheMeta(opts.cacheRoot);
	const ready = syncReady(state) ? state : undefined;
	const mountKey = (s: InfoSyncState) =>
		`${opts.assetsDir}\0${opts.cacheRoot}\0${cacheId(s)}`;
	const mountCachedOnce = (s: InfoSyncState): string[] | undefined => {
		if (mountedFor === mountKey(s)) return [];
		if (!mountCached(opts.assetsDir, opts.cacheRoot, files)) return undefined;
		mountedFor = mountKey(s);
		return [...files];
	};

	if (!ready?.commit) {
		const mounted = cached?.commit ? mountCachedOnce(cached) : undefined;
		if (cached && mounted) return applyRevision(cached, mounted);
		return applyRevision({ commit: BUNDLED });
	}

	if (cached && cacheId(cached) === cacheId(ready)) {
		const mounted = mountCachedOnce(ready);
		if (mounted) {
			return applyRevision(
				{
					commit: ready.commit,
					levelsSha: ready.levelsSha ?? cached.levelsSha,
					phigros: ready.phigros ?? cached.phigros,
					phigrosVerNum: ready.phigrosVerNum ?? cached.phigrosVerNum,
				},
				mounted,
			);
		}
	}

	const key = mountKey(ready);
	const partialKey = `${key}${PARTIAL}`;
	if (staged?.key !== key) staged = { key, got: new Map(), tries: 0 };
	const batch = staged;
	// Something remounted the last complete set over the partial one: mount it again
	if (batch.partial && mountedFor !== partialKey) batch.partial = undefined;
	batch.tries += 1;
	const fetched = new Set<string>();
	if (!batch.partial || batch.tries % PARTIAL_RETRY_EVERY === 0) {
		await Promise.all(
			files
				.filter((name) => !batch.got.has(name))
				.map(async (name) => {
					const buf = await opts.getObject(prefix ? `${prefix}/${name}` : name);
					if (!buf?.byteLength) return;
					batch.got.set(name, buf);
					fetched.add(name);
				}),
		);
	}
	const missing = files.filter((name) => !batch.got.has(name));
	const label = `info ${ready.commit.slice(0, 8)}: ${missing.join(", ")}`;
	if (missing.length && batch.partial) {
		if (fetched.size) logger.warn(`${label} still missing`);
		return applyRevision({ ...ready, commit: ready.commit + PARTIAL });
	}
	if (missing.length && (batch.tries < MAX_INFO_TRIES || !batch.got.size)) {
		logger.warn(
			`${label} not downloaded (check ${batch.tries}${batch.got.size ? `/${MAX_INFO_TRIES}` : ", nothing in hand"}); keeping the last complete set`,
		);
		const mounted = cached?.commit ? mountCachedOnce(cached) : undefined;
		if (cached && mounted) return applyRevision(cached, mounted);
		return applyRevision({ commit: gitRevision });
	}
	// Only files this process has not mounted for this revision yet
	const toMount = files.filter(
		(name) => batch.got.has(name) && !batch.partial?.has(name),
	);
	for (const name of toMount) {
		const buf = batch.got.get(name);
		if (buf) mountInfoFile(opts.assetsDir, name, buf);
	}
	// `fresh` vouches for every mounted file being this check's download (see
	// applyKvLevels); one fetched on an earlier check may predate the KV csv
	const fresh = toMount.every((name) => fetched.has(name));
	if (missing.length) {
		logger.warn(
			`${label} still missing after ${batch.tries} tries; mounting the rest, retrying every ${PARTIAL_RETRY_EVERY} checks`,
		);
		batch.partial = new Set(toMount);
		mountedFor = partialKey;
		// Labelled apart so the files that arrive later move the revision and get re-parsed
		return applyRevision(
			{ ...ready, commit: ready.commit + PARTIAL },
			toMount,
			fresh,
		);
	}
	staged = undefined;
	for (const name of files) {
		const buf = batch.got.get(name);
		if (buf) persistFile(opts.cacheRoot, name, buf);
	}
	writeCacheMeta(opts.cacheRoot, {
		commit: ready.commit,
		phigros: ready.phigros,
		phigrosVerNum: ready.phigrosVerNum,
		levelsSha: ready.levelsSha,
	});
	mountedFor = key;
	return applyRevision(ready, toMount, fresh);
}

/** Info files skip r2's 15 min "known missing" memo, so a retry after a 404 really asks R2 again */
export function infoFetchOpts(key: string) {
	return { cache: "no-store", negative: key === INFO_STATE_KEY } as const;
}

async function readKvInfoFile(): Promise<InfoFileCache | undefined> {
	try {
		const { getDataHost } = await import("./data-host.ts");
		const { store } = await getDataHost();
		return parseInfoFileCache(await store.get(INFO_FILE_KV_KEY));
	} catch (err) {
		logger.warn(
			`infoFile kv skipped: ${err instanceof Error ? err.message : err}`,
		);
		return undefined;
	}
}

/** Mount the KV csv and its notesInfo.json (~1.7 MB each), fetched only when the csv sha moves or a remount dropped them */
export async function applyKvLevels(
	cache: InfoFileCache,
	hydrated: Pick<HydrateResult, "mounted" | "fresh"> | undefined,
	deps: {
		assets?: string;
		cacheRoot?: string;
		getNotes?: () => Promise<Buffer | undefined>;
	} = {},
): Promise<void> {
	const assets = deps.assets ?? assetsDir();
	const cacheRoot = deps.cacheRoot ?? CACHE_ROOT;
	try {
		if (cache.sha !== kvLevelsSha) applyLevelsCsv(assets, cache, cacheRoot);
		if (hydrated?.fresh && hydrated.mounted.includes("notesInfo.json")) {
			// refresh() read KV before this download, and the unpacker uploads
			// notesInfo.json to R2 before it writes KV, so this copy is current
			notesSha = cache.sha;
			return;
		}
		if (notesSha === cache.sha) return;
		const getNotes =
			deps.getNotes ??
			(r2Ready()
				? () =>
						fetchR2Object(`${infoPrefix()}/notesInfo.json`, {
							cache: "no-store",
						})
				: undefined);
		if (!getNotes) return;
		const notes = await getNotes();
		if (!notes?.byteLength) return;
		applyNotesInfo(assets, notes, cacheRoot);
		notesSha = cache.sha;
	} catch (err) {
		logger.warn(
			`infoFile kv skipped: ${err instanceof Error ? err.message : err}`,
		);
	}
}

async function refresh(): Promise<void> {
	const now = Date.now();
	const skipRemote = initedCommit != null && now - checkedAt < CHECK_MS;
	if (!skipRemote) {
		// KV first: a notesInfo.json downloaded after this read is at least as new as its csv
		const kv = await readKvInfoFile();
		let hydrated: HydrateResult | undefined;
		if (r2Ready()) {
			try {
				const result = await hydrateSongInfo({
					getObject: (key) => fetchR2Object(key, infoFetchOpts(key)),
					assetsDir: assetsDir(),
					cacheRoot: CACHE_ROOT,
				});
				if (result.phigros || result.phigrosVerNum != null) {
					applyPhiVersion({
						phigros: result.phigros,
						phigrosVerNum: result.phigrosVerNum,
					});
				}
				const shown = catalogRevision();
				if (result.commit !== BUNDLED && shown !== initedCommit) {
					logger.ok(
						`phi info ${result.commit.slice(0, 8)}${result.phigros ? ` ${result.phigros}` : ""}${result.levelsSha ? ` lv ${result.levelsSha.slice(0, 8)}` : ""}`,
					);
				}
				hydrated = result;
			} catch (err) {
				logger.warn(
					`info hydrate skipped: ${err instanceof Error ? err.message : err}`,
				);
			}
		}
		if (kv) await applyKvLevels(kv, hydrated);
		checkedAt = now;
	}
	await reloadCatalog();
}

/** Re-parse the mounted info files into `getInfo` when they moved past what it holds */
export async function reloadCatalog(assets = assetsDir()): Promise<boolean> {
	const rev = catalogRevision();
	if (initedCommit === rev) return false;
	await getInfo.init(assets);
	initedCommit = rev;
	for (const fn of reloadListeners) {
		try {
			fn();
		} catch (err) {
			logger.warn(
				`catalog reload hook failed: ${err instanceof Error ? err.message : err}`,
			);
		}
	}
	return true;
}

export function ensureSongInfo(): Promise<void> {
	const ready = initedCommit != null;
	if (ready && Date.now() - checkedAt < CHECK_MS) return Promise.resolve();
	if (!inflight) {
		inflight = refresh().finally(() => {
			inflight = undefined;
		});
		if (ready) {
			runInBackground(inflight, (err) =>
				logger.warn(
					`song info refresh failed: ${err instanceof Error ? err.message : err}`,
				),
			);
		}
	}
	return ready ? Promise.resolve() : inflight;
}

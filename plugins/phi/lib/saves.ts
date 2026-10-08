import { runInBackground } from "../../../src/background.ts";
import { logger, withDiscordUid } from "../../../src/logger.ts";
import type { Kv } from "../../../src/sdk/index.ts";
import { ensureSongInfo } from "../../../src/song-info.ts";
import { kvKey } from "./const.ts";
import type { PhiRuntime } from "./runtime.ts";
import type { Save, SavePayload } from "./save.ts";
import { isTapApiFailure, tapCnProxyUrl } from "./tapapi.ts";

const SAVE = (token: string) => kvKey("save", token);
/**
 * Session token → the Discord user that bound it last. The WebUI (account-link.ts)
 * opens that user on a TapTap sign-in; the bot writes it on every bind and update
 */
const TOKEN_USER = (token: string) => kvKey("tokenUser", token);
const HISB30 = (userId: string) => kvKey("hisb30", userId);

/**
 * Raw save JSON by token (never a parsed Save: getB19 mutates rows)
 * `rev` lets a refresh skip the KV read; plain reads are trusted for SAVE_MEMO_MS, opt-in only
 */
const blobMem = new Map<
	string,
	{ rev?: string; raw: string; at: number; kvAt: number }
>();
const BLOB_MEM_MAX = 64;
const SAVE_MEMO_MS = 10_000;
/** How long a refresh trusts `rev` without reading KV (another instance may have deleted the blob) */
const SAVE_REV_TRUST_MS = 10 * 60_000;

/** userId → bound token, so a page view and the card request after it share one read */
const tokenMem = new Map<string, { token: string; at: number }>();
const TOKEN_MEM_MAX = 1_000;
/**
 * Bumped by `forgetBound`: a token read that was already on the wire when a
 * binding was dropped must not put the old token back in the memo
 */
let tokenGen = 0;

/**
 * Per token, bumped when an unbind deletes `phi:save:<token>`: a refresh or a
 * blob read already running then must not write the blob back or memo it
 */
const saveDrops = new Map<string, number>();
const SAVE_DROPS_MAX = 1_000;

function saveDropGen(token: string): number {
	return saveDrops.get(token) ?? 0;
}

function evictOldest(map: Map<string, unknown>, max: number) {
	while (map.size > max) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) break;
		map.delete(oldest);
	}
}

function rememberBlob(
	token: string,
	rev: string | undefined,
	raw: string,
	kvAt = Date.now(),
) {
	blobMem.delete(token);
	blobMem.set(token, { rev, raw, at: Date.now(), kvAt });
	evictOldest(blobMem, BLOB_MEM_MAX);
}

function rememberToken(userId: string, token: string) {
	tokenMem.delete(userId);
	tokenMem.set(userId, { token, at: Date.now() });
	evictOldest(tokenMem, TOKEN_MEM_MAX);
}

/** Drop this process's memo of a user's binding (unbind, rebind) */
export function forgetBound(userId: string, token?: string) {
	tokenGen += 1;
	tokenMem.delete(userId);
	if (token) blobMem.delete(token);
}

export function resetSaveBlobMemForTest() {
	blobMem.clear();
	tokenMem.clear();
	saveDrops.clear();
}

/** Which TapTap region answered last, so a refresh tries it first. Only a hint: bounded */
const sessionRegion = new Map<string, boolean>();
const SESSION_REGION_MAX = 500;

function rememberRegion(userId: string, global: boolean) {
	sessionRegion.delete(userId);
	sessionRegion.set(userId, global);
	while (sessionRegion.size > SESSION_REGION_MAX) {
		const oldest = sessionRegion.keys().next().value;
		if (oldest === undefined) break;
		sessionRegion.delete(oldest);
	}
}

export function asSessionToken(raw: unknown): string | undefined {
	if (typeof raw !== "string" || !raw) return;
	const trimmed = raw.replace(/\s/g, "");
	if (/^[a-z0-9A-Z]{25}$/.test(trimmed)) return trimmed;
	if (!raw.startsWith("{") && !raw.startsWith('"')) return;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed === "string") return asSessionToken(parsed);
		if (parsed && typeof parsed === "object") {
			const o = parsed as Record<string, unknown>;
			return asSessionToken(o.d ?? o.sessionToken ?? o.token);
		}
	} catch {
		/* not json */
	}
}

/** Always reads KV (pages, bind, unbind, refresh), and seeds the memo for the card request */
export async function getToken(
	rt: PhiRuntime,
	userId: string,
): Promise<string | undefined> {
	const gen = tokenGen;
	const token = asSessionToken(await rt.store.getSessionToken(userId));
	if (!token) tokenMem.delete(userId);
	else if (gen === tokenGen) rememberToken(userId, token);
	return token;
}

/** `getToken` with a 10 s memo, card route only; misses are not remembered */
export async function getBoundToken(
	rt: PhiRuntime,
	userId: string,
): Promise<string | undefined> {
	const hot = tokenMem.get(userId);
	if (hot && Date.now() - hot.at < SAVE_MEMO_MS) return hot.token;
	return getToken(rt, userId);
}

export const ALREADY_BOUND =
	"An account is already bound. Use `/phi account unbind` first, then bind again.";
export const NOT_BOUND =
	"No account is bound. Use `/phi account qrcode` (or `/phi account bind`) first.";

async function setToken(rt: PhiRuntime, userId: string, token: string) {
	await rt.store.setSessionToken(userId, token);
}

/**
 * Removes the binding and, in the background, the token-keyed save blob
 * Another account sharing the save needs a refresh; score history is kept
 */
export async function clearUser(rt: PhiRuntime, userId: string) {
	sessionRegion.delete(userId);
	const token = await getToken(rt, userId);
	await rt.store.clearLocalCredentials(userId);
	forgetBound(userId, token);
	if (token) dropSave(rt, token);
	return Boolean(token);
}

/** Deletes the blob from KV in the background; `forgetBound` already dropped the memo */
function dropSave(rt: PhiRuntime, token: string) {
	const gen = saveDropGen(token) + 1;
	saveDrops.delete(token);
	saveDrops.set(token, gen);
	evictOldest(saveDrops, SAVE_DROPS_MAX);
	runInBackground(
		Promise.resolve().then(() => rt.store.clearSessionSave(token)),
		(err) =>
			logger.warn(
				`unbound save cleanup failed: ${err instanceof Error ? err.message : err}`,
			),
	);
}

export async function loadSave(rt: PhiRuntime, db: Kv, userId: string) {
	const token = await getToken(rt, userId);
	if (!token) return undefined;
	return loadSaveByToken(rt, db, token);
}

/**
 * `memo`: a copy this process read or wrote in the last 10 s will do. Only the
 * card route opts in, and not when the client says its save just changed
 */
export type MemoOpts = { memo?: boolean };

/** Raw save JSON from KV, or from this process's 10 s memo when `opts.memo` */
export async function readSaveRaw(
	db: Pick<Kv, "get">,
	token: string,
	opts: MemoOpts = {},
): Promise<string | undefined> {
	const hot = blobMem.get(token);
	if (hot && opts.memo && Date.now() - hot.at < SAVE_MEMO_MS) return hot.raw;
	const drop = saveDropGen(token);
	const raw = await db.get(SAVE(token));
	// An unbind deleted the blob during this read: hand it out once, never memo it
	if (drop !== saveDropGen(token)) return raw;
	if (raw) rememberBlob(token, hot?.raw === raw ? hot.rev : undefined, raw);
	else blobMem.delete(token);
	return raw;
}

/** For callers that already hold the token: saves the `phi:userToken` round trip */
export async function loadSaveByToken(
	rt: PhiRuntime,
	db: Kv,
	token: string,
	opts: MemoOpts = {},
) {
	const raw = await readSaveRaw(db, token, opts);
	if (!raw) return undefined;
	await ensureSongInfo();
	return new rt.Save(JSON.parse(raw));
}

export function saveIdentity(
	saveInfo:
		| {
				gameFile?: { url?: string };
				modifiedAt?: { iso?: Date | string };
				summary?: { updatedAt?: string | Date };
		  }
		| undefined,
): string {
	const raw = String(saveInfo?.gameFile?.url || "");
	let file = raw;
	if (raw) {
		try {
			const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
			file = `${u.host}${u.pathname}`;
		} catch {
			file = raw.split("?")[0] || raw;
		}
	}
	const iso = saveInfo?.modifiedAt?.iso ?? saveInfo?.summary?.updatedAt;
	const ms =
		iso instanceof Date ? iso.getTime() : Date.parse(String(iso || ""));
	const stamp = Number.isFinite(ms) ? String(ms) : "";
	return file || stamp ? `${file}|${stamp}` : "";
}

function saveRev(
	saveInfo:
		| { gameFile?: { url?: string }; modifiedAt?: { iso?: Date | string } }
		| undefined,
): string | undefined {
	return saveIdentity(saveInfo) || undefined;
}

function saveZipHop(url: string | undefined): string {
	if (!url) return "";
	try {
		return tapCnProxyUrl(url) ? " via tap-proxy" : "";
	} catch {
		return "";
	}
}

async function fetchSaveInfo(rt: PhiRuntime, token: string, global: boolean) {
	const user = new rt.PhigrosUser(token, global);
	await user.getSaveInfo();
	return user;
}

export type UpdateSaveOpts = {
	/** Token to bind; fails when the user already has one */
	token?: string;
	/** The user's current token, already read by the caller: skips that read */
	bound?: string;
	global?: boolean;
};

export async function updateSave(
	rt: PhiRuntime,
	db: Kv,
	userId: string,
	opts: UpdateSaveOpts = {},
) {
	return withDiscordUid(userId, () => updateSaveFor(rt, db, userId, opts));
}

function quiet<T>(job: Promise<T>): Promise<T> {
	job.catch(() => undefined);
	return job;
}

async function updateSaveFor(
	rt: PhiRuntime,
	db: Kv,
	userId: string,
	opts: UpdateSaveOpts = {},
) {
	const existing = opts.bound ?? (await getToken(rt, userId));
	if (opts.token && existing) throw new Error(ALREADY_BOUND);
	const token = opts.token || existing;
	if (!token) throw new Error(NOT_BOUND);
	if (!/[a-z0-9A-Z]{25}/.test(token))
		throw new Error("SessionToken format is invalid (need 25 alphanumerics).");
	// An unbind while this runs (KV round trips, TapTap, the download) deletes the
	// blob and the memo; this refresh must not bring either back
	const drop = saveDropGen(token);
	const gen = tokenGen;
	const unbound = () => drop !== saveDropGen(token);
	const bannedJob = quiet(rt.store.isSessionTokenBanned(token));
	// Read the stored blob during the TapTap call; a recent in-process copy is checked against TapTap's revision first
	const mem = blobMem.get(token);
	const hot =
		mem?.rev && Date.now() - mem.kvAt < SAVE_REV_TRUST_MS ? mem : undefined;
	const savedJob = hot ? undefined : quiet(readSaveRaw(db, token));
	const preferred = opts.global ?? sessionRegion.get(userId) ?? false;
	let user: InstanceType<PhiRuntime["PhigrosUser"]>;
	try {
		user = await fetchSaveInfo(rt, token, preferred);
	} catch (err) {
		if (opts.global != null || isTapApiFailure(err)) throw err;
		user = await fetchSaveInfo(rt, token, !preferred);
	}
	rememberRegion(userId, user.global);
	if (await bannedJob) throw new Error("This sessionToken is banned.");
	const rev = saveRev(user.saveInfo);
	/** `bound`: the binding was written or re-read here; otherwise only renew a memo getToken made */
	const remember = (raw: string, bound: boolean, kvAt?: number) => {
		if (!unbound()) rememberBlob(token, rev, raw, kvAt);
		if (gen !== tokenGen) return;
		if (bound || tokenMem.get(userId)?.token === token)
			rememberToken(userId, token);
	};
	const hop = saveZipHop(user.saveInfo?.gameFile?.url);
	const memHit = Boolean(hot?.rev && rev && hot.rev === rev);
	const cachedRaw = memHit
		? hot?.raw
		: await (savedJob ?? readSaveRaw(db, token));
	const cached = cachedRaw ? JSON.parse(cachedRaw) : undefined;
	const writeToken = () =>
		Promise.all([
			token === existing ? undefined : setToken(rt, userId, token),
			db.set(TOKEN_USER(token), userId),
		]);
	if (cached?.gameRecord && rev && rev === saveRev(cached.saveInfo)) {
		logger.info(`save cache hit ${rev}${hop}${memHit ? " (mem)" : ""}`);
		await writeToken();
		if (cachedRaw)
			remember(cachedRaw, Boolean(opts.token), memHit ? hot?.kvAt : undefined);
		const save = new rt.Save(cached);
		if (opts.token) await snapshotB30(db, userId, save);
		return save;
	}
	logger.info(`save cache miss ${rev || "-"}${hop}`);
	// Only a changed save needs the B30 ring and the history: read them during the download
	const snapsJob = quiet(db.get(HISB30(userId)));
	const history = import("./history.ts");
	const historyJob = quiet(
		history.then((m) => m.readSaveHistoryRaw(db, token)),
	);
	await user.buildRecord();
	// The binding may have gone during the download: re-read it before writing the blob back,
	// or the token outlives the binding (a bind writes its own token)
	const boundJob = opts.token
		? Promise.resolve(true)
		: rt.store.getSessionToken(userId).then(
				(raw) => asSessionToken(raw) === token,
				() => true,
			);
	const orphaned = async () => unbound() || !(await boundJob);
	const payload = JSON.stringify({
		session: user.session,
		global: user.global,
		saveInfo: user.saveInfo,
		playerInfo: user.playerInfo,
		gameRecord: user.gameRecord,
		gameProgress: user.gameProgress,
		gameuser: user.gameuser,
		gamesettings: user.gamesettings,
		Recordver: user.Recordver,
	});
	const save = new rt.Save(user as unknown as SavePayload);
	await Promise.all([
		writeToken(),
		orphaned().then((gone) => {
			if (gone) logger.info("save not cached: unbound during the refresh");
			else return db.set(SAVE(token), payload);
		}),
		snapshotB30(db, userId, save, snapsJob),
		history
			.then((m) => m.applySaveToHistory(rt, db, token, save, historyJob))
			.catch(() => undefined),
	]);
	// Unbound elsewhere: that unbind deleted the blob, so forget the copy read above
	if (await orphaned()) blobMem.delete(token);
	else remember(payload, true);
	return save;
}

/** `prev`: the `phi:hisb30` read already in flight, if the caller started one */
export async function snapshotB30(
	db: Kv,
	userId: string,
	save: Save,
	prev?: Promise<string | undefined>,
) {
	const key = HISB30(userId);
	let b19: Awaited<ReturnType<Save["getB19"]>>;
	try {
		b19 = await save.getB19(undefined, 33, { avgType: "none" });
	} catch {
		return;
	}
	const stored = JSON.parse((await (prev ?? db.get(key))) || "[]") as unknown[];
	const row = {
		t: Date.now(),
		rks: save.saveInfo?.summary?.rankingScore,
		phi: (b19.phi || []).flatMap((x) =>
			x ? [{ id: x.id, rank: x.rank }] : [],
		),
		b27: (b19.b19_list || [])
			.slice(0, 27)
			.map((x) => ({ id: x.id, rank: x.rank })),
	};
	const next = Array.isArray(stored) ? [...stored, row] : [row];
	while (next.length > 40) next.shift();
	await db.set(key, JSON.stringify(next));
}

export function moneyText(money: number[] | undefined) {
	const m = money || [0, 0, 0, 0, 0];
	return (
		`${m[4] ? `${m[4]}PiB ` : ""}${m[3] ? `${m[3]}TiB ` : ""}${m[2] ? `${m[2]}GiB ` : ""}${m[1] ? `${m[1]}MiB ` : ""}${m[0] ? `${m[0]}KiB ` : ""}`.trim() ||
		"0KiB"
	);
}

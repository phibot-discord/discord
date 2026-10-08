import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import type { KvStore } from "../../../src/kv.ts";
import type { Kv } from "../../../src/sdk/index.ts";
import { kvKey } from "./const.ts";
import { initCredentials } from "./credentials.ts";
import type { PhiRuntime } from "./runtime.ts";
import { Save } from "./save.ts";
import {
	asSessionToken,
	clearUser,
	getBoundToken,
	getToken,
	readSaveRaw,
	resetSaveBlobMemForTest,
	updateSave,
} from "./saves.ts";
import { TapApiError } from "./tapapi.ts";

const TOKEN = "abcdefghijklmnopqrstuvwxy";
const SAVE_URL = "https://example.test/save.zip";
const SAVE_ISO = "2024-01-01T00:00:00.000Z";

const saveInfo = {
	gameFile: { url: SAVE_URL },
	modifiedAt: { iso: SAVE_ISO },
	summary: { rankingScore: 14.5, challengeModeRank: 0, updatedAt: SAVE_ISO },
	PlayerId: "p",
};

function cachedSave() {
	return JSON.stringify({
		session: TOKEN,
		global: false,
		saveInfo,
		gameRecord: { song: [] },
	});
}

function mockRt(opts: {
	token?: string | null;
	log: string[];
	saveUrl?: string;
	getSaveInfo: (global: boolean) => Promise<void>;
	buildRecord?: () => Promise<void>;
}) {
	class FakeUser {
		session: string;
		global: boolean;
		saveInfo = {
			gameFile: { url: opts.saveUrl ?? SAVE_URL },
			modifiedAt: { iso: new Date(SAVE_ISO) },
			summary: { rankingScore: 14.5, challengeModeRank: 0 },
			PlayerId: "p",
		};
		playerInfo = {};
		gameRecord = { song: [] };
		gameProgress = undefined;
		gameuser = undefined;
		gamesettings = undefined;
		Recordver = 1;
		constructor(session: string, global = false) {
			this.session = session;
			this.global = global;
			opts.log.push(`user:${global}`);
		}
		async getSaveInfo() {
			opts.log.push("taptap");
			await opts.getSaveInfo(this.global);
			return this.saveInfo;
		}
		async buildRecord() {
			opts.log.push("download");
			await opts.buildRecord?.();
		}
	}
	return {
		PhigrosUser: FakeUser,
		Save,
		store: {
			getSessionToken: async () => {
				opts.log.push("kv:token");
				return opts.token === null ? "" : (opts.token ?? TOKEN);
			},
			isSessionTokenBanned: async () => false,
			setSessionToken: async () => {
				opts.log.push("set:token");
			},
			clearLocalCredentials: async () => {
				opts.log.push("del:token");
			},
			clearSessionSave: async (token: string) => {
				opts.log.push(`del:${kvKey("save", token)}`);
			},
		},
	} as unknown as PhiRuntime;
}

function mockDb(opts: { log: string[]; save?: string }) {
	const saveKey = kvKey("save", TOKEN);
	return {
		get: async (key: string) => {
			opts.log.push(`kv:${key}`);
			return key === saveKey ? opts.save : undefined;
		},
		set: async (key: string) => {
			opts.log.push(`set:${key}`);
		},
		del: async () => undefined,
		keys: async () => [],
		ping: async () => "PONG",
		close: async () => undefined,
	} satisfies Kv;
}

beforeEach(() => resetSaveBlobMemForTest());

test("asSessionToken accepts a raw 25-char token and unwraps JSON", () => {
	assert.equal(
		asSessionToken("abcdefghijklmnopqrstuvwxy"),
		"abcdefghijklmnopqrstuvwxy",
	);
	assert.equal(
		asSessionToken(JSON.stringify({ d: "abcdefghijklmnopqrstuvwxy" })),
		"abcdefghijklmnopqrstuvwxy",
	);
	assert.equal(asSessionToken(""), undefined);
	assert.equal(asSessionToken("short"), undefined);
});

const SAVE_KEY = kvKey("save", TOKEN);
const HISB30_KEY = (userId: string) => kvKey("hisb30", userId);
const HISTORY_KEY = kvKey("history", TOKEN);

test("failed TapTap fetch reads only the save blob and writes nothing", async () => {
	const log: string[] = [];
	const rt = mockRt({
		log,
		getSaveInfo: async () => {
			throw new TapApiError("TapAPI timed out", true);
		},
	});
	const db = mockDb({ log, save: cachedSave() });
	await assert.rejects(
		() => updateSave(rt, db, "tap-timeout", { bound: TOKEN }),
		(err: unknown) => err instanceof TapApiError,
	);
	assert.deepEqual(log, [`kv:${SAVE_KEY}`, "user:false", "taptap"]);
});

test("the save blob read overlaps the TapTap call", async () => {
	const log: string[] = [];
	const rt = mockRt({
		log,
		getSaveInfo: async () => {
			// TapTap is still working when the blob read has already gone out
			assert.ok(log.includes(`kv:${SAVE_KEY}`));
		},
	});
	const db = mockDb({ log, save: cachedSave() });
	await updateSave(rt, db, "tap-overlap");
	assert.equal(log.includes("download"), false);
});

test("refresh with the caller's token: no token read, no token rewrite", async () => {
	const log: string[] = [];
	const rt = mockRt({ log, getSaveInfo: async () => undefined });
	const db = mockDb({ log, save: cachedSave() });
	await updateSave(rt, db, "refresh-same", { bound: TOKEN });
	assert.equal(log.includes("kv:token"), false);
	assert.equal(log.includes("set:token"), false);
	assert.equal(log.includes(`kv:${HISB30_KEY("refresh-same")}`), false);
	assert.equal(log.includes(`kv:${HISTORY_KEY}`), false);
});

test("a changed save reads the B30 ring and history during the download and writes in parallel", async () => {
	const log: string[] = [];
	let downloading!: () => void;
	const downloaded = new Promise<void>((r) => {
		downloading = r;
	});
	const rt = mockRt({
		log,
		saveUrl: "https://example.test/new-save.zip",
		getSaveInfo: async () => undefined,
		buildRecord: async () => {
			await new Promise((r) => setTimeout(r, 5));
			assert.ok(log.includes(`kv:${HISB30_KEY("changed")}`));
			assert.ok(log.includes(`kv:${HISTORY_KEY}`));
			downloading();
		},
	});
	const db = mockDb({ log, save: cachedSave() });
	await updateSave(rt, db, "changed", { bound: TOKEN });
	await downloaded;
	assert.equal(log.includes("set:token"), false, "same token is not rewritten");
	assert.ok(log.includes(`set:${SAVE_KEY}`));
	assert.ok(log.includes(`set:${HISB30_KEY("changed")}`));
	assert.ok(log.includes(`set:${HISTORY_KEY}`));
});

test("binding a new token writes it", async () => {
	const log: string[] = [];
	const rt = mockRt({
		token: null,
		log,
		saveUrl: "https://example.test/fresh.zip",
		getSaveInfo: async () => undefined,
	});
	const db = mockDb({ log });
	await updateSave(rt, db, "fresh-bind", { token: TOKEN });
	assert.ok(log.includes("set:token"));
	assert.ok(log.includes(`set:${SAVE_KEY}`));
});

test("after a refresh the next card read is served from memory", async () => {
	const log: string[] = [];
	const rt = mockRt({
		log,
		saveUrl: "https://example.test/mem.zip",
		getSaveInfo: async () => undefined,
	});
	const db = mockDb({ log, save: cachedSave() });
	await updateSave(rt, db, "memo", { bound: TOKEN });
	log.length = 0;
	assert.equal(await getBoundToken(rt, "memo"), TOKEN);
	const raw = await readSaveRaw(db, TOKEN, { memo: true });
	assert.match(raw ?? "", /mem\.zip/);
	assert.deepEqual(log, [], "no KV reads");
});

test("token and save memo last 10 s and unbind forgets them", async () => {
	const log: string[] = [];
	const rt = mockRt({ log, getSaveInfo: async () => undefined });
	const db = mockDb({ log, save: cachedSave() });
	const orig = Date.now;
	let clock = 50_000_000;
	Date.now = () => clock;
	try {
		const memo = { memo: true };
		assert.equal(await getBoundToken(rt, "memo-ttl"), TOKEN);
		assert.ok(await readSaveRaw(db, TOKEN, memo));
		assert.equal(await getBoundToken(rt, "memo-ttl"), TOKEN);
		assert.ok(await readSaveRaw(db, TOKEN, memo));
		assert.deepEqual(log, ["kv:token", `kv:${SAVE_KEY}`]);
		clock += 10_001;
		await getBoundToken(rt, "memo-ttl");
		await readSaveRaw(db, TOKEN, memo);
		assert.equal(log.length, 4, "re-read after 10 s");
		assert.equal(await clearUser(rt, "memo-ttl"), true);
		log.length = 0;
		await getBoundToken(rt, "memo-ttl");
		await readSaveRaw(db, TOKEN, memo);
		assert.deepEqual(
			log,
			["kv:token", `kv:${SAVE_KEY}`],
			"unbind dropped the memo",
		);
	} finally {
		Date.now = orig;
	}
});

test("only a memo read is served from memory; a plain read goes to KV and refills it", async () => {
	const log: string[] = [];
	const db = mockDb({ log, save: cachedSave() });
	assert.ok(await readSaveRaw(db, TOKEN));
	assert.ok(await readSaveRaw(db, TOKEN));
	assert.equal(log.length, 2, "pages and refresh always read KV");
	assert.ok(await readSaveRaw(db, TOKEN, { memo: true }));
	assert.equal(log.length, 2, "the card route reuses the page's read");
});

test("a token read still in flight when the user unbinds does not bring the token back", async () => {
	const log: string[] = [];
	let release: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let slow = true;
	const rt = mockRt({ log, getSaveInfo: async () => undefined });
	const store = rt.store as unknown as {
		getSessionToken: () => Promise<string>;
	};
	store.getSessionToken = async () => {
		log.push("kv:token");
		if (slow) await gate;
		return TOKEN;
	};
	// A card request's read starts, then an unbind (fast reads) completes
	const stale = getBoundToken(rt, "race");
	slow = false;
	assert.equal(await clearUser(rt, "race"), true);
	release();
	assert.equal(await stale, TOKEN);
	log.length = 0;
	await getBoundToken(rt, "race");
	assert.deepEqual(log, ["kv:token"], "the late read was not remembered");
});

test("a missing token is not remembered", async () => {
	const log: string[] = [];
	const rt = mockRt({ token: null, log, getSaveInfo: async () => undefined });
	assert.equal(await getBoundToken(rt, "nobody"), undefined);
	assert.equal(await getToken(rt, "nobody"), undefined);
	assert.equal(await getBoundToken(rt, "nobody"), undefined);
	assert.equal(log.filter((x) => x === "kv:token").length, 3);
});

test("unknown region retries the other TapTap host before Cloudflare", async () => {
	const log: string[] = [];
	const rt = mockRt({
		log,
		getSaveInfo: async (global) => {
			if (!global) throw new Error("Phigros cloud 401 Unauthorized");
		},
	});
	const db = mockDb({ log, save: cachedSave() });
	await updateSave(rt, db, "gb-retry", { bound: TOKEN });
	assert.deepEqual(log.filter((step) => !step.startsWith("kv:")).slice(0, 4), [
		"user:false",
		"taptap",
		"user:true",
		"taptap",
	]);
	assert.equal(log.includes("download"), false);
});

test("bind with an explicit region does not retry the other TapTap host", async () => {
	const log: string[] = [];
	const rt = mockRt({
		token: null,
		log,
		getSaveInfo: async () => {
			throw new Error("Phigros cloud 401 Unauthorized");
		},
	});
	const db = mockDb({ log });
	await assert.rejects(() =>
		updateSave(rt, db, "bind-cn", { token: TOKEN, global: false }),
	);
	assert.deepEqual(log, ["kv:token", `kv:${SAVE_KEY}`, "user:false", "taptap"]);
});

test("re-signed save URL with the same modified time does not re-download", async () => {
	const log: string[] = [];
	const rt = mockRt({
		log,
		saveUrl: `${SAVE_URL}?sign=rotated`,
		getSaveInfo: async () => undefined,
	});
	const db = mockDb({ log, save: cachedSave() });
	await updateSave(rt, db, "same-file");
	assert.equal(log.includes("download"), false);
});

/** Lets the background work queued by an unbind run */
const settle = () => new Promise((r) => setImmediate(r));

test("unbind deletes the save blob in the background, without listing users or touching the history", async () => {
	const log: string[] = [];
	const rt = mockRt({ log, getSaveInfo: async () => undefined });
	const db: Kv = mockDb({ log, save: cachedSave() });
	db.keys = async () => {
		log.push("list");
		return [];
	};
	db.del = async (key: string) => {
		log.push(`db-del:${key}`);
	};
	assert.equal(await clearUser(rt, "unbind-save"), true);
	await settle();
	assert.deepEqual(log, ["kv:token", "del:token", `del:${SAVE_KEY}`]);
	assert.equal(log.includes(`db-del:${HISTORY_KEY}`), false);
});

test("the credential store deletes exactly phi:save:<token>", async () => {
	const deleted: string[] = [];
	const store = initCredentials({
		del: async (...keys: Array<string | string[]>) => {
			deleted.push(...keys.flat());
			return keys.length;
		},
	} as unknown as KvStore);
	await store.clearSessionSave(TOKEN);
	assert.deepEqual(deleted, [SAVE_KEY]);
});

test("a refresh still downloading when the user unbinds writes neither the blob nor the memo back", async () => {
	const log: string[] = [];
	let release: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let downloading: () => void = () => undefined;
	const started = new Promise<void>((resolve) => {
		downloading = resolve;
	});
	const rt = mockRt({
		log,
		saveUrl: "https://example.test/changed.zip",
		getSaveInfo: async () => undefined,
		buildRecord: async () => {
			downloading();
			await gate;
		},
	});
	const db = mockDb({ log, save: cachedSave() });
	const refresh = updateSave(rt, db, "unbind-mid", { bound: TOKEN });
	await started;
	assert.equal(await clearUser(rt, "unbind-mid"), true);
	release();
	await refresh;
	await settle();
	assert.ok(log.includes(`del:${SAVE_KEY}`));
	assert.equal(log.includes(`set:${SAVE_KEY}`), false, "blob not re-created");
	assert.ok(log.includes(`set:${HISTORY_KEY}`), "score history still kept");
	log.length = 0;
	await getBoundToken(rt, "unbind-mid");
	await readSaveRaw(db, TOKEN, { memo: true });
	assert.deepEqual(log, ["kv:token", `kv:${SAVE_KEY}`], "nothing memoised");
});

test("a blob read still in flight when the user unbinds is not memoised", async () => {
	const log: string[] = [];
	let release: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const rt = mockRt({ log, getSaveInfo: async () => undefined });
	const db = mockDb({ log, save: cachedSave() });
	const get = db.get;
	let slow = true;
	db.get = async (key: string) => {
		if (slow) await gate;
		return get(key);
	};
	const stale = readSaveRaw(db, TOKEN);
	slow = false;
	assert.equal(await clearUser(rt, "unbind-read"), true);
	release();
	assert.ok(await stale, "the caller still gets what it read");
	log.length = 0;
	await readSaveRaw(db, TOKEN, { memo: true });
	assert.deepEqual(log, [`kv:${SAVE_KEY}`], "the late read was not remembered");
});

/** The mock store, with a binding that unbinds and other instances can drop */
function liveBinding(rt: PhiRuntime, log: string[]) {
	const state = { bound: true };
	const store = rt.store as unknown as {
		getSessionToken: () => Promise<string>;
		clearLocalCredentials: () => Promise<void>;
	};
	store.getSessionToken = async () => {
		log.push("kv:token");
		return state.bound ? TOKEN : "";
	};
	store.clearLocalCredentials = async () => {
		log.push("del:token");
		state.bound = false;
	};
	return state;
}

test("a refresh whose binding another instance dropped during the download does not write the blob back", async () => {
	const log: string[] = [];
	const rt = mockRt({
		log,
		saveUrl: "https://example.test/gone.zip",
		getSaveInfo: async () => undefined,
		buildRecord: async () => {
			binding.bound = false;
		},
	});
	const binding = liveBinding(rt, log);
	const db = mockDb({ log, save: cachedSave() });
	await updateSave(rt, db, "gone-remote", { bound: TOKEN });
	assert.equal(log.includes(`set:${SAVE_KEY}`), false, "blob not re-created");
	assert.ok(log.includes(`set:${HISTORY_KEY}`), "score history still kept");
	log.length = 0;
	assert.equal(await getBoundToken(rt, "gone-remote"), undefined);
	await readSaveRaw(db, TOKEN, { memo: true });
	assert.deepEqual(log, ["kv:token", `kv:${SAVE_KEY}`], "nothing memoised");
});

test("an unbind between the caller's token read and the refresh writes back neither the blob nor the memo", async () => {
	const log: string[] = [];
	const rt = mockRt({
		log,
		saveUrl: "https://example.test/late.zip",
		getSaveInfo: async () => undefined,
	});
	liveBinding(rt, log);
	const db = mockDb({ log, save: cachedSave() });
	// refreshSaveFor reads the token, then waits on the ban check and cooldown
	const token = await getToken(rt, "late-unbind");
	assert.equal(await clearUser(rt, "late-unbind"), true);
	await updateSave(rt, db, "late-unbind", { bound: token });
	await settle();
	assert.ok(log.includes(`del:${SAVE_KEY}`));
	assert.equal(log.includes(`set:${SAVE_KEY}`), false, "blob not re-created");
	log.length = 0;
	assert.equal(await getBoundToken(rt, "late-unbind"), undefined);
	assert.deepEqual(log, ["kv:token"], "token not memoised again");
});

test("a cache-hit refresh after an unbind does not memo the token again", async () => {
	const log: string[] = [];
	const rt = mockRt({ log, getSaveInfo: async () => undefined });
	liveBinding(rt, log);
	const db = mockDb({ log, save: cachedSave() });
	const token = await getToken(rt, "late-hit");
	assert.equal(await clearUser(rt, "late-hit"), true);
	await updateSave(rt, db, "late-hit", { bound: token });
	assert.equal(log.includes("download"), false, "served from the cached blob");
	log.length = 0;
	assert.equal(await getBoundToken(rt, "late-hit"), undefined);
	assert.deepEqual(log, ["kv:token"]);
});

test("a remembered revision skips the KV read for 10 minutes, then a refresh rewrites a blob another instance deleted", async () => {
	const log: string[] = [];
	const rt = mockRt({
		log,
		saveUrl: "https://example.test/trust.zip",
		getSaveInfo: async () => undefined,
	});
	const kv = new Map<string, string>([[SAVE_KEY, cachedSave()]]);
	const db: Kv = mockDb({ log });
	db.get = async (key: string) => {
		log.push(`kv:${key}`);
		return kv.get(key);
	};
	db.set = async (key: string, value: string) => {
		log.push(`set:${key}`);
		kv.set(key, value);
	};
	const orig = Date.now;
	let clock = 80_000_000;
	Date.now = () => clock;
	try {
		await updateSave(rt, db, "trust", { bound: TOKEN });
		assert.match(kv.get(SAVE_KEY) ?? "", /trust\.zip/, "changed save written");
		// The other Discord account on this save unbinds on another instance
		kv.delete(SAVE_KEY);
		clock += 9 * 60_000;
		log.length = 0;
		await updateSave(rt, db, "trust", { bound: TOKEN });
		assert.deepEqual(
			log.filter((l) => l.includes(SAVE_KEY) || l === "download"),
			[],
			"inside the window the remembered revision is trusted",
		);
		// The hit above must not have renewed the window
		clock += 60_001;
		log.length = 0;
		await updateSave(rt, db, "trust", { bound: TOKEN });
		assert.ok(log.includes(`kv:${SAVE_KEY}`), "KV read again");
		assert.ok(log.includes("download"));
		assert.match(kv.get(SAVE_KEY) ?? "", /trust\.zip/, "blob rewritten");
	} finally {
		Date.now = orig;
	}
});

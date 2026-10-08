import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Catalog, knownBackground } from "../plugins/phi/lib/catalog.ts";
import { getInfo } from "../plugins/phi/lib/get-info.ts";
import { parseInfoFileCache } from "../plugins/phi/lib/info-file.ts";
import {
	aliasesSha,
	applyKvLevels,
	applyLevelsCsv,
	applyNotesInfo,
	catalogRevision,
	hydrateSongInfo,
	INFO_STATE_KEY,
	infoFetchOpts,
	loadedCatalogRevision,
	onCatalogReload,
	reloadCatalog,
	resetSongInfoForTest,
	syncReady,
} from "./song-info.ts";
import { readFile } from "./vfs.ts";

function tmp() {
	return mkdtempSync(join(tmpdir(), "phi-info-"));
}

function objects(map: Record<string, string>) {
	return async (key: string) => {
		const v = map[key];
		return v == null ? undefined : Buffer.from(v);
	};
}

const CSV_HEAD =
	"id\tsong\tcomposer\tillustrator\tEZC\tHDC\tINC\tATC\tEZ\tHD\tIN\tAT\n";

test("hydrateSongInfo mounts complete R2 catalog over bundled files", async () => {
	resetSongInfoForTest();
	const assets = tmp();
	const cache = tmp();
	const info = join(assets, "info");
	mkdirSync(info, { recursive: true });
	writeFileSync(join(info, "info.csv"), "bundled-csv");
	writeFileSync(join(info, "tips.txt"), "bundled-tips");

	const result = await hydrateSongInfo({
		getObject: objects({
			[INFO_STATE_KEY]: JSON.stringify({
				commit: "abc123",
				pending: 0,
				phigros: "3.20.0",
				phigrosVerNum: 154,
			}),
			"info/info.csv": "id\tsong\nNWAD.Knighthood\tNWAD\n",
			"info/tips.txt": "from-r2",
		}),
		assetsDir: assets,
		cacheRoot: cache,
		files: ["info.csv", "tips.txt"],
	});

	assert.equal(result.commit, "abc123");
	assert.equal(result.phigros, "3.20.0");
	assert.equal(result.phigrosVerNum, 154);
	assert.equal(catalogRevision(), "abc123");
	assert.equal(
		readFile(join(info, "info.csv"), "utf8"),
		"id\tsong\nNWAD.Knighthood\tNWAD\n",
	);
	assert.equal(readFile(join(info, "tips.txt"), "utf8"), "from-r2");
	assert.equal(
		readFileSync(join(cache, "info.csv"), "utf8"),
		"id\tsong\nNWAD.Knighthood\tNWAD\n",
	);
});

test("hydrateSongInfo skips file downloads when the cached commit matches", async () => {
	resetSongInfoForTest();
	const assets = tmp();
	const cache = tmp();
	mkdirSync(join(assets, "info"), { recursive: true });
	await hydrateSongInfo({
		getObject: objects({
			[INFO_STATE_KEY]: JSON.stringify({ commit: "abc123", pending: 0 }),
			"info/info.csv": "one",
		}),
		assetsDir: assets,
		cacheRoot: cache,
		files: ["info.csv"],
	});

	const keys: string[] = [];
	await hydrateSongInfo({
		getObject: async (key) => {
			keys.push(key);
			if (key === INFO_STATE_KEY) {
				return Buffer.from(JSON.stringify({ commit: "abc123", pending: 0 }));
			}
			throw new Error(`unexpected fetch ${key}`);
		},
		assetsDir: assets,
		cacheRoot: cache,
		files: ["info.csv"],
	});

	assert.deepEqual(keys, [INFO_STATE_KEY]);
	assert.equal(readFile(join(assets, "info", "info.csv"), "utf8"), "one");
});

test("hydrateSongInfo downloads catalog files in parallel", async () => {
	resetSongInfoForTest();
	const assets = tmp();
	const cache = tmp();
	mkdirSync(join(assets, "info"), { recursive: true });
	let inflight = 0;
	let max = 0;
	const result = await hydrateSongInfo({
		getObject: async (key) => {
			if (key === INFO_STATE_KEY) {
				return Buffer.from(JSON.stringify({ commit: "par", pending: 0 }));
			}
			inflight += 1;
			max = Math.max(max, inflight);
			await new Promise((r) => setTimeout(r, 25));
			inflight -= 1;
			return Buffer.from(key);
		},
		assetsDir: assets,
		cacheRoot: cache,
		files: ["a.txt", "b.txt", "c.txt"],
	});
	assert.equal(result.commit, "par");
	assert.ok(max >= 3, `expected parallel fetches, max inflight ${max}`);
	assert.equal(readFile(join(assets, "info", "a.txt"), "utf8"), "info/a.txt");
});

test("hydrateSongInfo keeps bundled files when sync is pending or missing", async () => {
	resetSongInfoForTest();
	const assets = tmp();
	const cache = tmp();
	mkdirSync(join(assets, "info"), { recursive: true });
	writeFileSync(join(assets, "info", "info.csv"), "bundled-csv");

	const pending = await hydrateSongInfo({
		getObject: objects({
			[INFO_STATE_KEY]: JSON.stringify({ commit: "abc123", pending: 3 }),
			"info/info.csv": "partial",
		}),
		assetsDir: assets,
		cacheRoot: cache,
		files: ["info.csv"],
	});
	assert.equal(pending.commit, "bundled");
	assert.equal(
		readFile(join(assets, "info", "info.csv"), "utf8"),
		"bundled-csv",
	);

	resetSongInfoForTest();
	const missing = await hydrateSongInfo({
		getObject: async () => undefined,
		assetsDir: assets,
		cacheRoot: cache,
		files: ["info.csv"],
	});
	assert.equal(missing.commit, "bundled");
	assert.equal(catalogRevision(), "bundled");
});

test("hydrateSongInfo re-downloads when levelsSha changes with the same git commit", async () => {
	resetSongInfoForTest();
	const assets = tmp();
	const cache = tmp();
	mkdirSync(join(assets, "info"), { recursive: true });
	await hydrateSongInfo({
		getObject: objects({
			[INFO_STATE_KEY]: JSON.stringify({
				commit: "abc123",
				pending: 0,
				levelsSha: "old",
			}),
			"info/info.csv": "stale",
		}),
		assetsDir: assets,
		cacheRoot: cache,
		files: ["info.csv"],
	});

	const result = await hydrateSongInfo({
		getObject: objects({
			[INFO_STATE_KEY]: JSON.stringify({
				commit: "abc123",
				pending: 0,
				levelsSha: "new",
			}),
			"info/info.csv": "fresh",
		}),
		assetsDir: assets,
		cacheRoot: cache,
		files: ["info.csv"],
	});
	assert.equal(result.commit, "abc123");
	assert.equal(result.levelsSha, "new");
	assert.equal(catalogRevision(), "abc123:new");
	assert.equal(readFile(join(assets, "info", "info.csv"), "utf8"), "fresh");
});

test("applyLevelsCsv mounts KV csv over R2 and updates catalogRevision", async () => {
	resetSongInfoForTest();
	const assets = tmp();
	mkdirSync(join(assets, "info"), { recursive: true });
	writeFileSync(join(assets, "info", "info.csv"), "from-r2");
	const csv = `${CSV_HEAD}Credits.Frums\tCredits\tx\tx\t\t\t\t_鉄\t4.5\t10.4\t13.6\t15.8\n`;
	const cache = parseInfoFileCache(
		JSON.stringify({
			sha: "deadbeef",
			csv,
			songs: 1,
			maxDifficulty: 15.8,
			updatedAt: "2026-09-12T00:00:00.000Z",
		}),
	);
	assert.ok(cache);
	applyLevelsCsv(assets, cache);
	assert.equal(readFile(join(assets, "info", "info.csv"), "utf8"), csv);
	assert.equal(catalogRevision().endsWith(":deadbeef"), true);
	await getInfo.init(assets);
	assert.equal(getInfo.ori_info["Credits.Frums.0"]?.chart.AT?.difficulty, 15.8);
});

test("notesInfo mounted with the KV csv supplies combo for a song the bundle lacks", async () => {
	const assets = tmp();
	mkdirSync(join(assets, "info"), { recursive: true });
	writeFileSync(
		join(assets, "info", "info.csv"),
		`${CSV_HEAD}ExoplanetaryMirage.x\tExoplanetary Mirage\tx\tx\t\t\t\t\t8.7\t13.4\t16.9\t17.9\n`,
	);
	writeFileSync(join(assets, "info", "notesInfo.json"), "{}");
	applyNotesInfo(
		assets,
		Buffer.from(
			JSON.stringify({
				"ExoplanetaryMirage.x": {
					EZ: { t: [131, 429, 73, 37], m: 1 },
					AT: { t: [1152, 538, 211, 176], m: 1 },
				},
			}),
		),
	);
	await getInfo.init(assets);
	assert.equal(
		getInfo.ori_info["ExoplanetaryMirage.x.0"]?.chart.EZ?.combo,
		670,
	);
	assert.equal(
		getInfo.ori_info["ExoplanetaryMirage.x.0"]?.chart.AT?.combo,
		2077,
	);
});

test("getInfo.init replaces songs so a newer info.csv can drop old ids", async () => {
	const assets = tmp();
	mkdirSync(join(assets, "info"), { recursive: true });
	writeFileSync(
		join(assets, "info", "info.csv"),
		`${CSV_HEAD}Old.Song\tOld\tx\tx\t\t\t\t\t1\t2\t3\t\n`,
	);
	await getInfo.init(assets);
	assert.equal("Old.Song.0" in getInfo.ori_info, true);
	assert.deepEqual(getInfo.chartTotals(), [1, 1, 1, 0]);
	writeFileSync(
		join(assets, "info", "info.csv"),
		`${CSV_HEAD}NWAD.Knighthood\tNWAD\tx\tx\t\t\t\t\t5.5\t9.2\t15.6\t\n`,
	);
	await getInfo.init(assets);
	assert.equal("Old.Song.0" in getInfo.ori_info, false);
	assert.equal("NWAD.Knighthood.0" in getInfo.ori_info, true);
	const catalog = new Catalog(assets);
	assert.equal(catalog.size, 1);
	assert.ok(catalog.randomIll("blur").endsWith("illBlur/NWAD.Knighthood.png"));
	assert.equal(knownBackground("NWAD.Knighthood"), "NWAD.Knighthood.0");
	assert.equal(knownBackground("missing"), "");
	assert.equal(
		catalog.ill("NWAD.Knighthood", "blur"),
		catalog.randomIll("blur"),
	);
});

test("syncReady accepts pending as a count or as ill-sync's file list", () => {
	assert.equal(syncReady({ commit: "c", pending: 0 }), true);
	assert.equal(syncReady({ commit: "c" }), true);
	assert.equal(syncReady({ commit: "c", pending: [] }), true);
	assert.equal(syncReady({ commit: "c", pending: 2 }), false);
	assert.equal(syncReady({ commit: "c", pending: [{ key: "a" }] }), false);
	assert.equal(syncReady({ pending: 0 }), false);
	assert.equal(syncReady(undefined), false);
});

test("hydrateSongInfo hydrates when the live state has pending: []", async () => {
	resetSongInfoForTest();
	const assets = tmp();
	const cache = tmp();
	mkdirSync(join(assets, "info"), { recursive: true });
	const result = await hydrateSongInfo({
		getObject: objects({
			[INFO_STATE_KEY]: JSON.stringify({
				commit: "d3e36b18",
				pending: [],
				aliasesSha: "alias-sha-1",
			}),
			"info/nicklist.yaml": "Song.A:\n  - a\n",
		}),
		assetsDir: assets,
		cacheRoot: cache,
		files: ["nicklist.yaml"],
	});
	assert.equal(result.commit, "d3e36b18");
	assert.deepEqual(result.mounted, ["nicklist.yaml"]);
	assert.equal(result.fresh, true);
	assert.equal(result.aliasesSha, "alias-sha-1");
	assert.equal(aliasesSha(), "alias-sha-1");
	assert.equal(
		readFile(join(assets, "info", "nicklist.yaml"), "utf8"),
		"Song.A:\n  - a\n",
	);
});

test("hydrateSongInfo does not remount an unchanged cached set", async () => {
	resetSongInfoForTest();
	const assets = tmp();
	const cache = tmp();
	mkdirSync(join(assets, "info"), { recursive: true });
	const state = JSON.stringify({ commit: "abc", pending: 0 });
	await hydrateSongInfo({
		getObject: objects({ [INFO_STATE_KEY]: state, "info/info.csv": "one" }),
		assetsDir: assets,
		cacheRoot: cache,
		files: ["info.csv"],
	});
	writeFileSync(join(cache, "info.csv"), "changed-on-disk");
	const again = await hydrateSongInfo({
		getObject: objects({ [INFO_STATE_KEY]: state }),
		assetsDir: assets,
		cacheRoot: cache,
		files: ["info.csv"],
	});
	assert.deepEqual(again.mounted, []);
	assert.equal(again.fresh, false);
	assert.equal(readFile(join(assets, "info", "info.csv"), "utf8"), "one");

	// A new process (fresh module state) mounts the /tmp copy once
	resetSongInfoForTest();
	const cold = await hydrateSongInfo({
		getObject: objects({ [INFO_STATE_KEY]: state }),
		assetsDir: assets,
		cacheRoot: cache,
		files: ["info.csv"],
	});
	assert.deepEqual(cold.mounted, ["info.csv"]);
	assert.equal(cold.fresh, false);
	assert.equal(
		readFile(join(assets, "info", "info.csv"), "utf8"),
		"changed-on-disk",
	);
});

test("aliasesSha follows the sync state but survives an unreadable read", async () => {
	resetSongInfoForTest();
	const assets = tmp();
	const cache = tmp();
	const run = (state: unknown) =>
		hydrateSongInfo({
			getObject: async (key) =>
				key === INFO_STATE_KEY && state !== undefined
					? Buffer.from(JSON.stringify(state))
					: undefined,
			assetsDir: assets,
			cacheRoot: cache,
			files: [],
		});
	await run({ commit: "c", pending: 1, aliasesSha: "s1" });
	assert.equal(aliasesSha(), "s1");
	await run(undefined);
	assert.equal(aliasesSha(), "s1");
	await run({ commit: "c", pending: 0 });
	assert.equal(aliasesSha(), undefined);
});

function infoCache(sha: string, csv: string) {
	const cache = parseInfoFileCache(
		JSON.stringify({
			sha,
			csv,
			songs: 1,
			maxDifficulty: 15.8,
			updatedAt: "2026-10-06T00:00:00.000Z",
		}),
	);
	assert.ok(cache);
	return cache;
}

test("applyKvLevels downloads notesInfo once per csv sha", async () => {
	resetSongInfoForTest();
	const assets = tmp();
	const cacheRoot = tmp();
	mkdirSync(join(assets, "info"), { recursive: true });
	let downloads = 0;
	const getNotes = async () => {
		downloads += 1;
		return Buffer.from(`{"n":${downloads}}`);
	};
	const deps = { assets, cacheRoot, getNotes };
	const v1 = infoCache("sha1", `${CSV_HEAD}A.b\tA\tb\tx\t\t\t\t\t1\t2\t3\t\n`);

	await applyKvLevels(v1, undefined, deps);
	await applyKvLevels(v1, { mounted: [], fresh: false }, deps);
	assert.equal(downloads, 1);
	assert.equal(catalogRevision(), "bundled:sha1");
	assert.equal(
		readFile(join(assets, "info", "notesInfo.json"), "utf8"),
		'{"n":1}',
	);

	// A fresh R2 download of notesInfo.json is already current: no second fetch
	const v2 = infoCache("sha2", v1.csv);
	await applyKvLevels(v2, { mounted: ["notesInfo.json"], fresh: true }, deps);
	assert.equal(downloads, 1);
	assert.equal(catalogRevision(), "bundled:sha2");

	// A remount from /tmp replaces both overlays, so they are applied again
	writeFileSync(join(assets, "info", "info.csv"), "r2-csv");
	await hydrateSongInfo({
		getObject: objects({
			[INFO_STATE_KEY]: JSON.stringify({ commit: "c", pending: 0 }),
			"info/info.csv": "r2-csv",
			"info/notesInfo.json": "{}",
		}),
		assetsDir: assets,
		cacheRoot: tmp(),
		files: ["info.csv"],
	});
	assert.equal(catalogRevision(), "c");
	await applyKvLevels(v2, { mounted: ["info.csv"], fresh: true }, deps);
	assert.equal(catalogRevision(), "c:sha2");
	assert.equal(readFile(join(assets, "info", "info.csv"), "utf8"), v1.csv);
	assert.equal(downloads, 1);
});

test("loadedCatalogRevision trails catalogRevision until getInfo re-parses", async () => {
	resetSongInfoForTest();
	const assets = tmp();
	const cacheRoot = tmp();
	mkdirSync(join(assets, "info"), { recursive: true });
	let reloads = 0;
	onCatalogReload(() => {
		reloads += 1;
	});
	applyLevelsCsv(
		assets,
		infoCache("sha1", `${CSV_HEAD}A.b\tSong A\tb\tx\t\t\t\t\t1\t2\t3\t\n`),
		cacheRoot,
	);
	assert.equal(await reloadCatalog(assets), true);
	assert.equal(loadedCatalogRevision(), "bundled:sha1");
	assert.equal(await reloadCatalog(assets), false);
	assert.equal(reloads, 1);

	// A refresh mounted a newer csv; getInfo still holds the old one
	applyLevelsCsv(
		assets,
		infoCache("sha2", `${CSV_HEAD}C.d\tSong C\td\tx\t\t\t\t\t1\t2\t3\t\n`),
		cacheRoot,
	);
	assert.equal(catalogRevision(), "bundled:sha2");
	assert.equal(loadedCatalogRevision(), "bundled:sha1");
	assert.ok(getInfo.ori_info["A.b.0"]);
	assert.equal(await reloadCatalog(assets), true);
	assert.equal(loadedCatalogRevision(), "bundled:sha2");
	assert.ok(getInfo.ori_info["C.d.0"]);
	assert.equal(getInfo.ori_info["A.b.0"], undefined);
	assert.equal(reloads, 2);
});

test("a file R2 fails to send keeps the last complete set and is the only one fetched again", async () => {
	resetSongInfoForTest();
	const assets = tmp();
	const cache = tmp();
	mkdirSync(join(assets, "info"), { recursive: true });
	const files = ["info.csv", "tips.txt"];
	await hydrateSongInfo({
		getObject: objects({
			[INFO_STATE_KEY]: JSON.stringify({ commit: "old", pending: 0 }),
			"info/info.csv": "old-csv",
			"info/tips.txt": "old-tips",
		}),
		assetsDir: assets,
		cacheRoot: cache,
		files,
	});
	assert.equal(catalogRevision(), "old");

	const state = JSON.stringify({ commit: "new", pending: 0 });
	const keys: string[] = [];
	let tipsUp = false;
	const getObject = async (key: string) => {
		keys.push(key);
		if (key === INFO_STATE_KEY) return Buffer.from(state);
		if (key === "info/info.csv") return Buffer.from("new-csv");
		// R2 5xx: fetchR2Object resolves undefined
		if (key === "info/tips.txt")
			return tipsUp ? Buffer.from("new-tips") : undefined;
		throw new Error(`unexpected fetch ${key}`);
	};
	const partial = await hydrateSongInfo({
		getObject,
		assetsDir: assets,
		cacheRoot: cache,
		files,
	});
	assert.equal(partial.commit, "old", "the revision is not marked complete");
	assert.equal(catalogRevision(), "old");
	assert.deepEqual(partial.mounted, []);
	assert.equal(readFile(join(assets, "info", "info.csv"), "utf8"), "old-csv");
	assert.equal(readFileSync(join(cache, "info.csv"), "utf8"), "old-csv");
	assert.match(readFileSync(join(cache, "_meta.json"), "utf8"), /"old"/);

	keys.length = 0;
	tipsUp = true;
	const done = await hydrateSongInfo({
		getObject,
		assetsDir: assets,
		cacheRoot: cache,
		files,
	});
	assert.deepEqual(
		keys,
		[INFO_STATE_KEY, "info/tips.txt"],
		"info.csv not re-downloaded",
	);
	assert.equal(done.commit, "new");
	assert.deepEqual(done.mounted, files);
	assert.equal(done.fresh, false, "info.csv came from the earlier check");
	assert.equal(catalogRevision(), "new");
	assert.equal(readFile(join(assets, "info", "info.csv"), "utf8"), "new-csv");
	assert.equal(readFile(join(assets, "info", "tips.txt"), "utf8"), "new-tips");
	assert.match(readFileSync(join(cache, "_meta.json"), "utf8"), /"new"/);

	// Complete now: the next check reads only the sync state
	keys.length = 0;
	await hydrateSongInfo({
		getObject,
		assetsDir: assets,
		cacheRoot: cache,
		files,
	});
	assert.deepEqual(keys, [INFO_STATE_KEY]);
});

test("a file still missing after five checks is mounted without marking the revision complete, and retried", async () => {
	resetSongInfoForTest();
	const assets = tmp();
	const cache = tmp();
	mkdirSync(join(assets, "info"), { recursive: true });
	const keys: string[] = [];
	let tipsUp = false;
	const opts = {
		getObject: async (key: string) => {
			keys.push(key);
			if (key === INFO_STATE_KEY)
				return Buffer.from(JSON.stringify({ commit: "gone", pending: 0 }));
			if (key === "info/info.csv") return Buffer.from("csv");
			if (key === "info/tips.txt" && tipsUp) return Buffer.from("tips");
			return undefined;
		},
		assetsDir: assets,
		cacheRoot: cache,
		files: ["info.csv", "tips.txt"],
	};
	for (let i = 1; i < 5; i++) {
		const r = await hydrateSongInfo(opts);
		assert.equal(r.commit, "bundled", `check ${i}`);
	}
	const gaveUp = await hydrateSongInfo(opts);
	assert.equal(gaveUp.commit, "gone+partial", "labelled apart from complete");
	assert.deepEqual(gaveUp.mounted, ["info.csv"]);
	assert.equal(readFile(join(assets, "info", "info.csv"), "utf8"), "csv");
	assert.equal(existsSync(join(cache, "_meta.json")), false, "not complete");
	assert.equal(
		existsSync(join(cache, "info.csv")),
		false,
		"/tmp keeps sets whole",
	);

	// Checks 6-9 do not ask R2; the 10th retries only the missing file
	keys.length = 0;
	for (let i = 6; i < 10; i++) {
		const r = await hydrateSongInfo(opts);
		assert.equal(r.commit, "gone+partial");
		assert.deepEqual(r.mounted, []);
	}
	assert.deepEqual(keys, Array(4).fill(INFO_STATE_KEY));
	keys.length = 0;
	tipsUp = true;
	const done = await hydrateSongInfo(opts);
	assert.deepEqual(keys, [INFO_STATE_KEY, "info/tips.txt"]);
	assert.equal(done.commit, "gone", "the revision moves, so getInfo re-parses");
	assert.deepEqual(done.mounted, ["tips.txt"], "info.csv is not remounted");
	assert.equal(done.fresh, true);
	assert.equal(readFile(join(assets, "info", "tips.txt"), "utf8"), "tips");
	assert.match(readFileSync(join(cache, "_meta.json"), "utf8"), /"gone"/);
	assert.equal(readFileSync(join(cache, "info.csv"), "utf8"), "csv");
	assert.equal(readFileSync(join(cache, "tips.txt"), "utf8"), "tips");
});

test("a revision none of whose files download is never taken", async () => {
	resetSongInfoForTest();
	const assets = tmp();
	const cache = tmp();
	mkdirSync(join(assets, "info"), { recursive: true });
	const opts = {
		getObject: objects({
			[INFO_STATE_KEY]: JSON.stringify({ commit: "empty", pending: 0 }),
		}),
		assetsDir: assets,
		cacheRoot: cache,
		files: ["info.csv", "tips.txt"],
	};
	for (let i = 1; i <= 7; i++) {
		const r = await hydrateSongInfo(opts);
		assert.equal(r.commit, "bundled", `check ${i}`);
		assert.deepEqual(r.mounted, []);
	}
	assert.equal(catalogRevision(), "bundled");
	assert.equal(existsSync(join(cache, "_meta.json")), false);
});

test("info files are fetched without the known-missing memo; the sync state keeps it", () => {
	assert.equal(infoFetchOpts("info/tips.txt").negative, false);
	assert.equal(infoFetchOpts(INFO_STATE_KEY).negative, true);
	assert.equal(infoFetchOpts("info/info.csv").cache, "no-store");
});

test("a partial set the last complete set was remounted over is mounted again", async () => {
	resetSongInfoForTest();
	const assets = tmp();
	const cache = tmp();
	mkdirSync(join(assets, "info"), { recursive: true });
	const files = ["info.csv", "tips.txt"];
	await hydrateSongInfo({
		getObject: objects({
			[INFO_STATE_KEY]: JSON.stringify({ commit: "old", pending: 0 }),
			"info/info.csv": "old-csv",
			"info/tips.txt": "old-tips",
		}),
		assetsDir: assets,
		cacheRoot: cache,
		files,
	});
	let state = JSON.stringify({ commit: "new", pending: 0 });
	const opts = {
		getObject: async (key: string) => {
			if (key === INFO_STATE_KEY) return Buffer.from(state);
			if (key === "info/info.csv") return Buffer.from("new-csv");
			return undefined;
		},
		assetsDir: assets,
		cacheRoot: cache,
		files,
	};
	for (let i = 1; i < 5; i++) await hydrateSongInfo(opts);
	assert.equal((await hydrateSongInfo(opts)).commit, "new+partial");
	assert.equal(readFile(join(assets, "info", "info.csv"), "utf8"), "new-csv");
	// ill-sync starts another copy: the last complete set comes back
	state = JSON.stringify({ commit: "new", pending: 3 });
	const back = await hydrateSongInfo(opts);
	assert.equal(back.commit, "old");
	assert.deepEqual(back.mounted, files);
	assert.equal(readFile(join(assets, "info", "info.csv"), "utf8"), "old-csv");
	state = JSON.stringify({ commit: "new", pending: 0 });
	const again = await hydrateSongInfo(opts);
	assert.equal(again.commit, "new+partial");
	assert.deepEqual(again.mounted, ["info.csv"]);
	assert.equal(readFile(join(assets, "info", "info.csv"), "utf8"), "new-csv");
});

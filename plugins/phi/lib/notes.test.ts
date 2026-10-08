import assert from "node:assert/strict";
import test from "node:test";
import type { Kv } from "../../../src/sdk/index.ts";
import { kvKey } from "./const.ts";
import {
	B30_AVG_KINDS,
	b30AvgKindOf,
	getNotes,
	isB30AvgKind,
	setB30AvgKind,
	setCardQuality,
} from "./notes.ts";

function memKv() {
	const map = new Map<string, string>();
	const db = {
		get: async (k: string) => map.get(k),
		set: async (k: string, v: string) => {
			map.set(k, v);
		},
	} as unknown as Kv;
	return { map, db };
}

test("b30AvgKind accepts the peer modes, rank and none only", () => {
	assert.deepEqual([...B30_AVG_KINDS], ["all", "top", "rank", "none"]);
	// B30 average is gone (phib19 answers it with no figures): a stored one reads as Average
	assert.ok(!isB30AvgKind("b30"));
	for (const kind of B30_AVG_KINDS) assert.ok(isB30AvgKind(kind));
	assert.ok(!isB30AvgKind("Rank"));
	assert.ok(!isB30AvgKind(""));
	assert.ok(!isB30AvgKind(undefined));
});

test("getNotes keeps any stored mode; b30AvgKindOf reads unknown ones as all", async () => {
	const kv = memKv();
	assert.equal((await getNotes(kv.db, "u1")).b30AvgKind, "all");
	kv.map.set(kvKey("notes", "u1"), JSON.stringify({ b30AvgKind: "rank" }));
	assert.equal(b30AvgKindOf(await getNotes(kv.db, "u1")), "rank");
	// A mode the Discord bot stored: kept as is, used as "all"
	kv.map.set(kvKey("notes", "u1"), JSON.stringify({ b30AvgKind: "median" }));
	const notes = await getNotes(kv.db, "u1");
	assert.equal(notes.b30AvgKind, "median");
	assert.equal(b30AvgKindOf(notes), "all");
	// Another webui setting saved later doesn't overwrite it
	await setCardQuality(kv.db, "u1", "high");
	const raw = JSON.parse(kv.map.get(kvKey("notes", "u1"))!);
	assert.equal(raw.b30AvgKind, "median");
	assert.equal(raw.cardQuality, "high");
});

test("setB30AvgKind stores the choice and keeps the other options", async () => {
	const kv = memKv();
	kv.map.set(
		kvKey("notes", "u2"),
		JSON.stringify({ cardQuality: "high", allowApiUsage: false }),
	);
	await setB30AvgKind(kv.db, "u2", "rank");
	const notes = await getNotes(kv.db, "u2");
	assert.equal(notes.b30AvgKind, "rank");
	assert.equal(notes.cardQuality, "high");
	assert.equal(notes.allowApiUsage, false);
});

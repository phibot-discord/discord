import assert from "node:assert/strict";
import test from "node:test";
import {
	INFO_FILE_KV_KEY,
	type InfoFileCache,
	parseInfoFileCache,
} from "./info-file.ts";

test("INFO_FILE_KV_KEY matches the shared phi:infoFile cache", () => {
	assert.equal(INFO_FILE_KV_KEY, "phi:infoFile");
});

test("parseInfoFileCache reads worker payload with csv + sha", () => {
	const payload: InfoFileCache = {
		sha: "abc",
		csv: "id\tsong\nCredits.Frums\tCredits\n",
		songs: 1,
		maxDifficulty: 15.8,
		updatedAt: "2026-09-12T00:00:00.000Z",
	};
	const parsed = parseInfoFileCache(JSON.stringify(payload));
	assert.deepEqual(parsed, payload);
});

test("parseInfoFileCache ignores empty or malformed values", () => {
	assert.equal(parseInfoFileCache(null), undefined);
	assert.equal(parseInfoFileCache(""), undefined);
	assert.equal(parseInfoFileCache("{"), undefined);
	assert.equal(parseInfoFileCache(JSON.stringify({ sha: "x" })), undefined);
});

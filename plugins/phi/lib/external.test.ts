import assert from "node:assert/strict";
import test from "node:test";
import { watchExternal } from "./external.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a lookup answered from memory never reports a wait; a slow one does, until the last settles", async () => {
	const fast: boolean[] = [];
	const w1 = watchExternal((on) => fast.push(on));
	await w1.track(sleep(5));
	assert.deepEqual(fast, []);
	assert.ok((w1.ms() ?? -1) >= 0);

	const slow: boolean[] = [];
	const w2 = watchExternal((on) => slow.push(on));
	const a = w2.track(sleep(450));
	const b = w2.track(sleep(600).then(() => Promise.reject(new Error("late"))));
	await a;
	assert.deepEqual(slow, [true], "still waiting on b");
	await b.catch(() => undefined);
	await sleep(0);
	assert.deepEqual(slow, [true, false]);
	// Side by side: wall time, not the sum
	const ms = w2.ms() ?? 0;
	assert.ok(ms >= 590 && ms < 1000, `ms ${ms}`);
});

test("no lookup, no time", () => {
	assert.equal(watchExternal().ms(), undefined);
});

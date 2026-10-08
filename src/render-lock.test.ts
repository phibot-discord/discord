import assert from "node:assert/strict";
import test from "node:test";
import { Semaphore, withTimeout } from "./render-lock.ts";

function gate() {
	let open!: () => void;
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { open, opened };
}

test("an aborted waiter leaves the queue without taking a slot", async () => {
	const lock = new Semaphore(1);
	const first = gate();
	const holding = lock.run(() => first.opened);
	const ac = new AbortController();
	const waiting = lock.run(async () => "never", ac.signal);
	assert.equal(lock.queued, 1);
	ac.abort(new Error("render timed out"));
	await assert.rejects(waiting, /render timed out/);
	assert.equal(lock.queued, 0);
	first.open();
	await holding;
	assert.equal(lock.busy, 0);
	assert.equal(await lock.run(async () => "next"), "next");
});

test("an already-aborted signal never runs the work", async () => {
	const lock = new Semaphore(1);
	const ac = new AbortController();
	ac.abort();
	let ran = false;
	await assert.rejects(
		lock.run(async () => {
			ran = true;
		}, ac.signal),
	);
	assert.equal(ran, false);
	assert.equal(lock.busy, 0);
});

test("withTimeout aborts the work's controller when it fires", async () => {
	const ac = new AbortController();
	const never = new Promise<string>(() => {});
	await assert.rejects(withTimeout(never, 10, "card", ac), /card timed out/);
	assert.equal(ac.signal.aborted, true);
	assert.match(String(ac.signal.reason), /card timed out after 10ms/);
});

test("withTimeout leaves the controller alone when the work finishes", async () => {
	const ac = new AbortController();
	assert.equal(await withTimeout(Promise.resolve(7), 50, "card", ac), 7);
	assert.equal(ac.signal.aborted, false);
});

import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mountBytes, readFileAsync, remove, rename, touch } from "./vfs.ts";

test("readFileAsync reads mounted bytes and disk files", async () => {
	mountBytes("/virtual/phi/a.bin", new Uint8Array([1, 2, 3]));
	assert.deepEqual([...(await readFileAsync("/virtual/phi/a.bin"))], [1, 2, 3]);
	const dir = mkdtempSync(join(tmpdir(), "phi-vfs-"));
	writeFileSync(join(dir, "b.txt"), "disk");
	assert.equal((await readFileAsync(join(dir, "b.txt"))).toString(), "disk");
	await assert.rejects(readFileAsync(join(dir, "missing")));
});

test("rename, touch and remove work on disk files", () => {
	const dir = mkdtempSync(join(tmpdir(), "phi-vfs-"));
	const a = join(dir, "a.tmp");
	const b = join(dir, "b.png");
	writeFileSync(a, "x");
	rename(a, b);
	assert.equal(existsSync(a), false);
	const old = new Date(1_700_000_000_000);
	utimesSync(b, old, old);
	touch(b);
	assert.ok(statSync(b).mtimeMs > old.getTime() + 60_000);
	remove(b);
	assert.equal(existsSync(b), false);
	remove(b);
});

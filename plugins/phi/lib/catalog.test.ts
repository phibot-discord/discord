import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { backgroundOptions } from "./catalog.ts";
import { getInfo } from "./get-info.ts";

const CSV_HEAD =
	"id\tsong\tcomposer\tillustrator\tEZC\tHDC\tINC\tATC\tEZ\tHD\tIN\tAT\n";

function assets(rows: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), "phi-catalog-"));
	mkdirSync(join(dir, "info"), { recursive: true });
	writeFileSync(join(dir, "info", "info.csv"), CSV_HEAD + rows.join("\n"));
	return dir;
}

test("background options are built once per catalog and rebuilt after a reload", async () => {
	await getInfo.init(
		assets([
			"Zeta.B\tZeta\tb\tx\t\t\t\t\t1\t2\t3\t4",
			"Alpha.A\talpha\ta\tx\t\t\t\t\t1\t2\t3\t4",
		]),
	);
	const first = backgroundOptions();
	assert.deepEqual(
		first.map((o) => o.song),
		["alpha", "Zeta"],
	);
	assert.equal(backgroundOptions(), first);

	await getInfo.init(assets(["Mid.M\tMid\tm\tx\t\t\t\t\t1\t2\t3\t4"]));
	const second = backgroundOptions();
	assert.notEqual(second, first);
	assert.deepEqual(
		second.map((o) => o.id),
		["Mid.M.0"],
	);
});

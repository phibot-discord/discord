import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getInfo, withDotZero } from "./get-info.ts";

const CSV_HEAD =
	"id\tsong\tcomposer\tillustrator\tEZC\tHDC\tINC\tATC\tEZ\tHD\tIN\tAT\n";

function assets(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "phi-getinfo-"));
	mkdirSync(join(dir, "info"), { recursive: true });
	writeFileSync(
		join(dir, "info", "info.csv"),
		`${CSV_HEAD}Igallta.SeURa\tIgallta\tSe-U-Ra\tx\t\t\t\t\t3\t9\t14\t16.4\n`,
	);
	for (const [name, body] of Object.entries(files)) {
		writeFileSync(join(dir, "info", name), body);
	}
	return dir;
}

test("withDotZero is idempotent", () => {
	assert.equal(withDotZero("Igallta.SeURa"), "Igallta.SeURa.0");
	assert.equal(withDotZero("Igallta.SeURa.0"), "Igallta.SeURa.0");
});

test("chaplist.yaml indexes chapter nicknames, coercing bare numbers", async () => {
	await getInfo.init(
		assets({
			"chaplist.yaml": "Chapter 5 霓虹灯牌:\n  - C5\n  - 5\n  - '  '\n",
			"nicklist.yaml": "Igallta.SeURa:\n  - 7\n",
		}),
	);
	assert.deepEqual(getInfo.chapList, { "Chapter 5 霓虹灯牌": ["C5", "5"] });
	assert.deepEqual(getInfo.chapNick.C5, ["Chapter 5 霓虹灯牌"]);
	assert.deepEqual(getInfo.chapNick["5"], ["Chapter 5 霓虹灯牌"]);
	assert.equal(getInfo.ori_info["Igallta.SeURa.0"]?.song, "Igallta");
});

test("a malformed or odd-shaped chaplist.yaml leaves the song catalog intact", async () => {
	for (const body of ["- C5\n- C6\n", "Chapter 5: C5\n", "a: [b\n", ""]) {
		await getInfo.init(assets({ "chaplist.yaml": body }));
		assert.deepEqual(getInfo.chapList, {}, JSON.stringify(body));
		assert.deepEqual(getInfo.chapNick, {});
		assert.equal(getInfo.ori_info["Igallta.SeURa.0"]?.song, "Igallta");
	}
});

import assert from "node:assert/strict";
import test from "node:test";
import { getInfo } from "./get-info.ts";
import { Save, type SavePayload } from "./save.ts";

function payload(rks: number, clg = 0): SavePayload {
	return {
		session: "token",
		saveInfo: {
			PlayerId: "1",
			modifiedAt: { iso: new Date(0) },
			summary: { rankingScore: rks, challengeModeRank: clg },
		},
		gameRecord: {},
	} as SavePayload;
}

test("an RKS under the catalog max is accepted", () => {
	const prev = getInfo.MAX_DIFFICULTY;
	getInfo.MAX_DIFFICULTY = 17.9;
	try {
		const save = new Save(payload(17.7));
		assert.equal(save.saveInfo.summary.rankingScore, 17.7);
		assert.throws(() => new Save(payload(18)), /rks异常/);
	} finally {
		getInfo.MAX_DIFFICULTY = prev;
	}
});

test("the challenge level cap follows the highest catalog level", () => {
	const prev = getInfo.MAX_DIFFICULTY;
	try {
		getInfo.MAX_DIFFICULTY = 18;
		assert.equal(
			new Save(payload(16, 252)).saveInfo.summary.challengeModeRank,
			252,
		);
		assert.throws(() => new Save(payload(16, 255)), /rks异常/);
		getInfo.MAX_DIFFICULTY = 17.9;
		assert.throws(() => new Save(payload(16, 252)), /rks异常/);
		getInfo.MAX_DIFFICULTY = 0;
		assert.equal(
			new Save(payload(16, 351)).saveInfo.summary.challengeModeRank,
			351,
		);
		assert.throws(() => new Save(payload(16, 352)), /rks异常/);
	} finally {
		getInfo.MAX_DIFFICULTY = prev;
	}
});

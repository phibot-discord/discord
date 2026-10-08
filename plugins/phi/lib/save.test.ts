import assert from "node:assert/strict";
import test from "node:test";
import { getInfo } from "./get-info.ts";
import { Save, type SavePayload } from "./save.ts";

function payload(rks: number): SavePayload {
	return {
		session: "token",
		saveInfo: {
			PlayerId: "1",
			modifiedAt: { iso: new Date(0) },
			summary: { rankingScore: rks, challengeModeRank: 0 },
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

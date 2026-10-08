import { join } from "node:path";
import type { Kv } from "../../../src/sdk/index.ts";
import { cardCopy, fill, resolvePhiLocale } from "./card-i18n.ts";
import { type Catalog, chosenIll } from "./catalog.ts";
import type { LineSeg } from "./charts.ts";
import { kvKey } from "./const.ts";
import { fCompute } from "./fcompute.ts";
import type { UserNotes } from "./notes.ts";
import type { PhiRuntime } from "./runtime.ts";
import type { Save } from "./save.ts";
import { openHistory, SaveHistory } from "./save-history.ts";
import { moneyText } from "./saves.ts";
import { b30Movement } from "./variants/update-summary.ts";

const LEVELS = ["EZ", "HD", "IN", "AT"] as const;
const HISTORY_DAY = 10;
const HISTORY_DATE = 10;
const HISTORY_TOT = 50;
const UPDATE_ROW_TILES = 5;

type HisSnap = {
	t: number;
	rks: number;
	phi: { id: string; rank: string }[];
	b27: { id: string; rank: string }[];
};

function historyKey(token: string) {
	return kvKey("history", token);
}

function hisb30Key(userId: string) {
	return kvKey("hisb30", userId);
}

function serializeHistory(h: {
	version: number;
	scoreHistory: unknown;
	rks: { date: Date | string; value: number }[];
	data: { date: Date | string; value: number[] }[];
	challengeModeRank: { date: Date | string; value: number }[];
}) {
	return {
		version: h.version || 3,
		scoreHistory: h.scoreHistory || {},
		rks: (h.rks || []).map((x) => ({ date: x.date, value: x.value })),
		data: (h.data || []).map((x) => ({ date: x.date, value: x.value })),
		challengeModeRank: (h.challengeModeRank || []).map((x) => ({
			date: x.date,
			value: x.value,
		})),
	};
}

function parseSaveHistory(raw: string | undefined) {
	if (raw) {
		try {
			return new SaveHistory(JSON.parse(raw));
		} catch {
			/* fall through */
		}
	}
	return new SaveHistory(null);
}

/** The stored history blob, for callers that want to start the read early */
export function readSaveHistoryRaw(
	db: Pick<Kv, "get">,
	token: string,
): Promise<string | undefined> {
	return db.get(historyKey(token));
}

export async function loadSaveHistory(_rt: PhiRuntime, db: Kv, token: string) {
	// Manual ("no account") profiles have no TapTap token and no score history
	if (!token) return new SaveHistory(null);
	return parseSaveHistory(await readSaveHistoryRaw(db, token));
}

/** `raw`: the history read already in flight (see `readSaveHistoryRaw`) */
export async function applySaveToHistory(
	rt: PhiRuntime,
	db: Kv,
	token: string,
	save: Save,
	raw?: Promise<string | undefined>,
) {
	const history = raw
		? parseSaveHistory(await raw)
		: await loadSaveHistory(rt, db, token);
	history.update(save);
	await db.set(historyKey(token), JSON.stringify(serializeHistory(history)));
	return history;
}

export async function loadHisb30Snaps(
	db: Kv,
	userId: string,
): Promise<HisSnap[]> {
	const raw = await db.get(hisb30Key(userId));
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as HisSnap[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function rangePct(value: number, span: number[]) {
	const a = span[0] ?? 0;
	const b = span[span.length - 1] ?? a;
	if (a === b) return 50;
	return Math.abs(((value - a) / (b - a)) * 100);
}

function rksLineFromRecords(
	items: { date: Date | string | number; value: number }[],
) {
	const data = items
		.map((item) => ({ date: new Date(item.date), value: Number(item.value) }))
		.filter(
			(item) =>
				Number.isFinite(item.value) && Number.isFinite(item.date.getTime()),
		);
	if (!data.length)
		return {
			rks_history: [] as LineSeg[],
			rks_range: [0, 1],
			rks_date: ["", ""] as [string, string],
		};

	const kept: { date: Date; value: number }[] = [];
	const rks_range = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
	const rks_date: [number, number] = [data[0]!.date.getTime(), 0];
	for (let i = 0; i < data.length; i++) {
		const item = data[i]!;
		if (i <= 1 || item.value !== kept[kept.length - 2]?.value) {
			kept.push(item);
			rks_range[0] = Math.min(rks_range[0]!, item.value);
			rks_range[1] = Math.max(rks_range[1]!, item.value);
		} else {
			kept[kept.length - 1]!.date = item.date;
		}
		rks_date[1] = item.date.getTime();
	}

	const segs: LineSeg[] = [];
	for (let i = 0; i < kept.length - 1; i++) {
		const a = kept[i]!;
		const b = kept[i + 1]!;
		if (a.date.getTime() === b.date.getTime() && a.value === b.value) continue;
		segs.push([
			rangePct(a.date.getTime(), rks_date),
			rangePct(a.value, rks_range),
			rangePct(b.date.getTime(), rks_date),
			rangePct(b.value, rks_range),
		]);
	}
	if (!segs.length) segs.push([0, 50, 100, 50]);
	if (rks_range[0] === rks_range[1]) {
		rks_range[0] = rks_range[0]! - 0.01;
		rks_range[1] = rks_range[1]! + 0.01;
	}
	return {
		rks_history: segs,
		rks_range,
		rks_date: [
			fCompute.formatDate(rks_date[0]),
			fCompute.formatDate(rks_date[1]),
		] as [string, string],
	};
}

function formatHistoryDate(rt: PhiRuntime, value: unknown) {
	try {
		return rt.fCompute.formatDate(value as string | number | Date | undefined);
	} catch {
		const d = new Date(value as string | number | Date);
		return d.toISOString().slice(0, 19).replace("T", " ");
	}
}

export async function rksLineFor(
	rt: PhiRuntime,
	history: Awaited<ReturnType<typeof loadSaveHistory>>,
	snaps: HisSnap[],
) {
	if (history.rks?.length) return rksLineFromRecords(history.rks);
	const fromHist = history.getRksLine();
	if (fromHist.rks_history?.length) {
		return {
			rks_history: fromHist.rks_history as LineSeg[],
			rks_range:
				fromHist.rks_range?.[0] === fromHist.rks_range?.[1]
					? [fromHist.rks_range[0]! - 0.01, fromHist.rks_range[1]! + 0.01]
					: fromHist.rks_range,
			rks_date: [
				formatHistoryDate(rt, fromHist.rks_date[0]),
				formatHistoryDate(rt, fromHist.rks_date[1]),
			] as [string, string],
		};
	}
	if (snaps.length) {
		return rksLineFromRecords(
			snaps.map((s) => ({ date: s.t, value: Number(s.rks) || 0 })),
		);
	}
	return {
		rks_history: [] as LineSeg[],
		rks_range: [0, 1],
		rks_date: ["", ""] as [string, string],
	};
}

function randomColor(rt: PhiRuntime) {
	try {
		return String(rt.fCompute.getRandomBgColor());
	} catch {
		const n = Math.floor(Math.random() * 0xa0a0a0);
		return `#${n.toString(16).padStart(6, "0")}`;
	}
}

export function accRksLines(save: Save) {
	const acc_rksRecord = [...(save.getRecord?.() || [])];
	const phi = acc_rksRecord
		.filter((r: { acc: number }) => r.acc === 100)
		.slice(0, 3);
	let phi_rks = 0;
	for (const r of phi) phi_rks += r.rks || 0;
	const acc_rks_data: [number, number][] = [];
	let acc_rks_range = [100, 0];
	const acc_rks_AccRange = [100];
	for (let i = 0; i < Math.min(acc_rksRecord.length, 27); i++) {
		acc_rks_AccRange[0] = Math.min(
			acc_rks_AccRange[0]!,
			acc_rksRecord[i]?.acc ?? 0,
		);
	}
	const rec = [...acc_rksRecord];
	const startAcc = Number(acc_rks_AccRange[0]);
	const from = Number.isFinite(startAcc)
		? Math.max(0, Math.min(100, startAcc))
		: 100;
	for (let i = from; i <= 100; i += 0.5) {
		let sum = 0;
		if (!rec[0]) break;
		for (let j = 0; j < rec.length && j < 27; j++) {
			if ((rec[j]?.acc ?? 0) < i) acc_rks_AccRange.push(i);
			while (j < rec.length && (rec[j]?.acc ?? 0) < i) rec.splice(j, 1);
			if (rec[j]) sum += rec[j]?.rks ?? 0;
			else break;
		}
		const tem = (sum + phi_rks) / 30;
		acc_rks_data.push([i, tem]);
		acc_rks_range[0] = Math.min(acc_rks_range[0]!, tem);
		acc_rks_range[1] = Math.max(acc_rks_range[1]!, tem);
	}
	if (acc_rks_AccRange[acc_rks_AccRange.length - 1]! < 100)
		acc_rks_AccRange.push(100);
	const segs: LineSeg[] = [];
	for (let i = 1; i < acc_rks_data.length; i++) {
		const prev = acc_rks_data[i - 1]!;
		const cur = acc_rks_data[i]!;
		if (segs.length && prev[1] === cur[1]) {
			segs[segs.length - 1]![2] = rangePct(cur[0], acc_rks_AccRange);
		} else {
			segs.push([
				rangePct(prev[0], acc_rks_AccRange),
				rangePct(prev[1], acc_rks_range),
				rangePct(cur[0], acc_rks_AccRange),
				rangePct(cur[1], acc_rks_range),
			]);
		}
	}
	if (acc_rks_AccRange[0] === 100) acc_rks_AccRange[0] = 0;
	const acc_length = 100 - (acc_rks_AccRange[0] || 0);
	const min_acc = acc_rks_AccRange[0] || 0;
	while (
		acc_rks_AccRange.length > 2 &&
		100 - acc_rks_AccRange[acc_rks_AccRange.length - 2]! < acc_length / 10
	) {
		acc_rks_AccRange.splice(acc_rks_AccRange.length - 2, 1);
	}
	const positions: [number, number][] = [[acc_rks_AccRange[0] || 0, 0]];
	for (let i = 1; i < acc_rks_AccRange.length; i++) {
		while (
			i < acc_rks_AccRange.length &&
			acc_rks_AccRange[i]! - acc_rks_AccRange[i - 1]! < acc_length / 10
		) {
			acc_rks_AccRange.splice(i, 1);
		}
		if (i >= acc_rks_AccRange.length) break;
		positions.push([
			acc_rks_AccRange[i]!,
			((acc_rks_AccRange[i]! - min_acc) / acc_length) * 100,
		]);
	}
	if (acc_rks_range[0] === 100 && acc_rks_range[1] === 0)
		acc_rks_range = [0, 1];
	return { acc_rks_data: segs, acc_rks_range, acc_rks_AccRange: positions };
}

type ScoreDetail = Parameters<typeof openHistory>[0];

export type UpdateTile = {
	song: string;
	rank: string;
	illustration: string;
	Rating: string;
	acc_new: number;
	acc_old?: number;
	score_new: number;
	score_old?: number;
	date_new: Date;
	date_old?: Date;
	rks_new: number;
	rks_old: number;
};

export type UpdateBox = {
	date?: string;
	color: string;
	song: UpdateTile[];
	width: number;
	update_num?: number;
};

function comWidth(num: number) {
	return num * 135 + 20 * num - 20;
}

function chartDifficulty(rt: PhiRuntime, songId: string, level: string) {
	const difficulty = rt.getInfo.raw(songId)?.chart?.[level]?.difficulty;
	return Number.isFinite(difficulty) ? (difficulty as number) : undefined;
}

function extendScore(
	rt: PhiRuntime,
	songId: string,
	level: string,
	now: ScoreDetail,
	old?: ScoreDetail,
): UpdateTile {
	const cur = openHistory(now);
	const prev = old ? openHistory(old) : undefined;
	const difficulty = chartDifficulty(rt, songId, level);
	return {
		song: rt.getInfo.idgetsong(songId) || songId,
		rank: level,
		illustration: rt.getInfo.getill(songId, "low"),
		Rating: rt.fCompute.rate(cur.score, cur.fc),
		acc_new: cur.acc,
		acc_old: prev?.acc,
		score_new: cur.score,
		score_old: prev?.score,
		date_new: cur.date,
		date_old: prev?.date,
		rks_new: difficulty == null ? 0 : rt.fCompute.rks(cur.acc, difficulty),
		rks_old:
			difficulty == null || !prev ? 0 : rt.fCompute.rks(prev.acc, difficulty),
	};
}

type UpdateGroup = {
	date: string;
	time: number;
	color: string;
	update_num: number;
	song: UpdateTile[];
};

function updateGroups(
	rt: PhiRuntime,
	history: Awaited<ReturnType<typeof loadSaveHistory>>,
): { groups: UpdateGroup[]; show: number } {
	type Pending = {
		id: string;
		level: string;
		row: ScoreDetail;
		prev?: ScoreDetail;
		rks: number;
	};
	const byDate = new Map<
		string,
		{ date: string; time: number; color: string; pending: Pending[] }
	>();
	for (const id of Object.keys(history.scoreHistory || {})) {
		const tem = history.scoreHistory[id];
		if (!tem) continue;
		for (const level of LEVELS) {
			const rows = tem[level];
			if (!rows?.length) continue;
			const difficulty = chartDifficulty(rt, id, level);
			for (let i = 0; i < rows.length; i++) {
				const row = rows[i]!;
				const cur = openHistory(row);
				const date = formatHistoryDate(rt, cur.date);
				let group = byDate.get(date);
				if (!group) {
					group = {
						date,
						time: cur.date.getTime(),
						color: randomColor(rt),
						pending: [],
					};
					byDate.set(date, group);
				}
				group.pending.push({
					id,
					level,
					row,
					prev: i ? rows[i - 1] : undefined,
					rks: difficulty == null ? 0 : rt.fCompute.rks(cur.acc, difficulty),
				});
			}
		}
	}
	const sorted = [...byDate.values()].sort((a, b) => b.time - a.time);
	const groups: UpdateGroup[] = [];
	let show = 0;
	for (let i = 0; i < sorted.length; i++) {
		const g = sorted[i]!;
		const update_num = g.pending.length;
		if (
			i >= HISTORY_DATE ||
			HISTORY_TOT < show + Math.min(HISTORY_DAY, update_num)
		) {
			break;
		}
		g.pending.sort((a, b) => b.rks - a.rks);
		const song = g.pending
			.slice(0, Math.min(HISTORY_DAY, HISTORY_TOT - show))
			.map((p) => extendScore(rt, p.id, p.level, p.row, p.prev));
		show += song.length;
		groups.push({
			date: g.date,
			time: g.time,
			color: g.color,
			update_num,
			song,
		});
	}
	return { groups, show };
}

function packUpdateRows(groups: UpdateGroup[]): UpdateBox[][] {
	const box_line: UpdateBox[][] = [];
	let lineNum = UPDATE_ROW_TILES;
	let continued = false;
	const remaining = groups.map((x) => ({ ...x, song: [...x.song] }));
	while (remaining.length) {
		const head = remaining[0]!;
		const box = (song: UpdateTile[]): UpdateBox =>
			continued
				? { color: head.color, song, width: comWidth(song.length) }
				: {
						date: head.date,
						color: head.color,
						song,
						width: comWidth(song.length),
					};
		if (lineNum === UPDATE_ROW_TILES) {
			const next = box(head.song.splice(0, UPDATE_ROW_TILES));
			box_line.push([next]);
			lineNum = next.song.length;
		} else {
			const next = box(head.song.splice(0, UPDATE_ROW_TILES - lineNum));
			box_line[box_line.length - 1]!.push(next);
			lineNum += next.song.length;
		}
		continued = true;
		if (!head.song.length) {
			const line = box_line[box_line.length - 1]!;
			line[line.length - 1]!.update_num = head.update_num;
			remaining.shift();
			continued = false;
		}
	}
	return box_line;
}

export function updateCardImages(
	rt: PhiRuntime,
	data: Pick<
		Awaited<ReturnType<typeof buildUpdateCard>>,
		"box_line" | "task_data" | "background" | "ChallengeMode"
	> & { cardStyle?: string; hisb30Snaps?: unknown },
) {
	const html = (rel: string) => join(rt.getInfo.resources, "html", rel);
	const out = new Set<string>();
	if (data.cardStyle === "summary") {
		// The summary layout's own B30 movement rows, so these are the jackets it draws
		try {
			const move = b30Movement(data.hisb30Snaps, rt.getInfo);
			if (move.state === "changed") {
				for (const row of [...move.entered, ...move.left]) {
					if (row.ill) out.add(row.ill);
				}
			}
		} catch {
			/* a prefetch hint only: the layout reports its own errors */
		}
	}
	if (data.background) out.add(data.background);
	out.add(html(`otherimg/${data.ChallengeMode}.png`));
	for (const line of data.box_line) {
		for (const box of line) {
			for (const song of box.song) {
				out.add(song.illustration);
				if (song.Rating) out.add(html(`otherimg/${song.Rating}.png`));
			}
		}
	}
	for (const task of data.task_data || []) out.add(task.illustration);
	return [...out];
}

export async function buildUpdateCard(
	rt: PhiRuntime,
	save: Save,
	catalog: Catalog,
	history: Awaited<ReturnType<typeof loadSaveHistory>>,
	notes: UserNotes,
	snaps: HisSnap[],
	extra: { locale?: string } = {},
) {
	const t = cardCopy(resolvePhiLocale(extra.locale, notes.locale));
	const { groups, show } = updateGroups(rt, history);
	const box_line = packUpdateRows(groups);

	const line = await rksLineFor(rt, history, snaps);

	const added: [string, string] = ["", ""];
	if (snaps.length >= 2) {
		const prev = snaps[snaps.length - 2]!;
		const cur = snaps[snaps.length - 1]!;
		const d = Number(cur.rks) - Number(prev.rks);
		if (Math.abs(d) >= 1e-4) added[0] = `${d > 0 ? "+" : ""}${d.toFixed(4)}`;
	}

	const task_data = (notes.task || []).map((task) => {
		const info = rt.getInfo.raw(task.song);
		return {
			...task,
			illustration: rt.getInfo.getill(task.song, "low"),
			song: info?.song || task.song,
			request: {
				...task.request,
				value:
					task.request?.type === "acc"
						? `${Number(task.request.value).toFixed(2)}%`
						: String(task.request?.value ?? "").padStart(6, "0"),
			},
		};
	});

	return {
		PlayerId: rt.fCompute.convertRichText(save.saveInfo.PlayerId),
		Rks: Number(save.saveInfo.summary.rankingScore).toFixed(4),
		Date: formatHistoryDate(rt, save.saveInfo.summary.updatedAt),
		ChallengeMode: Math.floor(save.saveInfo.summary.challengeModeRank / 100),
		ChallengeModeRank: save.saveInfo.summary.challengeModeRank % 100,
		background: chosenIll(catalog, notes.cardBackground, "blur"),
		box_line,
		show,
		tips: "",
		task_data: task_data.length ? task_data : null,
		task_time: notes.task_time ? formatHistoryDate(rt, notes.task_time) : "",
		added_rks_notes: added,
		update_ans: show ? fill(t.updatedScores, { n: show }) : t.noNewScores,
		theme: notes.theme || "default",
		rks_date: line.rks_date,
		rks_history: line.rks_history,
		rks_range: [
			Number.isFinite(Number(line.rks_range?.[0]))
				? Number(line.rks_range[0])
				: 0,
			Number.isFinite(Number(line.rks_range?.[1]))
				? Number(line.rks_range[1])
				: 1,
		],
	};
}

/* ---- Discord bot only: the legacy historyB30 card (`/phi score hisb30 style:legacy`)
 * and the `/phi score single` history list. The WebUI does not draw these ---- */

type B30Entry = { id: string; rank: string };
type Hisb30Row = {
	date: string;
	color: string;
	songs: Record<string, unknown>[];
};

/** Jackets that entered or left the phi slots / B27 between two B30 states. */
function b30Changes(
	rt: PhiRuntime,
	prev: { phi: B30Entry[]; b27: B30Entry[] },
	next: { phi: B30Entry[]; b27: B30Entry[] },
) {
	const key = (x: B30Entry) => `${x.id}-${x.rank}`;
	const oldPhi = new Set(prev.phi.map(key));
	const oldB27 = new Set(prev.b27.map(key));
	const newPhi = new Set(next.phi.map(key));
	const newB27 = new Set(next.b27.map(key));
	const songs: Record<string, unknown>[] = [];
	const tile = (item: B30Entry, extra: Record<string, unknown>) => ({
		ill: rt.getInfo.getill(item.id, "low"),
		rank: item.rank,
		...extra,
	});
	next.phi.forEach((item, index) => {
		if (!oldPhi.has(key(item))) songs.push(tile(item, { newPhi: index + 1 }));
	});
	next.b27.forEach((item, index) => {
		if (!oldB27.has(key(item))) songs.push(tile(item, { newB27: index + 1 }));
	});
	for (const item of prev.phi) {
		if (!newPhi.has(key(item))) songs.push(tile(item, { exitPhi: true }));
	}
	for (const item of prev.b27) {
		if (!newB27.has(key(item))) songs.push(tile(item, { exitB27: true }));
	}
	return songs;
}

export async function buildHisb30Rows(
	rt: PhiRuntime,
	history: Awaited<ReturnType<typeof loadSaveHistory>>,
	snaps: HisSnap[],
) {
	const fromHist = hisb30FromScoreHistory(rt, history);
	if (fromHist.length) return fromHist;
	return hisb30FromSnaps(rt, snaps);
}

function hisb30FromScoreHistory(
	rt: PhiRuntime,
	history: Awaited<ReturnType<typeof loadSaveHistory>>,
) {
	const records: {
		id: string;
		level: string;
		acc: number;
		score: number;
		date: Date;
		fc: boolean;
		rks: number;
		rank: string;
	}[] = [];
	for (const id of Object.keys(history.scoreHistory || {})) {
		const songRecords = history.scoreHistory[id];
		if (!songRecords) continue;
		for (const level of LEVELS) {
			const rows = songRecords[level];
			if (!rows) continue;
			const dif = rt.getInfo.raw(id)?.chart?.[level]?.difficulty;
			if (dif == null) continue;
			for (const row of rows) {
				const opened = openHistory(row);
				records.push({
					id,
					level,
					rank: level,
					acc: opened.acc,
					score: opened.score,
					date: opened.date,
					fc: opened.fc,
					rks: rt.fCompute.rks(opened.acc, dif),
				});
			}
		}
	}
	if (records.length < 2) return [];
	const byTime: Record<string, typeof records> = {};
	for (const rec of records) {
		const k = `${rec.date.getTime()}`;
		const bucket = byTime[k] ?? [];
		byTime[k] = bucket;
		bucket.push(rec);
	}
	const times = Object.keys(byTime).sort((a, b) => Number(a) - Number(b));
	let b30 = { phi: [] as typeof records, b27: [] as typeof records };
	const rows: Hisb30Row[] = [];
	for (const time of times) {
		const newB30 = rt.fCompute.updateB30(b30, byTime[time]!) as {
			phi: typeof records;
			b27: typeof records;
		};
		const songs = b30Changes(rt, b30, newB30);
		if (songs.length) {
			rows.push({
				date: formatHistoryDate(rt, Number(time)),
				songs,
				color: randomColor(rt),
			});
		}
		b30 = newB30;
	}
	return rows.reverse().slice(0, 12);
}

function hisb30FromSnaps(rt: PhiRuntime, snaps: HisSnap[]) {
	const rows: Hisb30Row[] = [];
	for (let i = 1; i < snaps.length; i++) {
		const prev = snaps[i - 1]!;
		const cur = snaps[i]!;
		const songs = b30Changes(
			rt,
			{ phi: prev.phi || [], b27: prev.b27 || [] },
			{ phi: cur.phi || [], b27: cur.b27 || [] },
		);
		if (songs.length) {
			rows.push({
				date: formatHistoryDate(rt, cur.t),
				songs,
				color: randomColor(rt),
			});
		}
	}
	return rows.slice(-12).reverse();
}

export function playerBlock(rt: PhiRuntime, save: Save) {
	const money = save.gameProgress?.money || [0, 0, 0, 0, 0];
	return {
		avatar: rt.getInfo.idgetavatar(save.gameuser.avatar),
		ChallengeMode: Math.floor(save.saveInfo.summary.challengeModeRank / 100),
		ChallengeModeRank: save.saveInfo.summary.challengeModeRank % 100,
		rks: save.saveInfo.summary.rankingScore,
		data: moneyText(money),
		selfIntro: rt.fCompute.convertRichText(save.gameuser.selfIntro),
		PlayerId: rt.fCompute.convertRichText(save.saveInfo.PlayerId),
	};
}

/** `/phi score single`: newest first, at most 16 entries. */
export async function songScoreHistory(
	rt: PhiRuntime,
	history: Awaited<ReturnType<typeof loadSaveHistory>>,
	songId: string,
) {
	const rec = history.scoreHistory?.[songId];
	if (!rec) return [];
	const out: Record<string, unknown>[] = [];
	for (const level of LEVELS) {
		const rows = rec[level];
		if (!rows) continue;
		for (let i = 0; i < rows.length; i++) {
			const tem = extendScore(rt, songId, level, rows[i]!, i ? rows[i - 1] : undefined);
			out.push({ ...tem, date_new: formatHistoryDate(rt, tem.date_new) });
		}
	}
	out.sort(
		(a, b) =>
			new Date(String(b.date_new)).getTime() -
			new Date(String(a.date_new)).getTime(),
	);
	return out.slice(0, 16);
}

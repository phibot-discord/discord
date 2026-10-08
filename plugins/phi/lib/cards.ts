import { join } from "node:path";
import { prefetchIlls } from "../../../src/ill.ts";
import { logger } from "../../../src/logger.ts";
import type { Kv } from "../../../src/sdk/index.ts";
import {
	buildRksHistogram,
	equivRksStddev,
	getB30AnalysisRecords,
	type TagAnalysis,
} from "./b30-analysis.ts";
import {
	cardCopy,
	fill,
	localizeChartTagLabels,
	localizeSuggestFields,
	type PhiLocale,
	resolvePhiLocale,
	tagAnalysisMeta,
	tagPoolNote,
} from "./card-i18n.ts";
import { type Catalog, chosenIll } from "./catalog.ts";
import { CHART_TAG_RENDER_BUDGET_MS, tagAnalysisFor } from "./chart-tags-api.ts";
import { tagRadarHtml } from "./charts.ts";
import {
	type CardMissing,
	type ExternalWatch,
	watchExternal,
} from "./external.ts";
import {
	accRksLines,
	loadHisb30Snaps,
	loadSaveHistory,
	rksLineFor,
} from "./history.ts";
import { LB_ROW_BUDGET_MS } from "./leaderboard.ts";
import {
	b30AvgKindOf,
	getNotes,
	rankBandShowOf,
	rankScopeOf,
	tagAnalysisEnabled,
	type UserNotes,
} from "./notes.ts";
import type { PhiRuntime } from "./runtime.ts";
import type { Save } from "./save.ts";
import { getToken, moneyText, saveIdentity } from "./saves.ts";
import { type AvgOutcome, attachB19AccAvg } from "./score-avg.ts";

function htmlImage(rt: PhiRuntime, rel: string) {
	return join(rt.getInfo.resources, "html", rel);
}

function iconImages(
	rt: PhiRuntime,
	save: Save,
	rows: Array<{ Rating?: string } | undefined>,
) {
	const out = [
		htmlImage(rt, `avatar/${rt.getInfo.idgetavatar(save.gameuser.avatar)}.png`),
		htmlImage(
			rt,
			`otherimg/${Math.floor(save.saveInfo.summary.challengeModeRank / 100)}.png`,
		),
		htmlImage(rt, "otherimg/data.png"),
	];
	for (const rating of new Set(rows.map((r) => r?.Rating).filter(Boolean))) {
		out.push(htmlImage(rt, `otherimg/${rating}.png`));
	}
	return out;
}

async function b30AnalysisFor(
	records: ReturnType<typeof getB30AnalysisRecords>,
	withPhi: boolean,
	notes: UserNotes,
	nnum: number,
	locale: PhiLocale,
	db: Kv,
	save: Save,
	external?: ExternalWatch,
) {
	if (notes.showB30Analysis === false || nnum !== 33) return null;
	const t = cardCopy(locale);
	const histogram = buildRksHistogram(records);
	const showTags = tagAnalysisEnabled(notes);
	let tagAnalysis: TagAnalysis | null = null;
	let tagLookupFailed = false;
	if (showTags && records.length) {
		try {
			const lookup = tagAnalysisFor(save, {
				saveRevision: saveIdentity(save.saveInfo),
				db,
				budgetMs: CHART_TAG_RENDER_BUDGET_MS,
			});
			tagAnalysis = localizeChartTagLabels(
				await (external ? external.track(lookup) : lookup),
				locale,
			);
		} catch (err) {
			tagAnalysis = null;
			tagLookupFailed = true;
			logger.warn(
				`tag lookup failed: ${err instanceof Error ? `${err.name} ${err.message}` : err}`,
			);
		}
	}
	return {
		histogram,
		// x30/fc30 lists have no P slots (getBestWithLimit(…, false))
		histogramPhiSlots: withPhi,
		tagAnalysis,
		tagMeta: tagAnalysisMeta(tagAnalysis, t),
		tagPoolNote: tagPoolNote(tagAnalysis, t),
		tagMessage: tagLookupFailed ? t.tagUnavailable : t.tagInsufficient,
		radarHtml: tagAnalysis?.radar.categories.length
			? await tagRadarHtml(tagAnalysis.radar)
			: "",
		showTags,
		histogramWide: !showTags,
		tagLookupFailed,
	};
}

/** attachB19AccAvg may report `{ partial: true }` when its lookup timed out */
export function isPartialResult(value: unknown): boolean {
	return (
		value != null &&
		typeof value === "object" &&
		(value as { partial?: unknown }).partial === true
	);
}

export async function b19Card(
	rt: PhiRuntime,
	save: Save,
	db: Kv,
	userId: string,
	catalog: Catalog,
	extra: {
		nnum?: number;
		spInfo?: string[];
		mode?: "b30" | "x30" | "fc30" | "p30";
		accMin?: number;
		locale?: PhiLocale | string;
		showTagAnalysis?: boolean;
		notes?: UserNotes;
		/** With notes.peerWait: peer badges may take until this time (ms since epoch) */
		peerDeadline?: number;
		/** True while the card waits on phib19.top, false when it no longer does */
		onExternalWait?: (waiting: boolean) => void;
	} = {},
) {
	const external = watchExternal(extra.onExternalWait);
	const notes = { ...(extra.notes ?? (await getNotes(db, userId))) };
	if (extra.showTagAnalysis != null) {
		notes.showTagAnalysis = extra.showTagAnalysis;
	}
	const locale = resolvePhiLocale(extra.locale, notes.locale);
	const t = cardCopy(locale);
	const nnum = extra.nnum ?? 33;
	let save_b19: { phi?: unknown[]; b19_list?: unknown[] };
	let avgJob: Promise<unknown> | undefined;
	const spInfo = [...(extra.spInfo || [])];
	if (extra.accMin != null) {
		save_b19 = await save.getBestWithLimit(nnum, [
			{ type: "acc", value: [extra.accMin, 100] },
		]);
		spInfo.push(fill(t.accLimited, { n: extra.accMin }));
	} else if (extra.mode === "p30") {
		save_b19 = await save.getBestWithLimit(nnum, [
			{ type: "acc", value: [100, 100] },
		]);
		spInfo.push(t.apMode);
	} else if (extra.mode === "fc30") {
		save_b19 = await save.getBestWithLimit(
			nnum,
			[
				{
					type: "custom",
					value: (record: { fc?: boolean; score?: number }) =>
						record.fc === true && record.score !== 1e6,
				},
			],
			false,
		);
		spInfo.push(t.fcMode);
	} else if (extra.mode === "x30") {
		save_b19 = await save.getBestWithLimit(
			nnum,
			[
				{
					type: "custom",
					value: (record: { score: number; id: string; rank: string }) =>
						rt.fCompute.comJust1Good(
							record.score,
							rt.getInfo.ori_info[record.id]?.chart?.[record.rank]?.combo ||
								1e9,
						),
				},
			],
			false,
		);
		spInfo.push(t.x30Mode);
	} else {
		const b19 = await save.getB19(undefined, nnum, { avgType: "none" });
		save_b19 = b19;
		if (notes.allowApiUsage !== false) {
			avgJob = external.track(
				attachB19AccAvg(b19, {
					avgType: b30AvgKindOf(notes),
					color: notes.b30AvgColor,
					db,
					owner: userId,
					rankScope: rankScopeOf(notes),
					rankBandShow: rankBandShowOf(notes),
					budgetMs:
						notes.peerWait === true && extra.peerDeadline != null
							? Math.max(LB_ROW_BUDGET_MS, extra.peerDeadline - Date.now())
							: undefined,
				}),
			);
		}
	}
	const background = chosenIll(catalog, notes.cardBackground, "blur");
	const rows = [...(save_b19.phi || []), ...(save_b19.b19_list || [])] as Array<
		{ illustration?: string; Rating?: string } | undefined
	>;
	prefetchIlls([
		...rows.map((row) => row?.illustration),
		background,
		...iconImages(rt, save, rows),
	]);
	// P1–P3 + B1–B27 of the displayed list: the histogram and the header ± SD
	const slots = getB30AnalysisRecords(save_b19);
	const [b30Analysis, avgResult] = await Promise.all([
		b30AnalysisFor(
			slots,
			Array.isArray(save_b19.phi),
			notes,
			nnum,
			locale,
			db,
			save,
			external,
		),
		avgJob,
	]);
	localizeSuggestFields(
		save_b19.phi as Array<{ suggest?: string }> | undefined,
		t,
	);
	localizeSuggestFields(
		save_b19.b19_list as Array<{ suggest?: string }> | undefined,
		t,
	);
	// Badges with no answer, or ranks drawn past their 6 h because the new ones were late
	const avg = avgResult as AvgOutcome | undefined;
	const missing: CardMissing[] = [
		...(avg?.missing ? (["peers"] as const) : []),
		...(avg?.stale ? (["stale"] as const) : []),
		...(avg?.empty ? (["empty"] as const) : []),
		...(b30Analysis?.tagLookupFailed === true ? (["tags"] as const) : []),
	];
	const stats = await save.getStats();
	const money = save.gameProgress?.money || [0, 0, 0, 0, 0];
	const gameuser = {
		avatar: rt.getInfo.idgetavatar(save.gameuser.avatar),
		ChallengeMode: Math.floor(save.saveInfo.summary.challengeModeRank / 100),
		ChallengeModeRank: save.saveInfo.summary.challengeModeRank % 100,
		rks: save.saveInfo.summary.rankingScore,
		data: moneyText(money),
		selfIntro: rt.fCompute.convertRichText(save.gameuser.selfIntro),
		backgroundUrl: await rt.fCompute.getBackground(save.gameuser.background),
		PlayerId: rt.fCompute.convertRichText(save.saveInfo.PlayerId),
	};
	return {
		phi: save_b19.phi,
		b19_list: save_b19.b19_list,
		PlayerId: gameuser.PlayerId,
		Rks: Number(save.saveInfo.summary.rankingScore).toFixed(4),
		Date: rt.fCompute.formatDate(save.saveInfo.summary.updatedAt),
		ChallengeMode: gameuser.ChallengeMode,
		ChallengeModeRank: gameuser.ChallengeModeRank,
		background,
		theme: notes.theme || "default",
		gameuser,
		nnum,
		stats,
		spInfo,
		locale,
		rksStddev: equivRksStddev(slots.map((slot) => slot.rks)),
		b30Analysis,
		// A lookup timed out or failed: the server serves this no-store and never caches it
		renderPartial: missing.length > 0,
		missing,
		externalMs: external.ms(),
	};
}

export async function infoCard(
	rt: PhiRuntime,
	save: Save,
	db: Kv,
	userId: string,
	catalog: Catalog,
	extra: {
		locale?: PhiLocale | string;
		notes?: UserNotes;
		token?: string;
	} = {},
) {
	const notes = extra.notes ?? (await getNotes(db, userId));
	const locale = resolvePhiLocale(extra.locale, notes.locale);
	const stats = await save.getStats();
	const money = save.gameProgress?.money || [0, 0, 0, 0, 0];
	let backgroundurl = "";
	try {
		backgroundurl = await rt.fCompute.getBackground(save.gameuser.background);
	} catch {
		/* optional */
	}
	if (!backgroundurl || /^(https?:|data:)/i.test(backgroundurl)) {
		backgroundurl =
			chosenIll(catalog, notes.cardBackground, "low") ||
			catalog.fallbackIll ||
			"";
	}
	const background = chosenIll(catalog, notes.cardBackground, "blur");
	prefetchIlls([backgroundurl, background, ...iconImages(rt, save, [])]);
	const gameuser = {
		avatar: rt.getInfo.idgetavatar(save.gameuser.avatar),
		ChallengeMode: Math.floor(save.saveInfo.summary.challengeModeRank / 100),
		ChallengeModeRank: save.saveInfo.summary.challengeModeRank % 100,
		rks: Number(save.saveInfo.summary.rankingScore) || 0,
		data: moneyText(money),
		selfIntro: rt.fCompute.convertRichText(save.gameuser.selfIntro),
		backgroundurl,
		PlayerId: rt.fCompute.convertRichText(save.saveInfo.PlayerId),
	};
	let acc: ReturnType<typeof accRksLines> = {
		acc_rks_data: [],
		acc_rks_range: [0, 1],
		acc_rks_AccRange: [],
	};
	try {
		acc = accRksLines(save);
	} catch {
		/* chart stays empty */
	}
	let rks_history: number[][] = [];
	let data_history: number[][] = [];
	let rks_range: number[] = [0, 1];
	let data_range: Array<number | string> = [0, 1];
	let data_date: [string, string] = ["", ""];
	let rks_date: [string, string] = ["", ""];
	try {
		const [token, snaps] = await Promise.all([
			extra.token ?? getToken(rt, userId),
			loadHisb30Snaps(db, userId),
		]);
		if (token) {
			const history = await loadSaveHistory(rt, db, token);
			const line = await rksLineFor(rt, history, snaps);
			rks_history = line.rks_history;
			rks_range = line.rks_range;
			rks_date = line.rks_date;
			const dataLine = history.getDataLine();
			data_history = (dataLine.data_history || []) as number[][];
			data_range = dataLine.data_range || [0, 1];
			data_date = [
				dataLine.data_date?.[0]
					? rt.fCompute.formatDate(dataLine.data_date[0])
					: "",
				dataLine.data_date?.[1]
					? rt.fCompute.formatDate(dataLine.data_date[1])
					: "",
			];
		} else if (snaps.length) {
			const line = await rksLineFor(
				rt,
				await loadSaveHistory(rt, db, ""),
				snaps,
			);
			rks_history = line.rks_history;
			rks_range = line.rks_range;
			rks_date = line.rks_date;
		}
	} catch {
		/* charts stay empty */
	}
	return {
		gameuser,
		userstats: stats,
		rks_history,
		data_history,
		rks_range,
		data_range,
		data_date,
		rks_date,
		acc_rks_data: acc.acc_rks_data,
		acc_rks_range: acc.acc_rks_range,
		acc_rks_AccRange: acc.acc_rks_AccRange,
		background,
		theme: notes.theme || "default",
		locale,
	};
}

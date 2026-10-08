import { kvKey } from "../plugins/phi/lib/const.ts";
import {
	b30AvgKindOf,
	rankBandShowOf,
	rankScopeOf,
	type UserNotes,
} from "../plugins/phi/lib/notes.ts";

export const RENDER_VERSION = "v48";

export type CardImageCacheInput = {
	kind: string;
	userId: string;
	saveRevision: string;
	locale: string;
	quality: string;
	epoch: string;
	count: string;
	theme: string;
	analysisFlag: string;
	tagFlag: string;
	statsFlag: string;
	avgFlag: string;
	background: string;
	/** Layout style; "classic" adds no key part so classic etags stay stable */
	style: string;
	/** Kind-specific discriminator (e.g. the per-song card's chart, level and day) */
	extra?: string;
	renderVersion: string;
};

export function cardCacheInput(args: {
	kind: string;
	userId: string;
	saveRevision: string;
	locale: string;
	paintQuality: string;
	epoch: string;
	count: number;
	notes: Pick<
		UserNotes,
		| "theme"
		| "showB30Analysis"
		| "allowApiUsage"
		| "b30AvgKind"
		| "b30AvgColor"
		| "rankScope"
		| "rankBandShow"
		| "cardBackground"
	>;
	tagOn: boolean;
	statsOn: boolean;
	style?: string;
	extra?: string;
}): CardImageCacheInput {
	const { notes } = args;
	return {
		kind: args.kind,
		userId: args.userId,
		saveRevision: args.saveRevision,
		locale: `locale:${args.locale}`,
		quality: args.paintQuality,
		epoch: args.epoch,
		count: String(args.count),
		theme: notes.theme,
		renderVersion: RENDER_VERSION,
		analysisFlag: notes.showB30Analysis === false ? "a0" : "a1",
		tagFlag: args.tagOn ? "t1" : "t0",
		statsFlag: args.statsOn ? "s1" : "s0",
		avgFlag: avgFlag(notes),
		background: notes.cardBackground?.trim() || "random",
		style: args.style || "classic",
		extra: args.extra,
	};
}

/**
 * Badge mode as drawn: bot-only modes share "all"; API off keeps its own key; rank's
 * scope only when not "all", and what its ±0.05 badge shows only when not the place
 */
function avgFlag(
	notes: Pick<
		UserNotes,
		| "allowApiUsage"
		| "b30AvgKind"
		| "b30AvgColor"
		| "rankScope"
		| "rankBandShow"
	>,
): string {
	if (notes.allowApiUsage === false) return "avg:none";
	const kind = b30AvgKindOf(notes);
	const scope = rankScopeOf(notes);
	const band = rankBandShowOf(notes) === "percent" ? "-pct" : "";
	const mode =
		kind === "rank" && scope !== "all" ? `rank-${scope}${band}` : kind;
	return `avg:${mode}:${notes.b30AvgColor || "blue"}`;
}

export function cardCacheParts(
	input: CardImageCacheInput,
	suffix: "jpeg" | "height",
): string[] {
	return [
		input.kind,
		input.userId,
		input.saveRevision,
		input.locale,
		input.quality,
		...(suffix === "jpeg" ? [input.epoch || "0"] : []),
		input.count,
		input.theme || "default",
		input.analysisFlag,
		input.tagFlag,
		input.statsFlag,
		input.avgFlag,
		input.background || "random",
		...(input.style && input.style !== "classic"
			? [`style:${input.style}`]
			: []),
		...(input.extra ? [input.extra] : []),
		input.renderVersion,
		suffix,
	];
}

export function parseCachedHeight(raw: unknown): number | undefined {
	const n = typeof raw === "number" ? raw : Number(raw);
	if (!Number.isFinite(n) || n <= 64) return;
	return Math.round(n);
}

export function cardEpochKey(userId: string): string {
	return kvKey("webCardEpoch", userId);
}

export async function getCardEpoch(
	store: { get: (key: string) => Promise<unknown> },
	userId: string,
): Promise<string> {
	const raw = await store.get(cardEpochKey(userId));
	return raw == null ? "" : String(raw);
}

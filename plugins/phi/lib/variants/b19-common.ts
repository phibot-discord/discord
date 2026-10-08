/**
 * Helpers shared by the Table and Phone layouts
 * Tips are pre-broken into lines (fitTip): a CSS clamp puts each colour emoji on its own line
 */
import { fmtCount, fmtTopPercent } from "../leaderboard.ts";
import type { AccRankBadge } from "../score-avg.ts";
import { textEm } from "../text-fit.ts";

const segmenter =
	typeof Intl.Segmenter === "function"
		? new Intl.Segmenter("en", { granularity: "grapheme" })
		: null;

/** User-perceived characters: an emoji with its modifiers and joiners stays one */
export function graphemes(text: string): string[] {
	return segmenter
		? Array.from(segmenter.segment(text), (s) => s.segment)
		: [...text];
}

const PICTO = /^\p{Extended_Pictographic}/u;
const PRESENTATION = /^\p{Emoji_Presentation}/u;
const MODIFIED = /^\p{Emoji_Modifier_Base}\p{Emoji_Modifier}/u;
const FLAG = /^(?:\p{Regional_Indicator}){1,2}$/u;
const KEYCAP = /^[#*0-9]\uFE0F?\u20E3$/u;

/** Whether Takumi swaps this grapheme for an emoji image (same test as extractEmojis) */
export function isEmojiImage(g: string): boolean {
	if (g.includes("\uFE0E")) return false;
	if (FLAG.test(g) || KEYCAP.test(g)) return true;
	return (
		PICTO.test(g) &&
		(g.includes("\uFE0F") ||
			g.includes("\u200D") ||
			PRESENTATION.test(g) ||
			MODIFIED.test(g))
	);
}

/** An emoji image is 1em wide plus 0.15em of margin */
const EMOJI_EM = 1.15;
/** Zero-width spaces, joiners and the text / emoji selectors take no room */
const INVISIBLE = /[\u200B-\u200D\u2060]|\uFE0E|\uFE0F/g;

/** Width of one grapheme at 1 px font size */
export function graphemeEm(g: string): number {
	return isEmojiImage(g) ? EMOJI_EM : textEm(g.replace(INVISIBLE, ""));
}

/** Width of `text` at 1 px font size, emoji counted as Takumi draws them */
export function lineEm(text: string): number {
	let em = 0;
	for (const g of graphemes(text)) em += graphemeEm(g);
	return em;
}

const CJK =
	/[\u2E80-\u2FFF\u3000-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/u;
/** Closing punctuation (CJK and Latin) never starts a line */
const NO_LINE_START = /^[、。，．・：；！？）」』】〕〉》ー～…,.:;!?)\]}%]/u;
const OPENERS = "([{（【「『《〔〈“‘\"'";

/** A wide grapheme (CJK, emoji, arrows, symbols) can be broken around */
const isWide = (g: string) => isEmojiImage(g) || CJK.test(g) || textEm(g) >= 1;

/** Whether a line may break between graphemes `gs[i - 1]` and `gs[i]` */
function canBreakBefore(gs: string[], i: number): boolean {
	const prev = gs[i - 1];
	const next = gs[i];
	if (prev == null || next == null) return false;
	if (NO_LINE_START.test(next) || OPENERS.includes(prev)) return false;
	return prev === " " || next === " " || isWide(prev) || isWide(next);
}

/** Cut `text` to `widthEm`, ending in "…" when it was cut. Emoji stay whole */
export function clipLine(text: string, widthEm: number) {
	if (lineEm(text) <= widthEm) return { text, cut: false };
	const budget = widthEm - lineEm("…");
	let out = "";
	let em = 0;
	for (const g of graphemes(text)) {
		const w = graphemeEm(g);
		if (em + w > budget) break;
		out += g;
		em += w;
	}
	return { text: `${out.trimEnd()}…`, cut: true };
}

/** `text` in at most `maxLines` lines of `widthEm`, breaking at spaces, CJK and emoji; ends in … if cut */
export function wrapLines(
	raw: string,
	widthEm: number,
	maxLines: number,
): { lines: string[]; cut: boolean } {
	const gs = graphemes(raw.replace(/\s+/g, " ").trim());
	const lines: string[] = [];
	let i = 0;
	while (i < gs.length && lines.length < maxLines) {
		if (lines.length === maxLines - 1) {
			const last = clipLine(gs.slice(i).join(""), widthEm);
			lines.push(last.text);
			return { lines, cut: last.cut };
		}
		let em = 0;
		let j = i;
		let brk = -1;
		let brkEm = 0;
		while (j < gs.length && em + graphemeEm(gs[j]!) <= widthEm) {
			em += graphemeEm(gs[j]!);
			j++;
			if (j < gs.length && canBreakBefore(gs, j)) {
				brk = j;
				brkEm = em;
			}
		}
		if (j >= gs.length) {
			lines.push(gs.slice(i).join("").trimEnd());
			break;
		}
		// Break before the grapheme that overflows when allowed, else at the last
		// break unless that leaves the line nearly empty, else mid-word
		const end = j === brk ? j : brk > i && brkEm >= widthEm / 3 ? brk : j;
		lines.push(
			gs
				.slice(i, Math.max(end, i + 1))
				.join("")
				.trimEnd(),
		);
		i = Math.max(end, i + 1);
		while (gs[i] === " ") i++;
	}
	return { lines, cut: false };
}

export type FittedTip = { lines: string[]; px: number; cut: boolean };

/**
 * The tip at the largest of `sizes` (px, largest first) that shows it whole in
 * `maxLines` lines of `widthPx`; at the smallest size it is ellipsized
 */
export function fitTip(
	raw: string,
	widthPx: number,
	sizes: number[],
	maxLines: number,
): FittedTip {
	const text = raw.replace(/\s+/g, " ").trim();
	const smallest = sizes[sizes.length - 1] ?? 16;
	if (!text) return { lines: [], px: sizes[0] ?? smallest, cut: false };
	for (const px of sizes) {
		const wrapped = wrapLines(text, widthPx / px, maxLines);
		if (!wrapped.cut) return { lines: wrapped.lines, px, cut: false };
	}
	const wrapped = wrapLines(text, widthPx / smallest, maxLines);
	return { lines: wrapped.lines, px: smallest, cut: wrapped.cut };
}

/** The given tip, else a random one from the catalog (setup.ts would pick one too) */
export function pickTip(tips: unknown, catalogTips: string[] | undefined) {
	if (typeof tips === "string" && tips.trim()) return tips;
	const list = (catalogTips || []).map((t) => t.trim()).filter(Boolean);
	return list.length ? list[Math.floor(Math.random() * list.length)]! : "";
}

export type RankParts = {
	/** "#3,611"; "" when the badge shows only the share */
	pos: string;
	/** "/ 70,388" (the records on the chart, the player included); "" with `pos` */
	of: string;
	/** "Top 5.1%", or "AP 2.9%" (the share tied at #1) for an AP; "" when it shows only the place */
	pct: string;
	ap: boolean;
	/** "±0.05" before a rank among players near the user's RKS */
	tag?: string;
};

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The "rank" badge of a row (`song.accRank`), or null when it has none */
export function rankParts(raw: unknown): RankParts | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Partial<Record<keyof AccRankBadge, unknown>>;
	const ap = r.ap === true;
	const rank = Number(r.rank);
	const total = Number(r.total);
	const percent = r.percent == null ? Number.NaN : Number(r.percent);
	const pos = text(r.pos) || (rank > 0 ? `#${fmtCount(rank)}` : "");
	const of = text(r.of) || (total > 0 ? `/ ${fmtCount(total)}` : "");
	const pct =
		text(r.pct) ||
		(Number.isFinite(percent)
			? `${ap ? "AP" : "Top"} ${fmtTopPercent(percent)}%`
			: "");
	if (!pos || !pct) return null;
	const tag = text(r.tag);
	// A ±0.05 badge shows the place or the share, as the user chose
	const parts =
		r.show === "percent"
			? { pos: "", of: "", pct, ap }
			: r.show === "place"
				? { pos, of, pct: "", ap }
				: { pos, of, pct, ap };
	return tag ? { ...parts, tag } : parts;
}

/** A row's rank badges in drawing order: `song.accRanks`, else the single `song.accRank` */
export function rankLines(row: {
	accRank?: unknown;
	accRanks?: unknown;
}): RankParts[] {
	const list = Array.isArray(row.accRanks) ? row.accRanks : [row.accRank];
	return list.flatMap((raw) => rankParts(raw) ?? []);
}

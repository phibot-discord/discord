/**
 * Card layouts per kind; pure, the client imports it
 * "classic" is the default (for info, the redesigned profile)
 */

export const CARD_STYLES = {
	b30: ["classic", "table", "portrait"],
	x30: ["classic", "table", "portrait"],
	fc30: ["classic", "table", "portrait"],
	hisb30: ["classic", "timeline", "summary"],
	info: ["classic", "table", "portrait"],
} as const;

export type StyledKind = keyof typeof CARD_STYLES;
export type CardStyle = (typeof CARD_STYLES)[StyledKind][number];

export const DEFAULT_CARD_STYLE = "classic";

export function isStyledKind(kind: string): kind is StyledKind {
	return Object.hasOwn(CARD_STYLES, kind);
}

/** Styles offered for a kind, or undefined when the kind has a single layout */
export function cardStyles(kind: string): readonly CardStyle[] | undefined {
	return isStyledKind(kind) ? CARD_STYLES[kind] : undefined;
}

/** Unknown kinds or styles fall back to classic */
export function parseCardStyle(kind: string, raw: unknown): CardStyle {
	const styles = cardStyles(kind);
	if (!styles || typeof raw !== "string") return DEFAULT_CARD_STYLE;
	return (styles as readonly string[]).includes(raw)
		? (raw as CardStyle)
		: DEFAULT_CARD_STYLE;
}

/** Keeps only valid kind → style pairs (stored notes may be stale or hand-edited) */
export function sanitizeCardStyles(
	raw: unknown,
): Partial<Record<StyledKind, CardStyle>> | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
	const out: Partial<Record<StyledKind, CardStyle>> = {};
	for (const [kind, style] of Object.entries(raw)) {
		if (!isStyledKind(kind)) continue;
		const parsed = parseCardStyle(kind, style);
		if (parsed !== DEFAULT_CARD_STYLE) out[kind] = parsed;
	}
	return Object.keys(out).length ? out : undefined;
}

/** Art template id for a kind + style; undefined means "use the kind's classic template" */
export function cardStyleTemplate(
	kind: string,
	style: string,
): string | undefined {
	if (!isStyledKind(kind)) return;
	if (!(CARD_STYLES[kind] as readonly string[]).includes(style)) return;
	// Every info layout is self-contained; the old userinfo.art is only the fallback
	if (kind === "info") return `phi/userinfo/info-${style}`;
	if (style === DEFAULT_CARD_STYLE) return;
	return kind === "hisb30"
		? `phi/update/update-${style}`
		: `phi/b19/b19-${style}`;
}

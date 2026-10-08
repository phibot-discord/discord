/**
 * Server-side stand-in for phi-plugin's browser script that shrinks every
 * `name="pvis"` text until it fits its box (Takumi runs no scripts)
 *
 * Advance widths (em) of printable ASCII as Takumi lays them out, taking the
 * wider of the PHI and NotoSansSC glyphs so either font stack fits
 */
const ASCII_EM: Record<string, number> = {
	" ": 0.23,
	"!": 0.33,
	'"': 0.48,
	"#": 0.8,
	$: 0.56,
	"%": 0.93,
	"&": 0.74,
	"'": 0.28,
	"(": 0.34,
	")": 0.34,
	"*": 0.47,
	"+": 0.56,
	",": 0.28,
	"-": 0.35,
	".": 0.28,
	"/": 0.4,
	"0": 0.68,
	"1": 0.56,
	"2": 0.61,
	"3": 0.61,
	"4": 0.65,
	"5": 0.62,
	"6": 0.66,
	"7": 0.57,
	"8": 0.69,
	"9": 0.66,
	":": 0.28,
	";": 0.28,
	"<": 0.56,
	"=": 0.56,
	">": 0.56,
	"?": 0.51,
	"@": 0.95,
	A: 0.69,
	B: 0.69,
	C: 0.64,
	D: 0.69,
	E: 0.61,
	F: 0.57,
	G: 0.69,
	H: 0.74,
	I: 0.3,
	J: 0.54,
	K: 0.68,
	L: 0.55,
	M: 0.91,
	N: 0.74,
	O: 0.75,
	P: 0.66,
	Q: 0.75,
	R: 0.69,
	S: 0.63,
	T: 0.6,
	U: 0.73,
	V: 0.67,
	W: 0.99,
	X: 0.68,
	Y: 0.61,
	Z: 0.61,
	"[": 0.34,
	"\\": 0.4,
	"]": 0.34,
	"^": 0.56,
	_: 0.56,
	"`": 0.61,
	a: 0.57,
	b: 0.62,
	c: 0.51,
	d: 0.62,
	e: 0.56,
	f: 0.38,
	g: 0.6,
	h: 0.61,
	i: 0.28,
	j: 0.28,
	k: 0.56,
	l: 0.29,
	m: 0.93,
	n: 0.61,
	o: 0.61,
	p: 0.62,
	q: 0.62,
	r: 0.39,
	s: 0.5,
	t: 0.38,
	u: 0.61,
	v: 0.53,
	w: 0.82,
	x: 0.55,
	y: 0.6,
	z: 0.51,
	"{": 0.34,
	"|": 0.27,
	"}": 0.34,
	"~": 0.56,
};

function charEm(ch: string): number {
	const ascii = ASCII_EM[ch];
	if (ascii != null) return ascii;
	const cp = ch.codePointAt(0) ?? 0;
	// Accented Latin, Greek and Cyrillic letters (not × or ÷)
	if (cp >= 0xc0 && cp <= 0x52f && cp !== 0xd7 && cp !== 0xf7) return 0.8;
	if (cp >= 0xff61 && cp <= 0xff9f) return 0.5; // halfwidth kana
	if (cp >= 0x2000 && cp <= 0x206f) return 1.06; // general punctuation, e.g. …
	// Other symbols, CJK, kana, hangul and fullwidth forms fall back to square glyphs
	return 1;
}

/** Rendered width of one line of `text` at 1px font size */
export function textEm(text: string): number {
	let em = 0;
	for (const ch of text) em += charEm(ch);
	return em;
}

/** Largest font size (0.1px steps, at most `maxPx`) at which `em` ems fit in `widthPx` */
export function fitEm(em: number, widthPx: number, maxPx: number) {
	if (em <= 0) return maxPx;
	return Math.min(maxPx, Math.floor((widthPx / em) * 10) / 10);
}

export function fitFontPx(text: string, widthPx: number, maxPx: number) {
	return fitEm(textEm(text), widthPx, maxPx);
}

/** Split `text` into two lines of near-equal width, at a space when there is one */
export function splitTwoLines(text: string): [string, string] {
	const chars = [...text];
	const spaces = chars.flatMap((ch, i) => (ch === " " ? [i] : []));
	const cuts = spaces.length ? spaces : chars.map((_, i) => i).slice(1);
	let best: [string, string] = [text, ""];
	let bestWidth = Number.POSITIVE_INFINITY;
	for (const cut of cuts) {
		const head = chars.slice(0, cut).join("").trimEnd();
		const tail = chars
			.slice(spaces.length ? cut + 1 : cut)
			.join("")
			.trimStart();
		if (!head || !tail) continue;
		const width = Math.max(textEm(head), textEm(tail));
		if (width < bestWidth) {
			bestWidth = width;
			best = [head, tail];
		}
	}
	return best;
}

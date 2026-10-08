const ESCAPE_REG = /["&'<>]/;

function stringifyValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return "";
	if (typeof value === "function")
		return stringifyValue((value as () => unknown).call(value));
	return JSON.stringify(value);
}

function xmlEscape(content: string): string {
	const html = `${content}`;
	const first = ESCAPE_REG.exec(html);
	if (!first) return content;
	let result = "";
	let lastIndex = 0;
	let i = first.index;
	for (; i < html.length; i++) {
		let char: string | undefined;
		switch (html.charCodeAt(i)) {
			case 34:
				char = "&#34;";
				break;
			case 38:
				char = "&#38;";
				break;
			case 39:
				char = "&#39;";
				break;
			case 60:
				char = "&#60;";
				break;
			case 62:
				char = "&#62;";
				break;
			default:
				continue;
		}
		if (lastIndex !== i) result += html.substring(lastIndex, i);
		lastIndex = i + 1;
		result += char;
	}
	return lastIndex !== i ? result + html.substring(lastIndex, i) : result;
}

export const artImports = {
	$escape: (content: unknown) => xmlEscape(stringifyValue(content)),
	$each: (data: unknown, callback: (value: unknown, key: unknown) => void) => {
		if (Array.isArray(data)) {
			for (let i = 0; i < data.length; i++) callback(data[i], i);
		} else if (data && typeof data === "object") {
			for (const key in data as Record<string, unknown>) {
				callback((data as Record<string, unknown>)[key], key);
			}
		}
	},
};

export type ArtFactory = (
	imports: typeof artImports,
	options: ArtRenderOptions,
) => (data: object, blocks?: object) => string;

export type ArtRenderOptions = {
	filename: string;
	include: (
		src: string,
		data: object,
		blocks: unknown,
		options: ArtRenderOptions,
	) => string;
	resolveFilename: (src: string, options: ArtRenderOptions) => string;
};

export function artKey(file: string): string {
	const n = file.replace(/\\/g, "/");
	const i = n.lastIndexOf("/html/");
	let key = i >= 0 ? n.slice(i + "/html/".length) : n.replace(/^\//, "");
	if (key && !key.endsWith(".art")) key += ".art";
	return key;
}

export function resolveArtPath(src: string, fromFile: string): string {
	const name = src.replace(/\\/g, "/");
	if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return name;
	const from = fromFile.replace(/\\/g, "/");
	const dir = from.slice(0, from.lastIndexOf("/"));
	const joined = `${dir}/${name}`.replace(/\/+/g, "/");
	return joined.endsWith(".art") || joined.includes(".")
		? joined
		: `${joined}.art`;
}

export type B30Record = {
	id: string;
	rank: string;
	rks: number;
	kind: "phi" | "best";
	slot: string;
};

type LooseB30 = { id?: string; rank?: string; rks?: number } | null | undefined;

export function getB30AnalysisRecords(b30: {
	phi?: LooseB30[] | unknown[];
	b19_list?: LooseB30[] | unknown[];
}): B30Record[] {
	const asRow = (record: unknown): LooseB30 => record as LooseB30;
	const phi = (b30.phi || []).slice(0, 3).map((record, index) => {
		const row = asRow(record);
		return row
			? {
					id: row.id,
					rank: row.rank,
					rks: Number(row.rks),
					kind: "phi" as const,
					slot: `P${index + 1}`,
				}
			: null;
	});
	const best = (b30.b19_list || []).slice(0, 27).map((record, index) => {
		const row = asRow(record);
		return row
			? {
					id: row.id,
					rank: row.rank,
					rks: Number(row.rks),
					kind: "best" as const,
					slot: `B${index + 1}`,
				}
			: null;
	});
	return [...phi, ...best].filter((record): record is B30Record => {
		if (record == null || !record.id) return false;
		return (
			["EZ", "HD", "IN", "AT", "LEGACY"].includes(record.rank ?? "") &&
			Number.isFinite(record.rks)
		);
	});
}

function niceAxisStep(value: number) {
	const candidates = [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1];
	return candidates.find((candidate) => candidate >= value) || Math.ceil(value);
}

export function buildRksHistogram(records: B30Record[], targetTickCount = 4) {
	const valid = records.filter((record) => Number.isFinite(record.rks));
	if (!valid.length)
		return { slots: [], ticks: [], average: 0, averagePosition: 0, count: 0 };

	const values = valid.map((record) => record.rks);
	const minimum = Math.min(...values);
	const maximum = Math.max(...values);
	const step = niceAxisStep(Math.max(maximum - minimum, 0.2) / targetTickCount);
	const domainMin = Math.floor((minimum - step * 0.1) / step) * step;
	let domainMax = Math.ceil((maximum + step * 0.1) / step) * step;
	if (domainMax <= domainMin) domainMax = domainMin + step;
	const domainRange = domainMax - domainMin;

	const ticks = [];
	const tickCount = Math.round(domainRange / step);
	for (let index = 0; index <= tickCount; index++) {
		const value = domainMin + index * step;
		ticks.push({
			value,
			label: value.toFixed(2),
			position: (index / tickCount) * 100,
		});
	}

	const slotCounters = { phi: 0, best: 0 };
	const slots = valid.map((record) => {
		slotCounters[record.kind] += 1;
		return {
			label:
				record.slot ||
				`${record.kind === "phi" ? "P" : "B"}${slotCounters[record.kind]}`,
			rks: record.rks,
			kind: record.kind,
			height: Math.min(
				100,
				Math.max(0, ((record.rks - domainMin) / domainRange) * 100),
			),
		};
	});

	const average = values.reduce((sum, value) => sum + value, 0) / values.length;
	return {
		slots,
		ticks,
		average,
		averagePosition: Math.min(
			100,
			Math.max(0, ((average - domainMin) / domainRange) * 100),
		),
		count: valid.length,
		domainMin,
		domainMax,
	};
}

export type ChartTagTreeNode = {
	name: string;
	voteCount?: number;
	children?: ChartTagTreeNode[];
};

export type ChartTagVotes = Record<
	string,
	Record<string, Record<string, number>>
>;

export type TagScore = {
	name: string;
	rks: number;
	votes: number;
	charts: number;
};

export type RadarCategory = {
	name: string;
	rks: number;
	votes: number;
	hasVotes: boolean;
	displayRks: string;
	pointX: number;
	pointY: number;
	labelX: number;
	labelY: number;
	anchor: "start" | "middle" | "end";
};

export type TagRadar = {
	grids: string[];
	axes: { x: number; y: number }[];
	points: string;
	categories: RadarCategory[];
};

export type TagAnalysis = {
	totalVotes: number;
	minimumVotes: number;
	averageRks: number;
	categories: {
		name: string;
		rks: number;
		votes: number;
		hasVotes: boolean;
	}[];
	radar: TagRadar;
	strong: TagScore[];
	weak: TagScore[];
	insufficient: boolean;
};

const RADAR_CX = 100;
const RADAR_CY = 92;
const RADAR_R = 55;
/** Outer ring is this rks, so 16.3 vs 6.3 keep their real ratio. */
const RADAR_RKS_MAX = 17;
const MIN_VOTES = 20;
const RANK_LIMIT = 3;
const MIN_CHARTS = 2;

function round(value: number) {
	return Math.round(value * 100) / 100;
}

function walkLeaves(
	nodes: ChartTagTreeNode[],
	visit: (node: ChartTagTreeNode) => void,
) {
	for (const node of nodes) {
		if (node.children?.length) walkLeaves(node.children, visit);
		else visit(node);
	}
}

function uniqueLeaves(tree: ChartTagTreeNode[]) {
	const seen = new Set<string>();
	const leaves: ChartTagTreeNode[] = [];
	walkLeaves(tree, (node) => {
		if (seen.has(node.name)) return;
		seen.add(node.name);
		leaves.push(node);
	});
	return leaves;
}

function categoryVotes(
	category: ChartTagTreeNode,
	votes: Record<string, number>,
) {
	const seen = new Set<string>();
	const collect = (node: ChartTagTreeNode): number => {
		if (node.children?.length) {
			return node.children.reduce((sum, child) => sum + collect(child), 0);
		}
		if (seen.has(node.name)) return 0;
		seen.add(node.name);
		return Math.max(0, Number(votes[node.name] || 0));
	};
	return collect(category);
}

type Acc = { weighted: number; votes: number; charts: number };

function addAcc(
	acc: Map<string, Acc>,
	name: string,
	rks: number,
	votes: number,
) {
	if (votes <= 0) return;
	const row = acc.get(name) || { weighted: 0, votes: 0, charts: 0 };
	row.weighted += rks * votes;
	row.votes += votes;
	row.charts += 1;
	acc.set(name, row);
}

export function buildTagRadar(
	categories: {
		name: string;
		rks: number;
		votes: number;
		hasVotes: boolean;
	}[],
): TagRadar {
	const n = Math.max(3, categories.length);
	const at = (index: number, t: number) => {
		const ang = -Math.PI / 2 + (index / n) * Math.PI * 2;
		return {
			x: RADAR_CX + Math.cos(ang) * RADAR_R * t,
			y: RADAR_CY + Math.sin(ang) * RADAR_R * t,
		};
	};
	const pair = (p: { x: number; y: number }) => `${round(p.x)},${round(p.y)}`;
	const grids = [0.25, 0.5, 0.75, 1].map((t) =>
		Array.from({ length: n }, (_, i) => pair(at(i, t))).join(" "),
	);
	const axes = Array.from({ length: n }, (_, i) => {
		const p = at(i, 1);
		return { x: round(p.x), y: round(p.y) };
	});
	const placed = categories.map((category, i) => {
		const t = category.hasVotes
			? Math.min(1, Math.max(0, category.rks / RADAR_RKS_MAX))
			: 0.08;
		const point = at(i, t);
		const label = at(i, 1.42);
		const anchor: RadarCategory["anchor"] =
			label.x < RADAR_CX - 8
				? "end"
				: label.x > RADAR_CX + 8
					? "start"
					: "middle";
		return {
			...category,
			displayRks: category.hasVotes ? category.rks.toFixed(2) : "—",
			pointX: round(point.x),
			pointY: round(point.y),
			labelX: round(label.x),
			labelY: round(label.y),
			anchor,
		};
	});
	return {
		grids,
		axes,
		points: placed.map((c) => `${c.pointX},${c.pointY}`).join(" "),
		categories: placed,
	};
}

export function buildTagAnalysis(
	records: B30Record[],
	tree: ChartTagTreeNode[],
	votesByChart: ChartTagVotes,
): TagAnalysis {
	const tagAcc = new Map<string, Acc>();
	const catAcc = new Map<string, Acc>();
	const leaves = uniqueLeaves(tree);
	let totalVotes = 0;

	for (const record of records) {
		const votes = votesByChart[record.id]?.[record.rank] || {};
		for (const leaf of leaves) {
			const count = Math.max(0, Number(votes[leaf.name] || 0));
			if (!count) continue;
			addAcc(tagAcc, leaf.name, record.rks, count);
			totalVotes += count;
		}
		for (const category of tree) {
			addAcc(catAcc, category.name, record.rks, categoryVotes(category, votes));
		}
	}

	const categories = tree.map((category) => {
		const acc = catAcc.get(category.name);
		return {
			name: category.name,
			rks: acc ? acc.weighted / acc.votes : 0,
			votes: acc?.votes || 0,
			hasVotes: Boolean(acc && acc.votes > 0),
		};
	});

	const tags: TagScore[] = [...tagAcc.entries()].map(([name, acc]) => ({
		name,
		rks: acc.weighted / acc.votes,
		votes: acc.votes,
		charts: acc.charts,
	}));
	const preferred = tags.filter((tag) => tag.charts >= MIN_CHARTS);
	const pool = preferred.length >= 2 ? preferred : tags;
	const average =
		pool.reduce((sum, tag) => sum + tag.rks, 0) / Math.max(pool.length, 1);
	const strong = pool
		.filter((tag) => tag.rks >= average)
		.sort((a, b) => b.rks - a.rks || b.votes - a.votes)
		.slice(0, RANK_LIMIT);
	const taken = new Set(strong.map((tag) => tag.name));
	const weak = pool
		.filter((tag) => tag.rks < average && !taken.has(tag.name))
		.sort((a, b) => a.rks - b.rks || b.votes - a.votes)
		.slice(0, RANK_LIMIT);

	const votedCats = categories.filter((category) => category.hasVotes).length;
	const insufficient =
		totalVotes < MIN_VOTES || pool.length < 2 || votedCats < 2;

	return {
		totalVotes,
		minimumVotes: MIN_VOTES,
		averageRks:
			records.reduce((sum, record) => sum + record.rks, 0) /
			Math.max(records.length, 1),
		categories,
		radar: buildTagRadar(
			categories.length >= 3
				? categories
				: [
						...categories,
						...Array.from(
							{ length: Math.max(0, 3 - categories.length) },
							() => ({
								name: "",
								rks: 0,
								votes: 0,
								hasVotes: false,
							}),
						),
					],
		),
		strong: insufficient ? [] : strong,
		weak: insufficient ? [] : weak,
		insufficient,
	};
}

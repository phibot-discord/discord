export type PhiVersion = {
	ver: string;
	phigros: string;
	phigrosVerNum: number;
};

const bundled: PhiVersion = {
	ver: "v1.0.2",
	phigros: "3.19.5",
	phigrosVerNum: 153,
};

let current: PhiVersion = { ...bundled };

export function readPhiVersion(): PhiVersion {
	return current;
}

export function applyPhiVersion(patch: Partial<PhiVersion>) {
	current = {
		ver: patch.ver ?? current.ver,
		phigros: patch.phigros ?? current.phigros,
		phigrosVerNum: patch.phigrosVerNum ?? current.phigrosVerNum,
	};
}

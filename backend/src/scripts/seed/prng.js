// mulberry32: a tiny deterministic generator so every seed run produces identical data.
export function prng(seed) {
	let state = seed >>> 0;
	return () => {
		state += 0x6d2b79f5;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export const pick = (random, items) => items[Math.floor(random() * items.length)];
export const between = (random, min, max) => min + Math.floor(random() * (max - min + 1));

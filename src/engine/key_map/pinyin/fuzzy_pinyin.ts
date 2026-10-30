import { getValue } from "../../utils/obj.ts";
import { spilt_pinyin } from "./split_pinyin.ts";

export type FuzzyPinyinConfig = {
	initial?: Record<string, string>;
	final?: Record<string, string>;
	all?: Record<string, string>;
};

const fuzzyPinyinConfig: FuzzyPinyinConfig = {
	initial: {
		c: "ch",
		z: "zh",
		s: "sh",
		ch: "c",
		zh: "z",
		sh: "s",
		// 'l': 'n',
		// 'n': 'l',
		// 'f': 'h',
		// 'h': 'f',
		// 'r': 'l',
		// 'l': 'r',
	},
	final: {
		an: "ang",
		ang: "an",
		en: "eng",
		eng: "en",
		in: "ing",
		ing: "in",
		// "ian": "iang",
		// "iang": "ian",
		uan: "uang",
		uang: "uan",
	},
};

export function generate_fuzzy_pinyin(
	pinyin: string,
	config: FuzzyPinyinConfig = fuzzyPinyinConfig,
) {
	const fuzzy_variants = new Set<string>();
	fuzzy_variants.add(pinyin);
	const [initial, final] = spilt_pinyin(pinyin);
	for (const i of [initial, getValue(config.initial, initial)].concat()) {
		for (const j of [final, getValue(config.final, final)]) {
			if (i && j) fuzzy_variants.add(i + j);
		}
	}
	const all = getValue(config.all, pinyin);
	if (all) fuzzy_variants.add(all);
	return Array.from(fuzzy_variants);
}

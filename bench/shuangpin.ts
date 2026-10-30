import { generate_pinyin } from "../src/engine/key_map/pinyin/all_pinyin.ts";
import {
	generate_shuang_pinyin,
	shuangpinMaps,
} from "../src/engine/key_map/pinyin/shuangpin.ts";

const allPinyin = generate_pinyin().toSorted((a, b) => b.length - a.length);
const shuangpinMap = generate_shuang_pinyin(allPinyin, shuangpinMaps.自然码);

export const pinyinToShuangpin = new Map<string, string>();
for (const [key, pinyins] of Object.entries(shuangpinMap)) {
	for (const py of pinyins) {
		if (!pinyinToShuangpin.has(py)) pinyinToShuangpin.set(py, key);
	}
}

export function toShuangpin(py: string): string {
	return pinyinToShuangpin.get(normalizePinyin(py)) ?? "";
}

export function normalizePinyin(py: string): string {
	return py.trim().toLowerCase().replaceAll("ü", "v").replaceAll("u:", "v");
}

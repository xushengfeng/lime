import { expect, test } from "vitest";
import { generate_pinyin } from "../../src/engine/key_map/pinyin/all_pinyin.ts";
import {
	generate_shuang_pinyin,
	type ShuangpinMap,
	shuangpinMaps,
} from "../../src/engine/key_map/pinyin/shuangpin.ts";

const all = generate_pinyin();

function check(shuangpinM: ShuangpinMap) {
	const shuangpin = generate_shuang_pinyin(all, shuangpinM);
	const as = new Set(all);
	for (const i of Object.values(shuangpin)) {
		for (const p of i) as.delete(p);
	}
	expect(as).toEqual(new Set());
}

test("generate shuangpin", () => {
	for (const [name, map] of Object.entries(shuangpinMaps)) {
		console.log("测试双拼方案", name);
		check(map);
	}
});

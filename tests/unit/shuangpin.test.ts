import { assertEquals } from "@std/assert";
import { generate_pinyin } from "../all_pinyin.ts";
import {
	generate_shuang_pinyin,
	type ShuangpinMap,
	shuangpinMaps,
} from "../shuangpin.ts";

const all = generate_pinyin();

function check(shuangpinM: ShuangpinMap) {
	const shuangpin = generate_shuang_pinyin(all, shuangpinM);
	const as = new Set(all);
	for (const i of Object.values(shuangpin)) {
		for (const p of i) as.delete(p);
	}
	assertEquals(as, new Set());
}

Deno.test("generate shuangpin", () => {
	for (const [name, map] of Object.entries(shuangpinMaps)) {
		console.log("测试双拼方案", name);
		check(map);
	}
});

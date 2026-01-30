import { assertEquals } from "@std/assert";
import { load_pinyin } from "../key_map/pinyin/gen_zi_pinyin.ts";
import { keys_to_pinyin } from "../key_map/pinyin/keys_to_pinyin.ts";
import { initLIME } from "../main.ts";

const { commit, single_ci, addUserWord } = await initLIME({
	ziInd: load_pinyin(),
});

Deno.test("组词", async () => {
	addUserWord("冰灯");
	const r = await single_ci(keys_to_pinyin("bingdeng"));
	console.log(r.candidates.slice(0, 5));
	assertEquals(r.candidates[0].word, "冰灯");
});

Deno.test("智能组词", async () => {
	await commit("冰灯");
	await commit("是");
	await commit("流行于");
	const nr = await single_ci(keys_to_pinyin("vsgobz", { shuangpin: "自然码" }));
	console.log(nr.candidates.slice(0, 5));
});

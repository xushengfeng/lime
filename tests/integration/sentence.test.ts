import { assert } from "@std/assert";
import { load_pinyin } from "../key_map/pinyin/gen_zi_pinyin.ts";
import { keys_to_pinyin } from "../key_map/pinyin/keys_to_pinyin.ts";
import { initLIME } from "../main.ts";

const { single_ci, commit, getUserData } = await initLIME({
	ziInd: load_pinyin(),
});

Deno.test("长句识别", async () => {
	const py = "veuiyigehfijdejuzi".split("");
	for (let i = 0; i < py.length; i++) {
		console.log(py.slice(0, i + 1).join(""));
		const c = await single_ci(
			keys_to_pinyin(py.slice(0, i + 1).join(""), { shuangpin: "自然码" }),
		);
		console.log(c.candidates.slice(0, 5).map((i) => i.word));
	}
	await commit("无");
	console.log(getUserData());
});

Deno.test("长句识别，删除", async () => {
	const py = "veuiyigehfijdejuzi".split("");
	for (let i = 0; i < py.length; i++) {
		console.log(py.slice(0, i + 1).join(""));
		const c = await single_ci(
			keys_to_pinyin(py.slice(0, i + 1).join(""), { shuangpin: "自然码" }),
		);
		console.log(c.candidates.slice(0, 5).map((i) => i.word));
	}
	for (let i = py.length; i > 0; i--) {
		console.log(py.slice(0, i).join(""));
		const c = await single_ci(
			keys_to_pinyin(py.slice(0, i).join(""), { shuangpin: "自然码" }),
		);
		console.log(c.candidates.slice(0, 5).map((i) => i.word));
	}
	await commit("无");
	console.log(getUserData());
});

Deno.test("长词优先和长句生成", async () => {
	await commit("在田野上，");
	// 不知道为什么，qwen有个“农副”的token，就以此作为例子
	const c = await single_ci(keys_to_pinyin("nsfu", { shuangpin: "自然码" }));
	console.log(c.candidates.slice(0, 5));
});

Deno.test("长句处理等价", async () => {
	commit("冰灯是");
	const py = "lqxyyuvsgobzfh";
	const a = (await single_ci(keys_to_pinyin(py, { shuangpin: "自然码" })))
		.candidates[0].word;
	for (let i = 1; i < py.length; i++) {
		const x = await single_ci(
			keys_to_pinyin(py.slice(0, i), { shuangpin: "自然码" }),
		);
		console.log(x.candidates[0].word);
	}
	const b = (await single_ci(keys_to_pinyin(py, { shuangpin: "自然码" })))
		.candidates[0].word;
	console.log(a, b);
	assert(a === b);
});

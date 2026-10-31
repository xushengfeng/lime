import { expect, test } from "vitest";
import { load_pinyin } from "../src/engine/key_map/pinyin/gen_zi_pinyin.ts";
import { keys_to_pinyin } from "../src/engine/key_map/pinyin/keys_to_pinyin.ts";
import { initLIME } from "../src/engine/main.ts";

const runner = await initLIME({
	ziInd: load_pinyin(),
	algorithm: "dict-llm-v1",
});

test("词库 + LLM 评估：长句", async () => {
	await runner.reset_context();
	await runner.commit("冰灯是");
	await runner.getEvalResult();
	const result = await runner.single_ci(
		keys_to_pinyin("liuxingyuzhongguobeifang"),
	);
	expect(result.candidates[0]?.word).toBe("流行于中国北方");
});

test("词库 + LLM 评估：普通词", async () => {
	await runner.reset_context();
	const result = await runner.single_ci(keys_to_pinyin("nihao"));
	expect(result.candidates[0]?.word).toBe("你好");
});

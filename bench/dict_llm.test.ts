import { expect, test } from "vitest";
import { createQualityDictLlm } from "../src/engine/algorithms/dict-llm.ts";
import { load_pinyin } from "../src/engine/key_map/pinyin/gen_zi_pinyin.ts";
import { keys_to_pinyin } from "../src/engine/key_map/pinyin/keys_to_pinyin.ts";
import { initLIME } from "../src/engine/main.ts";

// 这里测质量模式；默认的 dict-llm-v1 是每键固定评估预算的快速模式。
const runner = await initLIME({
	ziInd: load_pinyin(),
	algorithm: createQualityDictLlm(),
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

test("完整覆盖候选在分差很小时优先", async () => {
	await runner.reset_context();
	await runner.commit("你好世界我向你介绍");
	await runner.getEvalResult();
	const result = await runner.single_ci(keys_to_pinyin("yigeren"));
	expect(result.candidates[0]?.word).toBe("一个人");
});

test("质量模式：后文消歧", async () => {
	await runner.reset_context();
	await runner.commit("我告诉你");
	await runner.getEvalResult();
	const result = await runner.single_ci(keys_to_pinyin("tashinvde"));
	expect(result.candidates[0]?.word).toBe("她是女的");
	// 只保留第一个长句，后面应回退到词语
	expect(result.candidates.slice(1).some((c) => c.word.length <= 2)).toBe(
		true,
	);
});

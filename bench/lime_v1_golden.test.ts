import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { load_pinyin } from "../src/engine/key_map/pinyin/gen_zi_pinyin.ts";
import { keys_to_pinyin } from "../src/engine/key_map/pinyin/keys_to_pinyin.ts";
import { initLIME } from "../src/engine/main.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const goldenPath = path.join(__dirname, "fixtures/lime_v1_golden.json");

type GoldenCandidate = {
	word: string;
	pinyin: string[];
	remainkeys: string[];
	preedit: string;
	consumedkeys: number;
	score: number;
};

type GoldenCase = {
	name: string;
	keys: string;
	input: ReturnType<typeof keys_to_pinyin>;
	candidates: GoldenCandidate[];
};

type Golden = {
	cases: GoldenCase[];
};

const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as Golden;
const goldenCases = new Map(golden.cases.map((item) => [item.name, item]));

test("lime-v1 行为快照", async () => {
	const runner = await initLIME({
		ziInd: load_pinyin(),
		algorithm: "lime-v1",
	});
	await runner.reset_context();

	async function expectCase(name: string) {
		const expected = goldenCases.get(name);
		if (!expected) throw new Error(`缺少 golden 用例: ${name}`);
		const result = await runner.single_ci(expected.input);
		const candidates = result.candidates.slice(0, expected.candidates.length);
		expect(candidates.length, `${name} 候选数量`).toBe(
			expected.candidates.length,
		);
		for (const [i, candidate] of candidates.entries()) {
			const want = expected.candidates[i];
			expect(
				{
					word: candidate.word,
					pinyin: candidate.pinyin,
					remainkeys: candidate.remainkeys,
					preedit: candidate.preedit,
					consumedkeys: candidate.consumedkeys,
				},
				`${name} 第 ${i + 1} 个候选`,
			).toEqual({
				word: want.word,
				pinyin: want.pinyin,
				remainkeys: want.remainkeys,
				preedit: want.preedit,
				consumedkeys: want.consumedkeys,
			});
			expect(candidate.score, `${name} 第 ${i + 1} 个候选分数`).toBeCloseTo(
				want.score,
				10,
			);
		}
	}

	await expectCase("基础候选");

	await runner.commit("冰灯是");
	await expectCase("长句补全");
	await expectCase("长词优先");
	await expectCase("渐近输入");

	runner.addUserWord("冰灯");
	await expectCase("用户词");
});

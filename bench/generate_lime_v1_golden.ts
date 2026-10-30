import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load_pinyin } from "../src/engine/key_map/pinyin/gen_zi_pinyin.ts";
import { keys_to_pinyin } from "../src/engine/key_map/pinyin/keys_to_pinyin.ts";
import { initLIME, type Candidate } from "../src/engine/main.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "fixtures/lime_v1_golden.json");

type GoldenCase = {
	name: string;
	keys: string;
	input: ReturnType<typeof keys_to_pinyin>;
	candidates: Array<
		Pick<
			Candidate,
			"word" | "pinyin" | "remainkeys" | "preedit" | "consumedkeys" | "score"
		>
	>;
};

const cases: GoldenCase[] = [];

const runner = await initLIME({ ziInd: load_pinyin(), algorithm: "lime-v1" });
await runner.reset_context();

async function query(name: string, keys: string, input: GoldenCase["input"]) {
	const result = await runner.single_ci(input);
	cases.push({
		name,
		keys,
		input,
		candidates: result.candidates.slice(0, 20).map((candidate) => ({
			word: candidate.word,
			pinyin: candidate.pinyin,
			remainkeys: candidate.remainkeys,
			preedit: candidate.preedit,
			consumedkeys: candidate.consumedkeys,
			score: candidate.score,
		})),
	});
}

await query("基础候选", "nihao", keys_to_pinyin("nihao"));

await runner.commit("冰灯是");
await query(
	"长句补全",
	"lqxyyuvsgobzfh",
	keys_to_pinyin("lqxyyuvsgobzfh", { shuangpin: "自然码" }),
);
await query(
	"长词优先",
	"nsfu",
	keys_to_pinyin("nsfu", { shuangpin: "自然码" }),
);
await query(
	"渐近输入",
	"veuiyigehfijdejuzi",
	keys_to_pinyin("veuiyigehfijdejuzi", { shuangpin: "自然码" }),
);

runner.addUserWord("冰灯");
await query("用户词", "bingdeng", keys_to_pinyin("bingdeng"));

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(
	outPath,
	JSON.stringify(
		{
			model: "Qwen3-0.6B-IQ4_XS",
			note: "由 bench/generate_lime_v1_golden.ts 生成，用于冻结 lime-v1 行为。",
			cases,
		},
		null,
		2,
	),
);
console.log(`写入 ${outPath}，${cases.length} 个用例`);

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./src/config/types.ts";
import { createQualityDictLlm } from "./src/engine/algorithms/dict-llm.ts";
import { resortFeq } from "./src/engine/resort_feq.ts";
import { load_pinyin } from "./src/engine/key_map/pinyin/gen_zi_pinyin.ts";
import { keys_to_pinyin } from "./src/engine/key_map/pinyin/keys_to_pinyin.ts";
import { initLIME } from "./src/engine/main.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: Config = {
	runner: await initLIME({
		ziInd: load_pinyin(),
		// 质量模式：完整长句评估，速度慢；只是想快速打字可换回 "lime-v1" 或快速版 "dict-llm-v1"
		algorithm: createQualityDictLlm(),
		omitContext: true,
		afterReSort: [
			resortFeq(
				readFileSync(
					path.join(__dirname, "assets/hanzi/top2500.txt"),
					"utf8",
				)
					.split("\n")
					.filter((w) => w.trim()),
				{ index: 4 },
			),
		],
	}),
	key2ZiInd: (key: string) =>
		keys_to_pinyin(key, {
			// 可改为 "自然码"、"搜狗"、"微软"、"小鹤" 等双拼方案
			shuangpin: false,
			fuzzy: {
				initial: {
					c: "ch",
					z: "zh",
					s: "sh",
					ch: "c",
					zh: "z",
					sh: "s",
				},
				final: {
					an: "ang",
					ang: "an",
					en: "eng",
					eng: "en",
					in: "ing",
					ing: "in",
					uan: "uang",
					uang: "uan",
				},
			},
		}),
	userWordsPath: path.join(__dirname, "userword/preload_word.txt"),
};

export default config;

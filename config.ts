import path from "node:path";
import { fileURLToPath } from "node:url";
import { load_pinyin } from "./key_map/pinyin/gen_zi_pinyin.ts";
import { keys_to_pinyin } from "./key_map/pinyin/keys_to_pinyin.ts";
import { initLIME } from "./main.ts";
import type { Config } from "./utils/config.d.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: Config = {
	runner: await initLIME({ ziInd: load_pinyin(), omitContext: true }),
	key2ZiInd: (key: string) =>
		keys_to_pinyin(key, {
			shuangpin: "自然码",
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

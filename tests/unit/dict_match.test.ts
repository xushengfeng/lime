import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { WordDictionary } from "../../src/engine/algorithms/dict/dictionary.ts";
import { keys_to_pinyin } from "../../src/engine/key_map/pinyin/keys_to_pinyin.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dictFile = path.join(__dirname, "../fixtures/dict/test.dict.yaml");

test("词库按音节匹配普通词", () => {
	const dict = new WordDictionary({
		files: [dictFile],
		includeWords: false,
		includeRareChars: false,
	});
	const matches = dict.matchAt(keys_to_pinyin("nihao"), 0);
	expect(matches.some((match) => match.entry.word === "你好")).toBe(true);
});

test("词库可以匹配长句起始位置和中间位置", () => {
	const dict = new WordDictionary({
		files: [dictFile],
		includeWords: false,
		includeRareChars: false,
	});
	const input = keys_to_pinyin("dediyuybui", { shuangpin: "自然码" });
	expect(
		dict.matchAt(input, 0).some((match) => match.entry.word === "的"),
	).toBe(true);
	expect(
		dict.matchAt(input, 1).some((match) => match.entry.word === "地域"),
	).toBe(true);
	expect(
		dict.matchAt(input, 3).some((match) => match.entry.word === "优势"),
	).toBe(true);
});

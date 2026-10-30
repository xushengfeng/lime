import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pinyin } from "pinyin-pro";
import type { ZiIndAndKey } from "../src/engine/key_map/zi_ind.ts";
import { toShuangpin } from "./shuangpin.ts";

export type BaselineMode = "base" | "adapt" | "bigram" | "rime" | "qwen";

type CharEntry = {
	char: string;
	weight: number;
	order: number;
};

type Dictionary = Map<string, CharEntry[]>;

export type WordEntry = {
	word: string;
	key: string;
	syllables: number;
	weight: number;
};

type WordTrie = {
	children: Map<string, WordTrie>;
	entries: WordEntry[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dictDir = path.join(__dirname, "../assets/pinyin");
const qwenTokenPath = path.join(__dirname, "dicts/qwen_tokens.tsv");

let cachedDictionary: Dictionary | undefined;

function addDictFile(
	dict: Dictionary,
	file: string,
	hasWeight: boolean,
	defaultWeight: number,
) {
	const text = readFileSync(file, "utf8");
	let order = 0;
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (
			!line ||
			line.startsWith("#") ||
			line === "---" ||
			line === "..." ||
			line.startsWith("name:") ||
			line.startsWith("version:") ||
			line.startsWith("sort:")
		) {
			continue;
		}
		const fields = line.split("\t");
		const char = fields[0]?.trim();
		const rawPinyin = fields[1]?.trim();
		if (!char || !rawPinyin) continue;
		const weight = hasWeight ? Number(fields[2] || defaultWeight) : defaultWeight;
		for (const pinyin of rawPinyin.split(/\s+/)) {
			const entries = dict.get(pinyin) ?? [];
			const existing = entries.find((entry) => entry.char === char);
			if (existing) {
				existing.weight = Math.max(existing.weight, weight);
			} else {
				entries.push({ char, weight, order: order++ });
			}
			dict.set(pinyin, entries);
		}
	}
}

export function loadDictionary(): Dictionary {
	if (cachedDictionary) return cachedDictionary;
	const dict: Dictionary = new Map();
	addDictFile(dict, path.join(dictDir, "8105.dict.yaml"), true, 1);
	addDictFile(dict, path.join(dictDir, "41448.dict.yaml"), false, 0.001);
	cachedDictionary = dict;
	return dict;
}

/**
 * 字级拼音输入法基线：字典字频 + 在线字频/上下文调频。
 */
export class DictionaryIME {
	private unigram = new Map<string, number>();
	private bigram = new Map<string, Map<string, number>>();
	private previous = "";
	private dictionary: Dictionary;

	constructor(
		public mode: Exclude<BaselineMode, "rime" | "qwen"> = "adapt",
		private adaptWeight = 2,
		private bigramWeight = 3,
	) {
		this.dictionary = loadDictionary();
	}

	reset() {
		this.unigram.clear();
		this.bigram.clear();
		this.previous = "";
	}

	candidates(options: ZiIndAndKey[]): string[] {
		const best = new Map<string, number>();
		for (const option of options) {
			for (const entry of this.dictionary.get(option.ind) ?? []) {
				const score = this.score(entry);
				if (!best.has(entry.char) || score > (best.get(entry.char) ?? 0)) {
					best.set(entry.char, score);
				}
			}
		}
		return Array.from(best.entries())
			.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
			.map(([char]) => char);
	}

	private score(entry: CharEntry): number {
		const base = Math.log1p(entry.weight) + entry.order * 1e-9;
		if (this.mode === "base") return base;
		let score = base + this.adaptWeight * Math.log1p(
			this.unigram.get(entry.char) ?? 0,
		);
		if (this.mode === "bigram" && this.previous) {
			score += this.bigramWeight * Math.log1p(
				this.bigram.get(this.previous)?.get(entry.char) ?? 0,
			);
		}
		return score;
	}

	commit(char: string) {
		if (this.mode === "base") return;
		this.unigram.set(char, (this.unigram.get(char) ?? 0) + 1);
		if (this.mode === "bigram" && this.previous) {
			const row = this.bigram.get(this.previous) ?? new Map<string, number>();
			row.set(char, (row.get(char) ?? 0) + 1);
			this.bigram.set(this.previous, row);
		}
		this.previous = char;
	}

	commitLiteral() {
		this.previous = "";
	}
}

function readRimeLines(file: string): Array<{
	word: string;
	pinyins: string[];
	weight: number;
}> {
	const out: Array<{ word: string; pinyins: string[]; weight: number }> = [];
	for (const rawLine of readFileSync(file, "utf8").split("\n")) {
		const line = rawLine.trim();
		if (
			!line ||
			line.startsWith("#") ||
			line === "---" ||
			line === "..." ||
			line.startsWith("name:") ||
			line.startsWith("version:") ||
			line.startsWith("sort:")
		) {
			continue;
		}
		const fields = line.split("\t");
		const word = fields[0]?.trim();
		const rawPinyin = fields[1]?.trim();
		if (!word || !rawPinyin || !/^[\p{Script=Han}]+$/u.test(word)) {
			continue;
		}
		out.push({
			word,
			pinyins: rawPinyin.split(/\s+/),
			weight: Number(fields[2] || 1),
		});
	}
	return out;
}

function createTrie(): WordTrie {
	return { children: new Map(), entries: [] };
}

function addWord(
	entries: Map<string, WordEntry>,
	word: string,
	pinyins: string[],
	weight: number,
) {
	const keys = pinyins.map(toShuangpin);
	if (keys.some((key) => !key)) return;
	const key = keys.join("");
	if (!key) return;
	const id = `${word}\t${key}`;
	const existing = entries.get(id);
	if (existing) {
		existing.weight = Math.max(existing.weight, weight);
		return;
	}
	entries.set(id, {
		word,
		key,
		syllables: keys.length,
		weight: Math.max(0.001, weight),
	});
}

function buildTrie(entries: Iterable<WordEntry>): WordTrie {
	const root = createTrie();
	for (const entry of entries) {
		let node = root;
		for (const char of entry.key) {
			let child = node.children.get(char);
			if (!child) {
				child = createTrie();
				node.children.set(char, child);
			}
			node = child;
		}
		node.entries.push(entry);
	}
	return root;
}

let cachedRimeTrie: WordTrie | undefined;

function loadRimeTrie(): WordTrie {
	if (cachedRimeTrie) return cachedRimeTrie;
	const entries = new Map<string, WordEntry>();

	for (const file of [
		"8105.dict.yaml",
		"41448.dict.yaml",
		"words.dict.yaml",
	]) {
		const filePath = path.join(dictDir, file);
		if (!existsSync(filePath)) {
			if (file === "words.dict.yaml") {
				console.warn(
					"没有 assets/pinyin/words.dict.yaml，先运行 pnpm bench:words；本次只用字表。",
				);
			}
			continue;
		}
		for (const item of readRimeLines(filePath)) {
			addWord(entries, item.word, item.pinyins, item.weight);
		}
	}

	cachedRimeTrie = buildTrie(entries.values());
	return cachedRimeTrie;
}

let cachedQwenTrie: WordTrie | undefined;

function loadQwenTrie(): WordTrie {
	if (cachedQwenTrie) return cachedQwenTrie;
	if (!existsSync(qwenTokenPath)) {
		throw new Error(
			"缺少 bench/dicts/qwen_tokens.tsv，先运行 pnpm bench:tokens 从模型导出 token 表。",
		);
	}
	const entries = new Map<string, WordEntry>();
	for (const rawLine of readFileSync(qwenTokenPath, "utf8").split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const [word, rawWeight] = line.split("\t");
		if (!word || !/^[\p{Script=Han}]+$/u.test(word)) continue;
		const wordChars = Array.from(word);
		const pinyins = pinyin(word, {
			type: "array",
			multiple: true,
			toneType: "none",
			v: true,
		});
		if (wordChars.length === 1 && pinyins.length > 1) {
			for (const py of pinyins) {
				addWord(entries, word, [py], Number(rawWeight) || 1);
			}
		} else if (pinyins.length === wordChars.length) {
			addWord(entries, word, pinyins, Number(rawWeight) || 1);
		}
	}

	// 字表兜底：token 表没有覆盖到的字，以及单字的多音读法。
	for (const file of ["8105.dict.yaml", "41448.dict.yaml"]) {
		for (const item of readRimeLines(path.join(dictDir, file))) {
			addWord(entries, item.word, item.pinyins, 0.1);
		}
	}

	cachedQwenTrie = buildTrie(entries.values());
	return cachedQwenTrie;
}

function collectWords(root: WordTrie, keys: string): WordEntry[] {
	const found: WordEntry[] = [];
	let node = root;
	for (const char of keys) {
		const child = node.children.get(char);
		if (!child) break;
		node = child;
		found.push(...node.entries);
	}
	return found;
}

/**
 * 词级基线：词库前缀树 + 长词偏置 + 在线词频/上下文调频。
 */
export class WordIME {
	private trie: WordTrie;
	private wordCount = new Map<string, number>();
	private bigram = new Map<string, Map<string, number>>();
	private previous = "";

	constructor(
		public kind: "rime" | "qwen",
		private longWordBias = 0.8,
		private adaptWeight = 2,
		private bigramWeight = 3,
	) {
		this.trie = kind === "rime" ? loadRimeTrie() : loadQwenTrie();
	}

	reset() {
		this.wordCount.clear();
		this.bigram.clear();
		this.previous = "";
	}

	candidates(keys: string): WordEntry[] {
		const scored = collectWords(this.trie, keys).map((entry) => ({
			entry,
			score: this.score(entry),
		}));
		scored.sort(
			(a, b) =>
				b.score - a.score ||
				b.entry.syllables - a.entry.syllables ||
				b.entry.weight - a.entry.weight,
		);
		return scored.map((item) => item.entry);
	}

	private score(entry: WordEntry): number {
		let score = Math.log1p(entry.weight) +
			this.longWordBias * (entry.syllables - 1) +
			this.adaptWeight * Math.log1p(this.wordCount.get(entry.word) ?? 0);
		if (this.previous) {
			score += this.bigramWeight * Math.log1p(
				this.bigram.get(this.previous)?.get(entry.word[0]) ?? 0,
			);
		}
		return score;
	}

	commit(word: string) {
		this.wordCount.set(word, (this.wordCount.get(word) ?? 0) + 1);
		const chars = Array.from(word);
		const first = chars[0] ?? "";
		if (this.previous && first) {
			const row = this.bigram.get(this.previous) ?? new Map<string, number>();
			row.set(first, (row.get(first) ?? 0) + 1);
			this.bigram.set(this.previous, row);
		}
		this.previous = chars.at(-1) ?? "";
	}

	commitLiteral() {
		this.previous = "";
	}
}

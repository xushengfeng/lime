import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ZiIndAndKey, ZiIndL } from "../../key_map/zi_ind.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDictDir = path.join(__dirname, "../../../../assets/pinyin");

export type DictEntry = {
	word: string;
	pinyins: string[];
	weight: number;
};

export type DictMatch = {
	entry: DictEntry;
	/** 这个词消费到输入的第几个音节（不含）。 */
	end: number;
	/** 实际匹配到的输入音节，保留原始 preedit/key。 */
	matched: ZiIndAndKey[];
};

export type DictMatchOptions = {
	/** 输入里的 `*` 分隔符是否匹配任意音节。默认开启。 */
	allowWildcard?: boolean;
};

export type WordDictionaryOptions = {
	/** 覆盖默认词库文件。 */
	files?: string[];
	/** 没有 words.dict.yaml 时是否只使用字表。 */
	includeWords?: boolean;
	/** 是否加入 41448 大字表。 */
	includeRareChars?: boolean;
	/** 缺少 words.dict.yaml 时是否报错。默认 true，避免静默退回只有字表。 */
	requireWords?: boolean;
	dir?: string;
};

type DictFile = {
	file: string;
	defaultWeight: number;
};

const DEFAULT_FILES: DictFile[] = [
	{ file: "8105.dict.yaml", defaultWeight: 1 },
	{ file: "41448.dict.yaml", defaultWeight: 0.001 },
	{ file: "words.dict.yaml", defaultWeight: 1 },
];

function readRimeFile(file: string, defaultWeight: number): DictFileEntry[] {
	const out: DictFileEntry[] = [];
	let inMeta = false;
	for (const rawLine of readFileSync(file, "utf8").split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		if (line === "---") {
			inMeta = true;
			continue;
		}
		if (line === "...") {
			inMeta = false;
			continue;
		}
		if (inMeta) continue;

		const fields = line.split("\t");
		const word = fields[0]?.trim();
		const rawPinyin = fields[1]?.trim();
		if (!word || !rawPinyin || !/^[\p{Script=Han}]+$/u.test(word)) {
			continue;
		}
		const pinyins = rawPinyin.split(/\s+/).filter(Boolean);
		if (pinyins.length === 0) continue;
		const parsedWeight = Number(fields[2] || defaultWeight);
		out.push({
			word,
			pinyins,
			weight:
				Number.isFinite(parsedWeight) && parsedWeight > 0
					? parsedWeight
					: defaultWeight,
		});
	}
	return out;
}

type DictFileEntry = {
	word: string;
	pinyins: string[];
	weight: number;
};

export class WordDictionary {
	private readonly byFirst = new Map<string, DictEntry[]>();
	private readonly entries: DictEntry[] = [];

	constructor(options: WordDictionaryOptions = {}) {
		const dir = options.dir ?? defaultDictDir;
		const files = options.files
			? options.files.map((file) => ({ file, defaultWeight: 1 }))
			: DEFAULT_FILES.filter((item) => {
					if (item.file === "41448.dict.yaml") {
						return options.includeRareChars !== false;
					}
					if (item.file === "words.dict.yaml") {
						return options.includeWords !== false;
					}
					return true;
				});

		const unique = new Map<string, DictFileEntry>();
		let wordCount = 0;
		let charCount = 0;
		let wordLoaded = false;
		for (const item of files) {
			const filePath = path.isAbsolute(item.file)
				? item.file
				: path.join(dir, item.file);
			if (!existsSync(filePath)) {
				if (item.file === "words.dict.yaml") {
					if (options.requireWords !== false) {
						throw new Error(
							`缺少 ${filePath}。dict-llm-v1 需要下载词表来生成单词和长句；请先运行 pnpm words。`,
						);
					}
					console.warn(
						"没有 assets/pinyin/words.dict.yaml，dict-llm 只使用字表；先运行 pnpm words 可以获得更好的长句候选。",
					);
				}
				continue;
			}
			const entries = readRimeFile(filePath, item.defaultWeight);
			if (item.file === "words.dict.yaml") {
				wordLoaded = true;
				wordCount += entries.length;
			} else {
				charCount += entries.length;
			}
			for (const entry of entries) {
				const key = `${entry.word}\u0000${entry.pinyins.join(" ")}`;
				const old = unique.get(key);
				if (!old || entry.weight > old.weight) {
					unique.set(key, entry);
				}
			}
		}
		if (!wordLoaded && options.requireWords !== false && !options.files) {
			throw new Error(
				`没有可用的词表。dict-llm-v1 需要下载词表来生成单词和长句；请先运行 pnpm words。`,
			);
		}

		for (const entry of unique.values()) {
			const normalized: DictEntry = {
				word: entry.word,
				pinyins: entry.pinyins,
				weight: entry.weight,
			};
			this.entries.push(normalized);
			const first = normalized.pinyins[0];
			const list = this.byFirst.get(first) ?? [];
			list.push(normalized);
			this.byFirst.set(first, list);
		}

		for (const list of this.byFirst.values()) {
			list.sort(
				(a, b) =>
					b.weight - a.weight ||
					b.pinyins.length - a.pinyins.length ||
					a.word.localeCompare(b.word),
			);
		}
		console.log(
			`加载词库 ${this.entries.length} 条（词表 ${wordCount}，字表 ${charCount}）`,
		);
	}

	get size() {
		return this.entries.length;
	}

	/**
	 * 从 start 开始匹配词库里的词。
	 * 当前支持：完整音节匹配、输入模糊音候选、`*` 通配、多音词条目。
	 */
	matchAt(
		input: ZiIndL,
		start: number,
		options: DictMatchOptions = {},
	): DictMatch[] {
		if (start >= input.length) return [];
		const allowWildcard = options.allowWildcard !== false;
		const found = new Map<DictEntry, ZiIndAndKey[]>();

		for (const alternative of input[start]) {
			if (alternative.ind === "*") continue;
			const candidates = this.byFirst.get(alternative.ind);
			if (!candidates) continue;

			for (const entry of candidates) {
				const end = start + entry.pinyins.length;
				if (end > input.length) continue;

				const matched: ZiIndAndKey[] = [];
				let ok = true;
				for (const [offset, pinyin] of entry.pinyins.entries()) {
					const optionsAt = input[start + offset];
					if (!optionsAt) {
						ok = false;
						break;
					}
					const exact = optionsAt.find((item) => item.ind === pinyin);
					const wildcard = allowWildcard
						? optionsAt.find((item) => item.ind === "*")
						: undefined;
					const match = exact ?? wildcard;
					if (!match) {
						ok = false;
						break;
					}
					matched.push(
						match.ind === "*" ? { ...match, ind: pinyin } : match,
					);
				}

				if (ok) {
					found.set(entry, matched);
				}
			}
		}

		return Array.from(found, ([entry, matched]) => ({
			entry,
			end: start + entry.pinyins.length,
			matched,
		}));
	}
}

let defaultDictionary: WordDictionary | undefined;

export function getDefaultDictionary() {
	defaultDictionary ??= new WordDictionary();
	return defaultDictionary;
}

import type { Token } from "node-llama-cpp";
import type { Candidate, Result } from "../../shared/api.ts";
import type { LlmSession } from "../core/session.ts";
import type { ExToken } from "../core/types.ts";
import type { ZiIndAndKey, ZiIndL } from "../key_map/zi_ind.ts";
import {
	type DictEntry,
	getDefaultDictionary,
	type WordDictionary,
} from "./dict/dictionary.ts";
import type { AlgorithmDeps, CandidateAlgorithm } from "./types.ts";

export type DictLlmOptions = {
	/** 词库实例；默认加载 assets/pinyin 下的字表和词表。 */
	dictionary?: WordDictionary;
	/** 最多用几个词拼成一句话。 */
	maxWords?: number;
	/** 每个输入位置最多尝试多少个词。 */
	maxMatchesPerPosition?: number;
	/** 每个中间位置最多保留多少条长句路径。 */
	maxPathsPerPosition?: number;
	/** 长句组合最多生成多少个草稿。 */
	maxSentenceDrafts?: number;
	/** 单词前缀最多生成多少个草稿。 */
	maxSingleDrafts?: number;
	/** 完整 LLM 评估的候选数。 */
	maxEvaluate?: number;
	/** 额外保留的单词/单字安全候选数，保证首选音节有短候选。 */
	maxSafetyCandidates?: number;
	/** 返回给前端的候选数。 */
	maxCandidates?: number;
	/** 每多消费一个音节的加分，0 到 1 的覆盖率按此权重计入。 */
	coverageBonus?: number;
	/** 词库权重先验，越大越偏向高频词。 */
	dictWeight?: number;
	/** 评估 token 时保留的概率分布大小。 */
	topK?: number;
	/** token trie 每个节点最多向下展开几个分支，0 表示不限制。 */
	beamWidth?: number;
	/** 词库只有一条完整路径时直接固定，不调用 LLM。 */
	useDeterministicPath?: boolean;
	allowWildcard?: boolean;
	useSentence?: boolean;
	useSingleWords?: boolean;
};

type Draft = {
	words: DictEntry[];
	matched: ZiIndAndKey[];
	end: number;
	word: string;
	pinyin: string[];
	remainkeys: string[];
	preedit: string;
	consumedkeys: number;
	draftScore: number;
};

type ScoredDraft = {
	draft: Draft;
	tokens: Token[];
	prescore: number;
};

type TokenTrieNode = {
	children: Map<Token, TokenTrieNode>;
	items: ScoredDraft[];
};

const defaultOptions: Required<Omit<DictLlmOptions, "dictionary">> = {
	maxWords: 5,
	maxMatchesPerPosition: 30,
	maxPathsPerPosition: 4096,
	maxSentenceDrafts: 300,
	maxSingleDrafts: 200,
	maxEvaluate: 24,
	maxSafetyCandidates: 32,
	maxCandidates: 100,
	coverageBonus: 2,
	dictWeight: 0.05,
	topK: 200,
	beamWidth: 8,
	useDeterministicPath: true,
	allowWildcard: true,
	useSentence: true,
	useSingleWords: true,
};

/**
 * 词库做 draft，LLM 做评估。
 *
 * 草稿来源：
 * - 单词：词库词从当前输入位置开始匹配；
 * - 长句：多个词首尾拼接，覆盖尽量多的输入；
 * - 单字和生僻字由字表兜底。
 *
 * 词库只有一条完整路径时直接固定，不调用 LLM。
 * 其余候选按 token 建前缀树，共享前缀只评估一次，再用 beam 控制分叉。
 * 另外保留一批单字/单词安全候选，避免长句候选把首音节短候选挤掉。
 * 评估分数是每音节 logprob 加覆盖率和高频词先验。速度不是首要目标。
 */
export class DictLlm implements CandidateAlgorithm {
	readonly id = "dict-llm-v1";
	readonly label = "词库 + LLM 评估";

	private readonly dictionary: WordDictionary;
	private readonly options: Required<Omit<DictLlmOptions, "dictionary">>;
	private readonly tokenCache = new Map<string, Token[]>();
	private baseProbsCache: Map<ExToken, number> | undefined;
	private cacheVersion = -1;

	constructor(options: DictLlmOptions = {}) {
		const { dictionary, ...rest } = options;
		this.dictionary = dictionary ?? getDefaultDictionary();
		this.options = { ...defaultOptions, ...rest };
	}

	onCommit() {
		this.clearCache();
	}

	reset() {
		this.clearCache();
	}

	private clearCache() {
		this.baseProbsCache = undefined;
		this.cacheVersion = -1;
	}

	/** 上下文变了就丢弃缓存；没 commit 的连续按键可以复用。 */
	private ensureCache(session: LlmSession) {
		if (this.cacheVersion === session.version) return;
		this.clearCache();
		this.cacheVersion = session.version;
	}

	async candidates(
		input: ZiIndL,
		{ session }: AlgorithmDeps,
	): Promise<Result> {
		if (input.length === 0 || input[0].length === 0) {
			return { candidates: [] };
		}

		if (this.options.useDeterministicPath) {
			const fixed = this.findDeterministicPath(input);
			if (fixed) {
				return {
					candidates: [
						{
							word: fixed.word,
							pinyin: fixed.pinyin,
							remainkeys: fixed.remainkeys,
							preedit: fixed.preedit,
							consumedkeys: fixed.consumedkeys,
							score: 0,
						},
					],
				};
			}
		}

		const drafts = this.buildDrafts(input);
		if (drafts.length === 0) {
			return { candidates: [] };
		}

		const candidates = await this.evaluate(drafts, input, session);
		return {
			candidates: candidates.slice(0, this.options.maxCandidates),
		};
	}

	private buildDrafts(input: ZiIndL): Draft[] {
		const drafts = new Map<string, Draft>();
		const add = (words: DictEntry[], matched: ZiIndAndKey[], end: number) => {
			const draft = this.makeDraft(words, matched, end, input);
			if (!draft.word) return;
			const key = `${draft.word}\u0000${draft.pinyin.join(" ")}\u0000${draft.remainkeys.join(" ")}`;
			const old = drafts.get(key);
			if (!old || this.isBetterDraft(draft, old)) {
				drafts.set(key, draft);
			}
		};

		// 先找长句，避免被单词草稿占满名额。
		// 用按位置展开的 BFS，而不是深搜，避免某个高频词的分支先把名额用光。
		if (this.options.useSentence && this.options.maxWords > 1) {
			type Path = {
				words: DictEntry[];
				matched: ZiIndAndKey[];
				score: number;
			};
			const matchesCache = new Map<
				number,
				ReturnType<WordDictionary["matchAt"]>
			>();
			const matchesAt = (start: number) => {
				let matches = matchesCache.get(start);
				if (!matches) {
					matches = this.selectMatches(
						this.dictionary.matchAt(input, start, {
							allowWildcard: this.options.allowWildcard,
						}),
						this.options.maxMatchesPerPosition,
					);
					matchesCache.set(start, matches);
				}
				return matches;
			};

			const pathsAt: Path[][] = Array.from(
				{ length: input.length + 1 },
				() => [],
			);
			pathsAt[0].push({ words: [], matched: [], score: 0 });

			let sentenceCount = 0;
			for (let start = 0; start < input.length; start++) {
				const paths = pathsAt[start];
				if (paths.length === 0) continue;
				const matches = matchesAt(start);

				for (const path of paths) {
					if (path.words.length >= this.options.maxWords) continue;
					for (const match of matches) {
						const next: Path = {
							words: [...path.words, match.entry],
							matched: [...path.matched, ...match.matched],
							score: path.score + this.matchScore(match),
						};
						if (match.end === input.length) {
							if (next.words.length >= 2) {
								add(next.words, next.matched, match.end);
								sentenceCount++;
							}
						} else {
							const list = pathsAt[match.end];
							list.push(next);
							if (list.length > this.options.maxPathsPerPosition * 2) {
								list.sort((a, b) => b.score - a.score);
								list.length = this.options.maxPathsPerPosition;
							}
						}
						if (sentenceCount >= this.options.maxSentenceDrafts) break;
					}
					if (sentenceCount >= this.options.maxSentenceDrafts) break;
				}
				if (sentenceCount >= this.options.maxSentenceDrafts) break;
			}
		}

		// 单词前缀：消费输入的一部分，remainkeys 交给前端继续输入。
		if (this.options.useSingleWords) {
			const matches = this.selectMatches(
				this.dictionary.matchAt(input, 0, {
					allowWildcard: this.options.allowWildcard,
				}),
				this.options.maxSingleDrafts,
			);
			for (const match of matches) {
				add([match.entry], match.matched, match.end);
			}
		}

		return Array.from(drafts.values());
	}

	/**
	 * 词库只有一条完整路径时直接固定。
	 * 这里只数词级分词，不展开拼音音节分词。
	 */
	private findDeterministicPath(input: ZiIndL): Draft | undefined {
		const matchesCache = new Map<
			number,
			ReturnType<WordDictionary["matchAt"]>
		>();
		const matchesAt = (start: number) => {
			let matches = matchesCache.get(start);
			if (!matches) {
				matches = this.dictionary.matchAt(input, start, {
					allowWildcard: this.options.allowWildcard,
				});
				matchesCache.set(start, matches);
			}
			return matches;
		};

		// 从后往前数路径，只需要知道是 0、1 还是“多条”。
		const counts = new Array<number>(input.length + 1).fill(0);
		counts[input.length] = 1;
		for (let start = input.length - 1; start >= 0; start--) {
			let count = 0;
			for (const match of matchesAt(start)) {
				const next = counts[match.end] ?? 0;
				if (next === 0) continue;
				count += next;
				if (count >= 2) {
					count = 2;
					break;
				}
			}
			counts[start] = count;
		}

		if (counts[0] !== 1) return;

		const words: DictEntry[] = [];
		const matched: ZiIndAndKey[] = [];
		let start = 0;
		while (start < input.length) {
			const match = matchesAt(start).find(
				(item) => counts[item.end] > 0,
			);
			if (!match) return;
			words.push(match.entry);
			matched.push(...match.matched);
			start = match.end;
		}
		return this.makeDraft(words, matched, input.length, input);
	}

	private matchScore(match: { entry: DictEntry; end: number }) {
		// 长词优先，避免长句搜索被大量单字候选挤掉。
		return (
			match.entry.pinyins.length * 8 +
			Math.log1p(match.entry.weight) +
			match.end * 0.1
		);
	}

	/**
	 * 按音节数分层取词，避免某个长度的高频词把其他长度全部挤掉。
	 */
	private selectMatches<T extends { entry: DictEntry; end: number }>(
		matches: T[],
		max: number,
	) {
		const byLength = new Map<number, T[]>();
		for (const match of matches) {
			const length = match.entry.pinyins.length;
			const list = byLength.get(length) ?? [];
			list.push(match);
			byLength.set(length, list);
		}
		const perLength = Math.max(1, Math.floor(max / Math.max(1, byLength.size)));
		const selected: T[] = [];
		for (const [, list] of Array.from(byLength).sort(
			(a, b) => b[0] - a[0],
		)) {
			list.sort((a, b) => this.matchScore(b) - this.matchScore(a));
			selected.push(...list.slice(0, perLength));
		}
		selected.sort((a, b) => this.matchScore(b) - this.matchScore(a));
		return selected.slice(0, max);
	}

	/** 同一个词优先保留词库里的整词，而不是拆成多个单字。 */
	private isBetterDraft(a: Draft, b: Draft) {
		if (a.words.length !== b.words.length) {
			return a.words.length < b.words.length;
		}
		const aMax = Math.max(...a.words.map((word) => word.word.length));
		const bMax = Math.max(...b.words.map((word) => word.word.length));
		if (aMax !== bMax) return aMax > bMax;
		return a.draftScore > b.draftScore;
	}

	private makeDraft(
		words: DictEntry[],
		matched: ZiIndAndKey[],
		end: number,
		input: ZiIndL,
	): Draft {
		const remain = input.slice(end);
		const remainkeys = remain.map((item) => item[0].ind);
		const preedit =
			matched.map((item) => item.preeditShow).join(" ") +
			(remain.length ? " " : "");
		const weight =
			words.reduce((sum, word) => sum + Math.log1p(word.weight), 0) /
			Math.max(1, words.length);
		const coverage = end / Math.max(1, input.length);
		const wordLengthBonus = words.reduce(
			(sum, word) => sum + (word.word.length > 1 ? 1.5 : 0),
			0,
		);
		return {
			words,
			matched,
			end,
			word: words.map((word) => word.word).join(""),
			pinyin: matched.map((item) => item.ind),
			remainkeys,
			preedit,
			consumedkeys: matched.reduce((sum, item) => sum + item.key.length, 0),
			draftScore:
				weight +
				coverage * 8 +
				wordLengthBonus -
				Math.max(0, words.length - 1) * 0.5,
		};
	}

	/**
	 * 按切分粒度分组选候选，保证单词、2 词长句、3 词长句都有机会被 LLM 评估。
	 */
	private selectForEvaluation(scored: ScoredDraft[]) {
		const groups = new Map<number, ScoredDraft[]>();
		for (const item of scored) {
			const count = item.draft.words.length;
			const list = groups.get(count) ?? [];
			list.push(item);
			groups.set(count, list);
		}
		for (const list of groups.values()) {
			list.sort((a, b) => b.prescore - a.prescore);
		}

		const perGroup = Math.max(
			1,
			Math.floor(this.options.maxEvaluate / Math.max(1, groups.size)),
		);
		const selected: ScoredDraft[] = [];
		for (const list of groups.values()) {
			selected.push(...list.slice(0, perGroup));
		}

		if (selected.length < this.options.maxEvaluate) {
			const selectedSet = new Set(selected);
			for (const item of [...scored].sort((a, b) => b.prescore - a.prescore)) {
				if (selectedSet.has(item)) continue;
				selected.push(item);
				if (selected.length >= this.options.maxEvaluate) break;
			}
		}

		return selected
			.sort((a, b) => b.prescore - a.prescore)
			.slice(0, this.options.maxEvaluate);
	}

	private tokensOf(word: string, session: LlmSession) {
		let tokens = this.tokenCache.get(word);
		if (!tokens) {
			tokens = session.model.tokenizer(word);
			this.tokenCache.set(word, tokens);
		}
		return tokens;
	}

	/**
	 * 把候选 token 序列建成前缀树，共享前缀只评估一次。
	 * 完整候选即使落在被 beam 剪掉的分支上，也已经用父节点的概率打过分。
	 */
	private async scoreDrafts(
		scored: ScoredDraft[],
		baseProbs: Map<ExToken, number>,
		session: LlmSession,
	) {
		const root: TokenTrieNode = { children: new Map(), items: [] };
		for (const item of scored) {
			let node = root;
			for (const token of item.tokens) {
				let child = node.children.get(token);
				if (!child) {
					child = { children: new Map(), items: [] };
					node.children.set(token, child);
				}
				node = child;
			}
			node.items.push(item);
		}

		const scores = new Map<ScoredDraft, number>();
		const base = session.committedLength;

		const visit = async (
			node: TokenTrieNode,
			probabilities: Map<ExToken, number>,
			logprob: number,
			depth: number,
		) => {
			const entries = Array.from(node.children, ([token, child]) => ({
				token,
				child,
				probability: probabilities.get(token) ?? 0,
			})).sort((a, b) => b.probability - a.probability);

			const expandCount =
				this.options.beamWidth > 0
					? Math.min(this.options.beamWidth, entries.length)
					: entries.length;

			for (const [index, entry] of entries.entries()) {
				const childLogprob =
					logprob + Math.log(entry.probability + 1e-12);
				for (const item of entry.child.items) {
					scores.set(item, childLogprob);
				}

				if (index >= expandCount) continue;
				if (entry.child.children.size === 0) continue;

				const restoreLength = base + depth;
				if (session.contextTokens.length > restoreLength) {
					await session.sequence.eraseContextTokenRanges([
						{
							start: restoreLength,
							end: session.contextTokens.length,
						},
					]);
				}
				const childProbabilities = await session.evaluateNext(
					[entry.token],
					{ topK: this.options.topK },
				);
				await visit(
					entry.child,
					childProbabilities,
					childLogprob,
					depth + 1,
				);
				if (session.contextTokens.length > restoreLength) {
					await session.sequence.eraseContextTokenRanges([
						{
							start: restoreLength,
							end: session.contextTokens.length,
						},
					]);
				}
			}
		};

		try {
			await visit(root, baseProbs, 0, 0);
		} finally {
			if (session.contextTokens.length > base) {
				await session.sequence.eraseContextTokenRanges([
					{
						start: base,
						end: session.contextTokens.length,
					},
				]);
			}
		}
		return scores;
	}

	private async evaluate(
		drafts: Draft[],
		input: ZiIndL,
		session: LlmSession,
	): Promise<Candidate[]> {
		if (!session.lastResult) return [];

		await session.awaitReady();

		return await session.exclusive(async () => {
			const base = session.committedLength;
			if (session.contextTokens.length > base) {
				await session.sequence.eraseContextTokenRanges([
					{
						start: base,
						end: session.contextTokens.length,
					},
				]);
			}

			this.ensureCache(session);
			const baseProbs =
				this.baseProbsCache ??
				(await session.recomputeNextProbabilities(this.options.topK));
			this.baseProbsCache = baseProbs;
			const allScored: ScoredDraft[] = drafts.map((draft) => {
				const tokens = this.tokensOf(draft.word, session);
				return {
					draft,
					tokens,
					prescore: this.prescore(draft, tokens, baseProbs, input),
				};
			});
			const selected = this.selectForEvaluation(allScored);
			// 安全候选：单词/单字单独保留一批，避免长句候选把首音节短候选挤掉。
			const safety = allScored
				.filter((item) => item.draft.words.length === 1)
				.sort((a, b) => b.prescore - a.prescore)
				.slice(0, this.options.maxSafetyCandidates);
			const seen = new Set<ScoredDraft>();
			const scored: ScoredDraft[] = [];
			for (const item of [...selected, ...safety]) {
				if (seen.has(item)) continue;
				seen.add(item);
				scored.push(item);
			}
			const scores = await this.scoreDrafts(scored, baseProbs, session);

			const results: Candidate[] = [];
			try {
				for (const item of scored) {
					if (item.tokens.length === 0) continue;

					const logprob = scores.get(item) ?? -Infinity;

					const coverage = item.draft.end / Math.max(1, input.length);
					const dictPrior =
						this.options.dictWeight *
						(item.draft.words.reduce(
							(sum, word) => sum + Math.log1p(word.weight),
							0,
						) /
							Math.max(1, item.draft.words.length));

					results.push({
						word: item.draft.word,
						pinyin: item.draft.pinyin,
						remainkeys: item.draft.remainkeys,
						preedit: item.draft.preedit,
						consumedkeys: item.draft.consumedkeys,
						score:
							logprob / Math.max(1, item.draft.end) +
							this.options.coverageBonus * coverage +
							dictPrior,
					});
				}
			} finally {
				if (session.contextTokens.length > base) {
					await session.sequence.eraseContextTokenRanges([
						{
							start: base,
							end: session.contextTokens.length,
						},
					]);
				}
				session.resetIdleOmit();
			}

			return results.sort((a, b) => b.score - a.score);
		});
	}

	private prescore(
		draft: Draft,
		tokens: Token[],
		baseProbs: Map<ExToken, number>,
		input: ZiIndL,
	) {
		const first = tokens[0];
		const firstProbability = first === undefined ? 0 : (baseProbs.get(first) ?? 0);
		const coverage = draft.end / Math.max(1, input.length);
		const dictPrior =
			this.options.dictWeight *
			(draft.words.reduce((sum, word) => sum + Math.log1p(word.weight), 0) /
				Math.max(1, draft.words.length));
		return (
			draft.draftScore +
			coverage * this.options.coverageBonus +
			dictPrior +
			0.05 * Math.log(firstProbability + 1e-12)
		);
	}
}

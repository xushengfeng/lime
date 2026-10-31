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
	/** 算法 id，快速/质量预设可以用不同值。 */
	id?: string;
	label?: string;
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
	/** 最终结果里最多保留几个多词长句候选，其余长句移到后面。 */
	maxLongCandidates?: number;
	/** 完整覆盖输入的候选与第一名分数差在此范围内时，提到第一。 */
	coverageFirstWithin?: number;
	/** 每个剩余音节扣多少分；越大越偏向一次提交更多内容。 */
	selectionPenalty?: number;
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
	/** 每次 candidates 最多做多少次 token 评估，0 表示不做深度评估。 */
	maxEvalTokens?: number;
	/** 单次最多处理多少个拼音音节，超过部分作为 remainkeys 留给下一轮。 */
	maxInputSyllables?: number;
	/** 直接复用 commit 留下的 next 分布，避免首键再额外评估一次。 */
	useCommitDistribution?: boolean;
	/** 词库只有一条完整路径时直接固定，不调用 LLM。 */
	useDeterministicPath?: boolean;
	/** 超过这么多音节就不再检查唯一路径，避免长句每键都做完整 DP。 */
	deterministicMaxSyllables?: number;
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
	maxPrescore: number;
};

type EvaluatedCandidate = {
	candidate: Candidate;
	long: boolean;
	full: boolean;
};

const defaultOptions: Required<
	Omit<DictLlmOptions, "dictionary" | "id" | "label">
> = {
	maxWords: 4,
	maxMatchesPerPosition: 20,
	maxPathsPerPosition: 1024,
	maxSentenceDrafts: 128,
	maxSingleDrafts: 100,
	maxEvaluate: 16,
	maxSafetyCandidates: 32,
	maxLongCandidates: 1,
	coverageFirstWithin: 0.5,
	selectionPenalty: 0.8,
	maxCandidates: 100,
	coverageBonus: 2,
	dictWeight: 0.05,
	topK: 50,
	beamWidth: 8,
	maxEvalTokens: 0,
	maxInputSyllables: 7,
	useCommitDistribution: true,
	useDeterministicPath: true,
	deterministicMaxSyllables: 5,
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
 * 默认快速模式限制音节窗口和每键评估预算；把 maxEvalTokens 设为 Infinity 可切回完整评估。
 * 评估分数是每音节 logprob 加覆盖率和高频词先验。
 */
export class DictLlm implements CandidateAlgorithm {
	readonly id: string;
	readonly label: string;

	private readonly dictionary: WordDictionary;
	private readonly options: Required<
		Omit<DictLlmOptions, "dictionary" | "id" | "label">
	>;
	private readonly tokenCache = new Map<string, Token[]>();
	private readonly scoreCache = new Map<string, number>();
	private baseProbsCache: Map<ExToken, number> | undefined;
	private cacheVersion = -1;

	private static readonly MAX_SCORE_CACHE = 4096;

	constructor(options: DictLlmOptions = {}) {
		const { dictionary, id, label, ...rest } = options;
		this.id = id ?? "dict-llm-v1";
		this.label = label ?? "词库 + LLM 评估";
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
		this.scoreCache.clear();
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

		const workInput =
			input.length > this.options.maxInputSyllables
				? input.slice(0, this.options.maxInputSyllables)
				: input;
		const extraInput = input.slice(workInput.length);

		if (
			this.options.useDeterministicPath &&
			workInput.length <= this.options.deterministicMaxSyllables
		) {
			const fixed = this.findDeterministicPath(workInput);
			if (fixed) {
				return {
					candidates: this.extendRemain(
						[
							{
								word: fixed.word,
								pinyin: fixed.pinyin,
								remainkeys: fixed.remainkeys,
								preedit: fixed.preedit,
								consumedkeys: fixed.consumedkeys,
								score: 0,
							},
						],
						extraInput,
					),
				};
			}
		}

		const drafts = this.buildDrafts(workInput);
		if (drafts.length === 0) {
			return { candidates: [] };
		}

		const candidates = await this.evaluate(drafts, workInput, session);
		return {
			candidates: this.extendRemain(candidates, extraInput).slice(
				0,
				this.options.maxCandidates,
			),
		};
	}

	private extendRemain(candidates: Candidate[], extra: ZiIndL) {
		if (extra.length === 0) return candidates;
		const extraPinyin = extra.map((item) => item[0].ind);
		return candidates.map((candidate) => ({
			...candidate,
			remainkeys: [...candidate.remainkeys, ...extraPinyin],
			preedit: candidate.preedit.endsWith(" ")
				? candidate.preedit
				: `${candidate.preedit} `,
		}));
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
		const scores = new Map<ScoredDraft, number>();
		const uncached: ScoredDraft[] = [];
		for (const item of scored) {
			const key = item.tokens.join(",");
			const cached = this.scoreCache.get(key);
			if (cached === undefined) {
				uncached.push(item);
			} else {
				scores.set(item, cached);
			}
		}
		if (uncached.length === 0) return scores;

		const root: TokenTrieNode = {
			children: new Map(),
			items: [],
			maxPrescore: -Infinity,
		};
		for (const item of uncached) {
			let node = root;
			node.maxPrescore = Math.max(node.maxPrescore, item.prescore);
			for (const token of item.tokens) {
				let child = node.children.get(token);
				if (!child) {
					child = {
						children: new Map(),
						items: [],
						maxPrescore: -Infinity,
					};
					node.children.set(token, child);
				}
				node = child;
				node.maxPrescore = Math.max(node.maxPrescore, item.prescore);
			}
			node.items.push(item);
		}

		const base = session.committedLength;
		let evalTokens = 0;
		const limited =
			this.options.maxEvalTokens !== Infinity && this.options.maxEvalTokens >= 0;

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
			})).sort((a, b) =>
				limited && this.options.maxEvalTokens !== 0
					? b.child.maxPrescore - a.child.maxPrescore
					: b.probability - a.probability,
			);

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
				if (limited && evalTokens >= this.options.maxEvalTokens) continue;

				const restoreLength = base + depth;
				if (session.contextTokens.length > restoreLength) {
					await session.sequence.eraseContextTokenRanges([
						{
							start: restoreLength,
							end: session.contextTokens.length,
						},
					]);
				}
				evalTokens++;
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

		if (
			this.scoreCache.size + scores.size >
			DictLlm.MAX_SCORE_CACHE
		) {
			this.scoreCache.clear();
		}
		for (const [item, score] of scores) {
			if (item.tokens.length > 0) {
				this.scoreCache.set(item.tokens.join(","), score);
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
				(this.options.useCommitDistribution && session.lastResult
					? session.lastResult
					: await session.recomputeNextProbabilities(this.options.topK));
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
				.filter((item) => item.draft.end === 1)
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

			const results: EvaluatedCandidate[] = [];
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
						long: item.draft.words.length > 1,
						full: item.draft.end === input.length,
						candidate: {
							word: item.draft.word,
							pinyin: item.draft.pinyin,
							remainkeys: item.draft.remainkeys,
							preedit: item.draft.preedit,
							consumedkeys: item.draft.consumedkeys,
							score:
								logprob / Math.max(1, item.draft.end) +
								this.options.coverageBonus * coverage +
								dictPrior -
								this.options.selectionPenalty *
									item.draft.remainkeys.length,
						},
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

			return this.applyLongPolicy(results);
		});
	}

	/**
	 * 只让少量长句候选留在前面，其余长句移到词语候选之后。
	 * 避免一个错误长句把 Top5 全部占满。
	 */
	private applyLongPolicy(items: EvaluatedCandidate[]) {
		const sorted = [...items].sort(
			(a, b) => b.candidate.score - a.candidate.score,
		);

		// 完整覆盖的候选只差一点时，优先让它出现在第一。
		const best = sorted[0]?.candidate.score ?? -Infinity;
		const fullIndex = sorted.findIndex(
			(item) =>
				item.full &&
				item.candidate.score >=
					best - this.options.coverageFirstWithin,
		);
		if (fullIndex > 0) {
			const [full] = sorted.splice(fullIndex, 1);
			sorted.unshift(full);
		}

		const keep: EvaluatedCandidate[] = [];
		const restLong: EvaluatedCandidate[] = [];
		let longCount = 0;
		for (const item of sorted) {
			if (!item.long) {
				keep.push(item);
				continue;
			}
			if (longCount < this.options.maxLongCandidates) {
				longCount++;
				keep.push(item);
			} else {
				restLong.push(item);
			}
		}
		return [...keep, ...restLong].map((item) => item.candidate);
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
			dictPrior -
			this.options.selectionPenalty * draft.remainkeys.length +
			0.05 * Math.log(firstProbability + 1e-12)
		);
	}
}

/** 完整长句评估预设：慢，但保留整句后缀信息。 */
export function createQualityDictLlm(options: DictLlmOptions = {}) {
	return new DictLlm({
		id: "dict-llm-v1-quality",
		label: "词库 + LLM 评估（质量）",
		maxEvalTokens: Infinity,
		maxInputSyllables: Infinity,
		useCommitDistribution: false,
		topK: 200,
		maxWords: 5,
		maxMatchesPerPosition: 30,
		maxPathsPerPosition: 4096,
		maxSentenceDrafts: 300,
		maxSingleDrafts: 200,
		maxEvaluate: 24,
		maxSafetyCandidates: 32,
		deterministicMaxSyllables: 8,
		...options,
	});
}

/** 质量模式的受限 N-best 版本：保留长句评估，但固定候选数和 token 预算。 */
export function createOptimizedDictLlm(options: DictLlmOptions = {}) {
	return createQualityDictLlm({
		id: "dict-llm-v1-quality-opt",
		label: "词库 + LLM 评估（质量优化）",
		maxEvaluate: 4,
		maxSafetyCandidates: 32,
		maxEvalTokens: 48,
		beamWidth: 8,
		...options,
	});
}

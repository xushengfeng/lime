import type { Candidate, Result } from "../../shared/api.ts";
import type { LlmSession } from "../core/session.ts";
import type { ExToken } from "../core/types.ts";
import type { ZiIndAndKey, ZiIndL } from "../key_map/zi_ind.ts";
import { ziid_in_ziid } from "../ziind_in_ziind.ts";
import type { AlgorithmDeps, CandidateAlgorithm } from "./types.ts";

type LongSentenceCacheItem = {
	py: ZiIndL;
	matchPY: ZiIndAndKey[];
	token: ExToken[];
	nextResult: Map<ExToken, number>;
};

/**
 * 当前版本：从模型下一步概率中按拼音筛选，长词优先，并对首个候选做最多
 * 4 个 token 的长句补全。
 */
export class LimeV1 implements CandidateAlgorithm {
	readonly id = "lime-v1";
	readonly label = "LIME（模型）";

	/** 长句补全，记录拼音和 token 对。 */
	private longSentenceCache: LongSentenceCacheItem[] = [];

	onCommit() {
		this.longSentenceCache = [];
	}

	reset() {
		this.longSentenceCache = [];
	}

	async candidates(
		pinyin_input: ZiIndL,
		{ session, index }: AlgorithmDeps,
	): Promise<Result> {
		if (pinyin_input.length === 0 || pinyin_input[0].length === 0) {
			return { candidates: [] };
		}

		if (!session.lastResult) {
			return { candidates: [] };
		}

		const c: Candidate[] = [];

		await session.awaitReady();
		await session.fastTryOmitContext(pinyin_input.length);

		const filterByPinyin = (
			pinyin_input: ZiIndL,
			last_result: Map<ExToken, number>,
		) => {
			const new_last_result = new Map<
				ExToken,
				{ py: ZiIndAndKey[]; prob: number; token: string }
			>();
			let scoreSum = 0;
			const ftokenid = new Set<number>();
			for (const firstPinyin of pinyin_input[0]) {
				for (const tokenid of index.firstTokens(firstPinyin.ind)) {
					ftokenid.add(tokenid);
				}
			}

			for (const [token_id, token_prob] of last_result) {
				if (!ftokenid.has(token_id)) continue;
				const token = session.detoken([token_id]);
				if (!token) continue;
				if (["\t", "\n", " "].includes(token[0])) continue;

				const token_pinyin_dy = index.pinyinOf(token_id);

				if (!token_pinyin_dy) continue;

				const token_pinyin = ziid_in_ziid(pinyin_input, token_pinyin_dy);
				if (!token_pinyin) continue;
				if (token === token_pinyin[0].ind) continue; // 排除部分英文
				new_last_result.set(token_id, {
					py: token_pinyin,
					prob: token_prob,
					token: session.detoken([token_id]),
				});
				scoreSum += token_prob;
			}
			for (const v of new_last_result.values()) {
				v.prob /= scoreSum;
			}

			// 长词优先
			const first = new_last_result.values().next().value;
			if ((first?.prob ?? 0) < 0.9) {
				const n = new Map() as typeof new_last_result;

				let maxLen = 0;
				let longToken: typeof first;
				let longTokenId: ExToken | undefined;
				for (const [k, v] of new_last_result) {
					if (v.py.length > maxLen) {
						maxLen = v.py.length;
						longToken = v;
						longTokenId = k;
					}
				}
				let reOrder = false;
				if (maxLen > 1 && longToken && longTokenId) {
					n.set(longTokenId, longToken);
					reOrder = true;
				}
				for (const [k, v] of new_last_result) {
					if (reOrder === false || k !== longTokenId) {
						n.set(k, v);
					}
				}
				return n;
			}

			return new_last_result;
		};
		const new_last_result = filterByPinyin(pinyin_input, session.lastResult);

		// 首个候选补全为长句
		await (async () => {
			const token_id = new_last_result.keys().next().value;
			if (!token_id) return;
			const _r = new_last_result.get(token_id);
			if (!_r) return;
			const { py: token_pinyin, prob: token_prob } = _r;

			if (pinyin_input.length === token_pinyin.length) {
				this.longSentenceCache = [];
				return;
			}

			let sameCacheLen = 0;
			let pyIndex = 0;

			for (const [i, cache] of this.longSentenceCache.entries()) {
				const cpyl = cache.py;
				const inputPyl = pinyin_input.slice(pyIndex, pyIndex + cpyl.length);
				if (JSON.stringify(cpyl) !== JSON.stringify(inputPyl)) {
					break;
				}
				sameCacheLen = i + 1;
				pyIndex += cpyl.length;
			}
			let sameCache = this.longSentenceCache.slice(0, sameCacheLen);
			let rmpyx = pinyin_input.slice(
				sameCache.flatMap((i) => i.matchPY).length,
			);
			{
				const lc = this.longSentenceCache.slice(0, sameCacheLen);
				const last = lc.at(-1);
				if (last) {
					const npy = last.py.concat(rmpyx);
					const lastlast = lc.at(-2)?.nextResult || session.lastResult;
					if (lastlast) {
						const f = filterByPinyin(npy, lastlast);
						const first = f.entries().next().value;
						if (first) {
							if (first[0] !== last.token.at(-1)) {
								sameCacheLen--;
								sameCache = this.longSentenceCache.slice(0, sameCacheLen);
								rmpyx = pinyin_input.slice(
									sameCache.flatMap((i) => i.matchPY).length,
								);
							}
						}
					} else {
						console.warn("no lastlast");
					}
				}
			}

			const cacheTokens = sameCache.flatMap((i) => i.token);
			// todo 下面的判断需要展开
			if (
				session.sequence.contextTokens
					.slice(
						session.committedLength,
						session.committedLength + cacheTokens.length,
					)
					.join(",") !== cacheTokens.join(",")
			) {
				console.error("长句缓存不匹配");
			}
			await session.sequence.eraseContextTokenRanges([
				{
					start: session.committedLength + cacheTokens.length,
					end: session.sequence.contextTokens.length,
				},
			]);
			if (
				cacheTokens.at(-1) &&
				cacheTokens.at(-1) !== session.sequence.contextTokens.at(-1)
			) {
				console.error("erase error");
			}

			this.longSentenceCache = this.longSentenceCache.slice(0, sameCacheLen);

			let prob = token_prob;
			const tklppy: ZiIndAndKey[] = [...sameCache.flatMap((i) => i.matchPY)];
			const tkl: ExToken[] = [...cacheTokens];

			const select = (op: {
				py: ZiIndL;
				matchPY: ZiIndAndKey[];
				token: ExToken[];
				nextResult: Map<ExToken, number>;
			}) => {
				tklppy.push(...op.matchPY);
				tkl.push(...op.token);
				rmpyx = pinyin_input.slice(tklppy.length);

				this.longSentenceCache.push({
					py: op.py,
					matchPY: op.matchPY,
					token: op.token,
					nextResult: op.nextResult,
				});
			};

			const addToken = async (token: ExToken) => {
				return await session.evaluateNext([token]);
			};

			if (this.longSentenceCache.length === 0)
				select({
					token: [token_id],
					matchPY: token_pinyin,
					py: pinyin_input.slice(0, token_pinyin.length),
					nextResult: await addToken(token_id),
				});

			const l = rmpyx.length;

			await session.fastTryOmitContext(l);

			for (let _i = 0; _i < Math.min(l, 4); _i++) {
				const next = this.longSentenceCache.at(-1)?.nextResult;
				if (!next) {
					console.log("no next");
					break;
				}
				const f = filterByPinyin(rmpyx, next);
				if (f.size > 0) {
					const first = f.entries().next().value;
					if (first) {
						prob *= first[1].prob;
						const tp = first[1];
						select({
							token: [first[0]],
							matchPY: tp.py,
							py: pinyin_input.slice(
								tklppy.length,
								tklppy.length + tp.py.length,
							),
							nextResult: await addToken(first[0]),
						});
						if (rmpyx.length === 0) {
							break;
						}
					}
				}
			}

			if (tkl.length > 1) {
				c.push({
					pinyin: tklppy.map((v) => v.ind),
					score: prob,
					word: session.detoken(tkl),
					remainkeys: rmpyx.map((v) => v[0].ind),
					preedit:
						tklppy.map((v) => v.preeditShow).join(" ") +
						(rmpyx.length ? " " : ""),
					consumedkeys: tklppy.map((v) => v.key).join("").length,
				});
			}
		})();

		// 常规
		for (const [
			_,
			{ py: token_pinyin, prob: token_prob, token },
		] of new_last_result) {
			const rmpy = pinyin_input.slice(token_pinyin.length).map((v) => v[0].ind);
			c.push({
				pinyin: token_pinyin.map((v) => v.ind),
				score: token_prob,
				word: token,
				remainkeys: rmpy,
				preedit:
					token_pinyin.map((v) => v.preeditShow).join(" ") +
					(rmpy.length ? " " : ""),
				consumedkeys: token_pinyin.map((v) => v.key).join("").length,
			});
		}

		for (const py of pinyin_input[0]) {
			const unIndexSet = index.unindexed(py.ind);
			if (unIndexSet) {
				for (const zi of unIndexSet) {
					c.push({
						pinyin: [py.ind],
						score: 0.0001,
						word: zi,
						remainkeys: pinyin_input.slice(1).map((v) => v[0].ind),
						preedit: py.preeditShow + (pinyin_input.length > 1 ? " " : ""),
						consumedkeys: py.key.length,
					});
				}
			}
		}

		c.sort((a, b) => b.pinyin.length - a.pinyin.length);

		session.resetIdleOmit();

		if (c.length === 0) {
			console.log("is empty");
		}
		return { candidates: c };
	}
}

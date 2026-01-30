import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	getLlama,
	type LlamaContext,
	type LlamaContextSequence,
	type LlamaModel,
	type Token,
} from "node-llama-cpp";
import type { ZiIndAndKey, ZiIndL } from "./key_map/zi_ind.ts";
import { ziid_in_ziid } from "./utils/ziind_in_ziind.ts";

type ZiIndFunc = (zici: string) => string[][];

type Candidate = {
	word: string;
	score: number;
	pinyin: string[];
	remainkeys: string[];
	preedit: string;
	consumedkeys: number;
};

export type Result = {
	candidates: Candidate[];
};

type UserData = {
	words: Record<number, Array<Array<number>>>;
	context: Array<string>;
};

type ThinkOption = {
	userWord: boolean;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class Lock {
	private pm: Promise<void> | null = null;

	async acquire() {
		if (this.pm) await this.pm;
	}

	async lock() {
		await this.acquire();
		const p = Promise.withResolvers<void>();
		this.pm = p.promise;

		return {
			release: () => {
				p.resolve();
			},
		};
	}
}

export async function loadModel(op?: {
	modelPath?: string;
	contextSize?: number;
}) {
	const modelPath =
		op?.modelPath ??
		path.join(__dirname, "../Qwen3-0.6B-GGUF/Qwen3-0.6B-IQ4_XS.gguf");

	const llama = await getLlama({
		gpu: false,
	});

	console.log("加载模型", modelPath);

	const model = await llama.loadModel({
		modelPath: modelPath,
	});
	const context = await model.createContext({
		contextSize: { max: op?.contextSize ?? 4096 },
	});
	console.log("加载完成");

	return { model, context };
}

export async function initLIME(
	op: Parameters<typeof loadModel>[0] & {
		ziInd: { trans: ZiIndFunc; allSymbol: Set<string> };
	},
) {
	const { model, context } = await loadModel(op);
	const lime = new LIME({ model, context, ziInd: op.ziInd });
	await lime.init_ctx();
	return lime;
}

export class LIME {
	model: LlamaModel;
	context: LlamaContext;
	sequence: LlamaContextSequence;

	token_pinyin_map: Map<number, Array<Array<string>>> = new Map();
	first_pinyin_token = new Map<string, Set<number>>();
	unIndexedZi = new Map<string, Set<string>>();

	pre_context = "下面的内容主题多样";
	user_context: string[] = [];
	last_context_data = { context: "" };
	y用户词 = new Map<number, Array<Array<number>>>();

	private last_result: Map<Token, number> | undefined;
	/** 长句补全，记录拼音和token对 */
	private longSentenceCache: {
		py: ZiIndL;
		matchPY: ZiIndAndKey[];
		token: Token[];
		nextResult: Map<Token, number>;
	}[] = [];
	private lastCommitOffset = 0;

	private modelEvalLock = new Lock();

	private max_count = 4000;
	private rm_count = 20;
	private omitContext = new deBounce(1000 * 10, async () => {
		await this.modelEvalLock.acquire();
		const { release } = await this.modelEvalLock.lock();
		await this.tryOmitContext();
		release();
	});

	constructor({
		model,
		context,
		ziInd,
	}: {
		model: LlamaModel;
		context: LlamaContext;
		ziInd: { trans: ZiIndFunc; allSymbol: Set<string> };
	}) {
		this.model = model;
		this.context = context;
		this.sequence = context.getSequence();

		this.max_count = context.contextSize - 64;
		this.rm_count = Math.min(
			this.max_count,
			64,
			Math.floor(this.max_count * 0.2),
		);

		console.log("创建拼音索引");

		const { trans, allSymbol } = ziInd;

		// todo 先解码字，再遍历所有token建立索引
		for (const token_id of model.iterateAllTokens()) {
			const token = model.detokenize([token_id]);
			if (!token) continue;
			const pinyins = trans(token);
			allSymbol.delete(token);
			if (pinyins.length) {
				this.token_pinyin_map.set(token_id, pinyins);
				for (const fp of pinyins[0]) {
					const s = this.first_pinyin_token.get(fp) ?? new Set();
					s.add(token_id);
					this.first_pinyin_token.set(fp, s);
				}
			}
		}
		for (const zi of allSymbol) {
			const pys = trans(zi);
			if (pys.length === 1) {
				for (const py of pys[0]) {
					const s = this.unIndexedZi.get(py) ?? new Set();
					s.add(zi);
					this.unIndexedZi.set(py, s);
				}
			}
		}
		if (allSymbol.size > 0) {
			console.log(
				"以下字未直接建立拼音索引:",
				Array.from(allSymbol).slice(0, 10).join(" "),
				"等",
			);
		}
	}

	private tryOmitContext = async (buffer = 64) => {
		const maxCount = this.max_count - Math.max(buffer, 64);

		if (this.sequence.contextTokens.length <= maxCount) {
			return;
		}
		const oldTokenLen = this.sequence.contextTokens.length;

		// 输入分词可能有些情况不是像分词器那样的切分，会影响模型性能，这里重编码分词
		const oldTokens = this.sequence.contextTokens.slice();
		const oldText = this.model.detokenize(oldTokens);
		const newTokens = this.model
			.tokenizer(oldText)
			.slice(-Math.max(maxCount - this.rm_count, 1));

		await this.sequence.clearHistory();
		await this.sequence.controlledEvaluate([
			...newTokens.slice(0, -1),
			[
				// biome-ignore lint/style/noNonNullAssertion: none
				newTokens.at(-1)!,
				{
					generateNext: {
						probabilities: true,
						options: {
							topK: Infinity,
						},
					},
				},
			],
		]);
		this.lastCommitOffset = this.sequence.contextTokens.length;
		console.log(
			`已优化上下文 ${oldTokenLen}->${this.sequence.contextTokens.length}`,
		);
	};

	commit = async (text: string, update = false, newT = true) => {
		let new_text = "";
		let nt = newT;

		this.longSentenceCache = [];

		if (update) {
			if (text.startsWith(this.last_context_data.context)) {
				new_text = text.slice(this.last_context_data.context.length);
				this.last_context_data.context = text;
			} else {
				new_text = text;
				nt = true;
			}
		}
		if (nt) {
			this.last_context_data.context = "";
			if (update === false) {
				new_text = text;
			}
		}
		if (!new_text) return;

		if (newT) this.add_user_word(text);

		this.user_context.push(new_text);

		// todo shift context

		const to_run = this.model.tokenizer(new_text);
		if (to_run.length === 0) return;

		const pre = to_run.slice(0, -1);
		const last = to_run[to_run.length - 1];
		const { release } = await this.modelEvalLock.lock();
		// 强制commit耗时的部分为异步执行，避免请求阻塞
		(async () => {
			await this.tryOmitContext(pre.length + 1);
			// todo 根据缓存判断，比如长句实际上已经近似提交了
			await this.sequence.eraseContextTokenRanges([
				{
					start: this.lastCommitOffset,
					end: this.sequence.contextTokens.length,
				},
			]);
			const res = await this.sequence.controlledEvaluate([
				...pre,
				[
					last,
					{
						generateNext: {
							probabilities: true,
						},
					},
				],
			]);
			this.last_result = res.at(-1)?.next.probabilities;
			this.lastCommitOffset = this.sequence.contextTokens.length;
			release();
		})();

		this.omitContext.reset();
	};

	reset_context = async () => {
		await this.modelEvalLock.acquire();
		this.user_context.length = 0;
		this.last_context_data.context = "";
		this.y用户词.clear();
		await this.sequence.clearHistory();
		await this.init_ctx();
	};

	getEvalResult = async () => {
		await this.modelEvalLock.acquire();
		return this.last_result;
	};

	detoken = (token: Token) => {
		return this.model.detokenize([token]);
	};

	add_user_word = (w: string) => {
		const ts = this.model.tokenizer(w);
		if (ts.length === 0) return false;
		const l = this.y用户词.get(ts[0]) ?? [];
		for (const exist of l) {
			if (exist.length !== ts.length) continue;
			const same = exist.every((v, i) => v === ts[i]);
			if (same) return false;
		}
		l.push(ts);
		this.y用户词.set(ts[0], l);
		return true;
	};

	single_ci = async (
		pinyin_input: ZiIndL,
		op?: ThinkOption,
	): Promise<Result> => {
		if (pinyin_input.length === 0 || pinyin_input[0].length === 0) {
			return { candidates: [] };
		}

		if (!this.last_result) {
			return { candidates: [] };
		}

		const c: Candidate[] = [];

		await this.modelEvalLock.acquire();
		await this.tryOmitContext();

		const filterByPinyin = (
			pinyin_input: ZiIndL,
			last_result: Map<Token, number>,
		) => {
			const new_last_result = new Map<
				Token,
				{ py: ZiIndAndKey[]; prob: number; token: string }
			>();
			let scoreSum = 0;
			const ftokenid = new Set<number>();
			for (const firstPinyin of pinyin_input[0]) {
				const s = this.first_pinyin_token.get(firstPinyin.ind) ?? new Set();
				for (const tokenid of s) ftokenid.add(tokenid);
			}

			for (const [token_id, token_prob] of last_result) {
				if (!ftokenid.has(token_id)) continue;
				const token = this.model.detokenize([token_id]);
				if (!token) continue;
				if (["\t", "\n", " "].includes(token[0])) continue;

				const token_pinyin_dy = this.token_pinyin_map.get(token_id);

				if (!token_pinyin_dy) continue;

				const token_pinyin = ziid_in_ziid(pinyin_input, token_pinyin_dy);
				if (!token_pinyin) continue;
				if (token === token_pinyin[0].ind) continue; // 排除部分英文
				new_last_result.set(token_id, {
					py: token_pinyin,
					prob: token_prob,
					token: this.model.detokenize([token_id]),
				});
				scoreSum += token_prob;
			}
			for (const v of new_last_result.values()) {
				v.prob /= scoreSum;
			}
			return new_last_result;
		};
		const new_last_result = filterByPinyin(pinyin_input, this.last_result);

		// 自定义用户词
		for (const [
			token_id,
			{ py: token_pinyin, prob: token_prob },
		] of new_last_result) {
			const rmpy = pinyin_input.slice(token_pinyin.length).map((v) => v[0].ind);

			if (op?.userWord && rmpy.length > 0 && this.y用户词.has(token_id)) {
				type li = {
					ppy: ZiIndAndKey[];
					tkids: Token[];
					remainids: Token[];
				};
				let lis: li[] = [];
				for (const n of this.y用户词.get(token_id) || []) {
					lis.push({
						ppy: structuredClone(token_pinyin),
						tkids: [token_id],
						remainids: n.slice(1) as Token[],
					});
				}
				const final_lis: li[] = [];
				for (let _i = 0; _i < 4; _i++) {
					const nl: li[] = [];
					for (const item of lis) {
						const i = item.remainids[0];
						const r = pinyin_input.slice(item.ppy.length);
						if (r.length === 0) break;
						const p = this.token_pinyin_map.get(i) || [];
						const m = ziid_in_ziid(r, p);
						if (m) {
							const rids = item.remainids.slice(1);
							const nitem: li = {
								ppy: item.ppy.concat(m),
								remainids: rids,
								tkids: item.tkids.concat(i),
							};
							if (rids.length === 0) {
								final_lis.push(nitem);
							} else {
								nl.push(nitem);
							}
						}
					}
					lis = nl;
				}
				for (const i of final_lis) {
					const rmpy = pinyin_input.slice(i.ppy.length).map((i) => i[0].key);
					c.push({
						pinyin: i.ppy.map((i) => i.ind),
						score: token_prob,
						word: this.model.detokenize(i.tkids),
						preedit:
							i.ppy.map((i) => i.preeditShow).join(" ") +
							(rmpy.length ? " " : ""),
						remainkeys: rmpy,
						consumedkeys: i.ppy.map((i) => i.key).join("").length,
					});
				}
			}
		}

		// 常规
		let maxProbId = -1 as Token;
		let maxProb = 0;
		let lastLen = 0;
		for (const [
			token_id,
			{ py: token_pinyin, prob: token_prob, token },
		] of new_last_result) {
			const rmpy = pinyin_input.slice(token_pinyin.length).map((v) => v[0].ind);
			if (token_pinyin.length > lastLen) {
				lastLen = token_pinyin.length;
				maxProb = token_prob;
				maxProbId = token_id;
			} else if (token_pinyin.length === lastLen)
				if (token_prob > maxProb) {
					maxProb = token_prob;
					maxProbId = token_id;
				}
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

		// 首个候选补全为长句
		await (async () => {
			const token_id = maxProbId;
			if (token_id === -1) return;
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
			const sameCache = this.longSentenceCache.slice(0, sameCacheLen);
			const cacheTokens = sameCache.flatMap((i) => i.token);
			if (
				this.sequence.contextTokens
					.slice(
						this.lastCommitOffset,
						this.lastCommitOffset + cacheTokens.length,
					)
					.join(",") !== cacheTokens.join(",")
			) {
				console.error("长句缓存不匹配");
			}
			await this.sequence.eraseContextTokenRanges([
				{
					start: this.lastCommitOffset + cacheTokens.length,
					end: this.sequence.contextTokens.length,
				},
			]);
			if (
				cacheTokens.at(-1) &&
				cacheTokens.at(-1) !== this.sequence.contextTokens.at(-1)
			) {
				console.error("erase error");
			}

			this.longSentenceCache = this.longSentenceCache.slice(0, sameCacheLen);

			let prob = token_prob;
			let rmpyx = pinyin_input.slice(
				sameCache.flatMap((i) => i.matchPY).length,
			);
			const tklppy: ZiIndAndKey[] = [...sameCache.flatMap((i) => i.matchPY)];
			const tkl: Token[] = [...cacheTokens];

			const select = (op: {
				py: ZiIndL;
				matchPY: ZiIndAndKey[];
				token: Token[];
				nextResult: Map<Token, number>;
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

			const addToken = async (token: Token) => {
				return (
					(
						await this.sequence.controlledEvaluate([
							[
								token,
								{
									generateNext: {
										probabilities: true,
									},
								},
							],
						])
					).at(-1)?.next.probabilities || new Map<Token, number>()
				);
			};

			if (this.longSentenceCache.length === 0)
				select({
					token: [token_id],
					matchPY: token_pinyin,
					py: pinyin_input.slice(0, token_pinyin.length),
					nextResult: await addToken(token_id),
				});

			const l = rmpyx.length;

			await this.tryOmitContext(l);

			for (let _i = 0; _i < Math.min(l, 4); _i++) {
				const next = this.longSentenceCache.at(-1)?.nextResult;
				if (!next) {
					console.log("no next");
					break;
				}
				const f = filterByPinyin(rmpyx, next);
				if (f.size > 0) {
					let long = 0;
					for (const v of f.values()) {
						if (v.py.length > long) long = v.py.length;
					}
					let first:
						| [
								Token,
								{
									py: ZiIndAndKey[];
									prob: number;
									token: string;
								},
						  ]
						| undefined;
					for (const ff of f.entries()) {
						if (ff[1].py.length === long) {
							first = ff;
							break;
						}
					}
					if ((first?.[1]?.prob ?? 0) < 0.05) first = f.entries().next().value;
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
					word: this.model.detokenize(tkl),
					remainkeys: rmpyx.map((v) => v[0].ind),
					preedit:
						tklppy.map((v) => v.preeditShow).join(" ") +
						(rmpyx.length ? " " : ""),
					consumedkeys: tklppy.map((v) => v.key).join("").length,
				});
			}
		})();

		for (const py of pinyin_input[0]) {
			const unIndexSet = this.unIndexedZi.get(py.ind);
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

		this.omitContext.reset();

		if (c.length === 0) {
			console.log("is empty");
		}
		return { candidates: c };
	};

	init_ctx = async () => {
		const prompt = this.pre_context + this.user_context.join("");
		const tokens = this.model.tokenizer(prompt);
		const [pre, last] = [tokens.slice(0, -1), tokens.at(-1)];
		if (last === undefined) {
			throw "初始token不够";
		}
		const x = await this.sequence.controlledEvaluate([
			...pre,
			[
				last,
				{
					generateNext: {
						probabilities: true,
						options: {
							topK: Infinity,
						},
					},
				},
			],
		]);
		this.last_result = x.at(-1)?.next.probabilities;
		this.lastCommitOffset = this.sequence.contextTokens.length;
	};

	getUserData(): UserData {
		return {
			words: Object.fromEntries(this.y用户词),
			context: this.user_context,
		};
	}
	loadUserData(data: UserData) {
		if (this.y用户词.size > 0 || this.user_context.length) {
			console.log("已存在用户数据");
			return;
		}
		this.user_context.length = 0;
		for (const i of data.context) this.user_context.push(i);
		this.y用户词.clear();
		for (const [k, v] of Object.entries(data.words))
			this.y用户词.set(Number(k), v);
	}
}

class deBounce {
	private timeout: number | null = null;
	private delay: number;
	private fun = () => {};
	constructor(delay: number, fun: () => void) {
		this.delay = delay;
		this.fun = fun;
	}

	reset() {
		if (this.timeout) clearTimeout(this.timeout);
		this.timeout = setTimeout(() => {
			this.fun();
		}, this.delay);
	}

	cancel() {
		if (this.timeout) clearTimeout(this.timeout);
	}
}

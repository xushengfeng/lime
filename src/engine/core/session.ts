import type {
	LlamaContext,
	LlamaContextSequence,
	LlamaModel,
	Token,
} from "node-llama-cpp";
import { deBounce, Lock } from "./llama.ts";
import type { TokenIndex } from "./token_index.ts";
import type { ExToken } from "./types.ts";

export type LlmSessionOptions = {
	model: LlamaModel;
	context: LlamaContext;
	tokenIndex: TokenIndex;
	omitContext?: boolean;
	preContext?: string;
};

/**
 * 一个算法实例独占的模型会话：上下文、评估、裁剪和最近一次概率。
 * 多个算法共享 model，但各自使用独立的 LlmSession。
 */
export class LlmSession {
	readonly model: LlamaModel;
	readonly context: LlamaContext;
	readonly sequence: LlamaContextSequence;
	private readonly tokenIndex: TokenIndex;

	last_context_data = { context: "" };
	private last_result: Map<ExToken, number> | undefined;
	private lastCommitOffset = 0;

	private readonly pre_context: string;
	private readonly modelEvalLock = new Lock();

	/** 运行时触发 */
	private max_count: number;
	/** 空闲时触发，大任务，所以提前打算，触发值小一点 */
	private smallerMaxCount: number;
	private rm_count: number;
	private readonly omitContext: deBounce;

	constructor({
		model,
		context,
		tokenIndex,
		omitContext,
		preContext,
	}: LlmSessionOptions) {
		this.model = model;
		this.context = context;
		this.sequence = context.getSequence();
		this.tokenIndex = tokenIndex;

		this.max_count = context.contextSize - 64;
		this.smallerMaxCount =
			this.max_count - Math.min(512, Math.floor(this.max_count * 0.1));
		this.rm_count = Math.min(
			this.smallerMaxCount - 64,
			Math.floor(this.smallerMaxCount * 0.2),
		);

		this.pre_context = preContext ?? "下面的内容主题多样";

		this.omitContext = new deBounce(1000 * 10, async () => {
			await this.modelEvalLock.acquire();
			const { release } = await this.modelEvalLock.lock();
			await this.tryOmitContext();
			release();
		});
		if (!omitContext) this.omitContext.cancel();
	}

	get lastResult(): Map<ExToken, number> | undefined {
		return this.last_result;
	}

	get committedLength(): number {
		return this.lastCommitOffset;
	}

	get contextTokens(): Token[] {
		return this.sequence.contextTokens;
	}

	setProbability(token: ExToken, value: number) {
		this.last_result?.set(token, value);
	}

	/** 等待正在进行的 commit / 上下文优化评估结束。 */
	async awaitReady() {
		await this.modelEvalLock.acquire();
	}

	/** 需要独占模型评估时使用；普通候选生成不必持有整段锁。 */
	async exclusive<T>(fn: () => Promise<T>): Promise<T> {
		const { release } = await this.modelEvalLock.lock();
		try {
			return await fn();
		} finally {
			release();
		}
	}

	private tryOmitContext = async () => {
		if (this.sequence.contextTokens.length <= this.smallerMaxCount) {
			return;
		}
		const oldTokenLen = this.sequence.contextTokens.length;

		// 输入分词可能有些情况不是像分词器那样的切分，会影响模型性能，这里重编码分词
		const oldTokens = this.sequence.contextTokens.slice();
		const oldText = this.model.detokenize(oldTokens);
		const newTokens = this.model
			.tokenizer(oldText)
			.slice(-Math.max(this.smallerMaxCount - this.rm_count, 1));

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

	// 快速从最新删除上下文，保证后面操作不爆
	async fastTryOmitContext(buffer = 64) {
		const maxCount = this.max_count - Math.max(buffer, 64);

		if (this.sequence.contextTokens.length <= maxCount) {
			return;
		}
		await this.sequence.eraseContextTokenRanges([
			{
				start: maxCount,
				end: this.sequence.contextTokens.length,
			},
		]);
		this.lastCommitOffset = this.sequence.contextTokens.length;
	}

	commit = async (text: string, update = false, newT = true) => {
		let new_text = "";
		let nt = newT;

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

		// todo shift context

		const to_run = this.model.tokenizer(new_text);
		if (to_run.length === 0) return;

		const pre = to_run.slice(0, -1);
		const last = to_run[to_run.length - 1];
		const { release } = await this.modelEvalLock.lock();
		// 强制commit耗时的部分为异步执行，避免请求阻塞
		(async () => {
			await this.fastTryOmitContext(pre.length + 1);
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
			// 临时
			for (const i of this.tokenIndex.userTokenIds) {
				this.last_result?.set(i, 0);
			}
			this.lastCommitOffset = this.sequence.contextTokens.length;
			release();
		})();

		this.omitContext.reset();

		return new_text;
	};

	reset_context = async () => {
		await this.modelEvalLock.acquire();
		this.last_context_data.context = "";
		await this.sequence.clearHistory();
		await this.init_ctx();
	};

	getEvalResult = async () => {
		await this.modelEvalLock.acquire();
		return this.last_result;
	};

	exTokens = (tokens: ExToken[]) => {
		const tks = tokens.flatMap(
			(i) => this.tokenIndex.expandToken(i) ?? [i as Token],
		);
		return tks;
	};

	detoken = (tokens: ExToken[]) => {
		return this.model.detokenize(this.exTokens(tokens));
	};

	/**
	 * 评估给定 token，并返回下一步的概率分布。
	 * `topK` 不传时使用模型默认值，和现有候选生成保持一致。
	 */
	async evaluateNext(
		tokens: ExToken[],
		op?: { topK?: number },
	): Promise<Map<ExToken, number>> {
		if (tokens.length === 0) return new Map();
		const tks = this.exTokens(tokens);
		const last = tks.at(-1);
		if (last === undefined) return new Map();

		const res = await this.sequence.controlledEvaluate([
			...tks.slice(0, -1),
			[
				last,
				op?.topK === undefined
					? {
							generateNext: {
								probabilities: true,
							},
						}
					: {
							generateNext: {
								probabilities: true,
								options: {
									topK: op.topK,
								},
							},
						},
			],
		]);
		const r = res.at(-1)?.next.probabilities || new Map<ExToken, number>();
		for (const i of this.tokenIndex.userTokenIds) {
			r.set(i, 0);
		}
		return r;
	}

	init_ctx = async () => {
		const prompt = this.pre_context;
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

	resetIdleOmit() {
		this.omitContext.reset();
	}
}

import type { LlamaContext, LlamaModel, Token } from "node-llama-cpp";
import type {
	Candidate,
	Result,
	UserData as ApiUserData,
} from "../shared/api.ts";
import {
	type AlgorithmFactory,
	type AlgorithmId,
	type CandidateAlgorithm,
	createAlgorithm,
} from "./algorithms/index.ts";
import type { ZiIndL } from "./key_map/zi_ind.ts";
import { loadModel, type LoadModelOptions } from "./core/llama.ts";
import { LlmSession } from "./core/session.ts";
import {
	type TokenIndexBase,
	TokenIndex,
	type ZiIndDefinition,
} from "./core/token_index.ts";

export type { Candidate, Result };
export type UserData = ApiUserData<Token>;
export type { LoadModelOptions, LoadedModel } from "./core/llama.ts";
export { loadModel } from "./core/llama.ts";
export { Lock, deBounce } from "./core/llama.ts";
export type {
	AlgorithmFactory,
	AlgorithmId,
	CandidateAlgorithm,
} from "./algorithms/index.ts";
export { algorithmFactories, createAlgorithm } from "./algorithms/index.ts";
export { TokenIndexBase, TokenIndex } from "./core/token_index.ts";

export type AfterReSortFunc = (candidates: Candidate[]) => Candidate[];

export interface IMERunner {
	single_ci(input: ZiIndL): Promise<Result>;
	commit(
		text: string,
		update?: boolean,
		newT?: boolean,
	): Promise<string | undefined>;
	reset_context(): Promise<void>;
	getEvalResult(): Promise<Map<number, number> | undefined>;
	getUserData(): UserData;
	loadUserData(data: UserData): void;
	addUserWord(word: string): boolean;
	checkAddUserWord(word: string): Promise<boolean>;
}

export type InitLIMEOptions = LoadModelOptions & {
	ziInd: ZiIndDefinition;
	omitContext?: boolean;
	afterReSort?: AfterReSortFunc[];
	algorithm?: AlgorithmId | AlgorithmFactory | CandidateAlgorithm;
	preContext?: string;
	/** 已构建的基础索引，多个算法可共享。 */
	tokenIndex?: TokenIndexBase;
};

export type IMEOptions = Omit<InitLIMEOptions, "modelPath" | "contextSize"> & {
	model: LlamaModel;
	context: LlamaContext;
};

/**
 * 输入法门面：组合共享会话、token 索引和某个候选算法。
 * 服务器只依赖这个门面，不关心具体算法。
 */
export class IME implements IMERunner {
	readonly model: LlamaModel;
	readonly context: LlamaContext;
	readonly session: LlmSession;
	readonly index: TokenIndex;
	readonly algorithm: CandidateAlgorithm;

	private afterReSort: AfterReSortFunc[];

	constructor({
		model,
		context,
		ziInd,
		omitContext,
		afterReSort,
		algorithm,
		preContext,
		tokenIndex,
	}: IMEOptions) {
		this.model = model;
		this.context = context;
		this.index = new TokenIndex(model, tokenIndex ?? ziInd);
		this.session = new LlmSession({
			model,
			context,
			tokenIndex: this.index,
			omitContext,
			preContext,
		});
		this.algorithm = createAlgorithm(algorithm);
		this.afterReSort = afterReSort ?? [];

		console.log(`使用算法 ${this.algorithm.id}（${this.algorithm.label}）`);
	}

	init_ctx = async () => {
		await this.session.init_ctx();
	};

	single_ci = async (pinyin_input: ZiIndL): Promise<Result> => {
		const result = await this.algorithm.candidates(pinyin_input, {
			session: this.session,
			index: this.index,
		});
		let tc = result.candidates;
		for (const f of this.afterReSort) {
			tc = f(tc);
		}
		return { candidates: tc };
	};

	commit = async (text: string, update = false, newT = true) => {
		this.algorithm.onCommit?.(text, update, newT);
		return this.session.commit(text, update, newT);
	};

	reset_context = async () => {
		this.algorithm.reset?.();
		this.index.clearUserWords();
		await this.session.reset_context();
	};

	getEvalResult = async () => {
		return await this.session.getEvalResult();
	};

	addUserWord = (word: string): boolean => {
		const token_id = this.index.addUserWord(word);
		if (token_id === undefined) return false;
		this.session.setProbability(token_id, 0);
		return true;
	};

	checkAddUserWord = async (word: string): Promise<boolean> => {
		return this.index.checkAddUserWord(word);
	};

	getUserData = (): UserData => {
		return {
			words: Object.fromEntries(this.index.userWords),
			context: this.session.contextTokens.map((t) => ({
				t: this.model.detokenize([t]) || "",
				token: t,
			})),
		} as UserData;
	};

	loadUserData = (data: UserData) => {
		if (this.index.userWords.size > 0) {
			console.log("已存在用户数据");
			return;
		}
		this.index.loadUserWords(data.words as Record<number, Token[]>);
		for (const token_id of this.index.userTokenIds) {
			this.session.setProbability(token_id, 0);
		}
	};
}

/** 兼容旧入口。 */
export type LIME = IME;
export const LIME = IME;

export async function initLIME(op: InitLIMEOptions): Promise<IME> {
	const { model, context } = await loadModel(op);
	const lime = new IME({
		model,
		context,
		ziInd: op.ziInd,
		omitContext: op.omitContext,
		afterReSort: op.afterReSort,
		algorithm: op.algorithm,
		preContext: op.preContext,
		tokenIndex: op.tokenIndex,
	});
	await lime.init_ctx();
	return lime;
}

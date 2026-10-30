import type { Result } from "../../shared/api.ts";
import type { LlmSession } from "../core/session.ts";
import type { TokenIndex } from "../core/token_index.ts";
import type { ZiIndL } from "../key_map/zi_ind.ts";

export type AlgorithmDeps = {
	session: LlmSession;
	index: TokenIndex;
};

export interface CandidateAlgorithm {
	readonly id: string;
	readonly label: string;

	/** 候选生成入口。 */
	candidates(input: ZiIndL, deps: AlgorithmDeps): Promise<Result>;

	/** 上下文提交前通知算法清掉自己的缓存。 */
	onCommit?(text: string, update: boolean, newT: boolean): void;

	/** 上下文重置时清理算法私有状态。 */
	reset?(): void;
}

export type AlgorithmFactory = () => CandidateAlgorithm;

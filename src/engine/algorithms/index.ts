import { createQualityDictLlm, DictLlm } from "./dict-llm.ts";
import { LimeV1 } from "./lime-v1.ts";
import type { AlgorithmFactory, CandidateAlgorithm } from "./types.ts";

export type { AlgorithmDeps, AlgorithmFactory, CandidateAlgorithm } from "./types.ts";

export const algorithmFactories = {
	"lime-v1": (): CandidateAlgorithm => new LimeV1(),
	"dict-llm-v1": (): CandidateAlgorithm => new DictLlm(),
	"dict-llm-v1-quality": (): CandidateAlgorithm => createQualityDictLlm(),
} satisfies Record<string, AlgorithmFactory>;

export type AlgorithmId = keyof typeof algorithmFactories;

export function createAlgorithm(
	algorithm: AlgorithmId | AlgorithmFactory | CandidateAlgorithm = "lime-v1",
): CandidateAlgorithm {
	if (typeof algorithm === "string") {
		const factory = algorithmFactories[algorithm as AlgorithmId];
		if (!factory) throw new Error(`未知算法: ${algorithm}`);
		return factory();
	}
	if (typeof algorithm === "function") {
		return algorithm();
	}
	return algorithm;
}

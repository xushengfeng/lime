import type { AlgorithmId } from "../src/engine/main.ts";

/** 用 LIME_ALGORITHM=lime-v2 可以让 bench 脚本切换算法。 */
export const benchAlgorithm = (process.env.LIME_ALGORITHM ??
	"lime-v1") as AlgorithmId;

import { expect, test } from "vitest";
import {
	algorithmFactories,
	createAlgorithm,
	type CandidateAlgorithm,
} from "../../src/engine/algorithms/index.ts";

test("默认算法", () => {
	const algorithm = createAlgorithm();
	expect(algorithm.id).toBe("lime-v1");
	expect(algorithmFactories["lime-v1"]().id).toBe("lime-v1");
	expect("dict-llm-v1" in algorithmFactories).toBe(true);
	expect("dict-llm-v1-quality" in algorithmFactories).toBe(true);
});

test("可以传入自定义算法实例或工厂", () => {
	const custom: CandidateAlgorithm = {
		id: "custom",
		label: "自定义",
		async candidates() {
			return { candidates: [] };
		},
	};
	expect(createAlgorithm(custom)).toBe(custom);
	expect(createAlgorithm(() => custom)).toBe(custom);
});

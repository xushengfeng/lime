import { performance } from "node:perf_hooks";
import { load_pinyin } from "../src/engine/key_map/pinyin/gen_zi_pinyin.ts";
import { keys_to_pinyin } from "../src/engine/key_map/pinyin/keys_to_pinyin.ts";
import { initLIME } from "../src/engine/main.ts";
import { benchAlgorithm } from "./algorithm.ts";

/**
 * 按键延迟基准。
 *
 * 只报告并标记超过阈值的场景，不做断言、不让进程失败。
 * 模型加载和拼音索引构建不计入下面的时间。
 */
const THRESHOLD_MS = 109;

type Samples = Map<string, number[]>;

const samples: Samples = new Map();

function addSample(name: string, ms: number) {
	const list = samples.get(name) ?? [];
	list.push(ms);
	samples.set(name, list);
}

async function measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
	const start = performance.now();
	const value = await fn();
	addSample(name, performance.now() - start);
	return value;
}

function percentile(sorted: number[], p: number) {
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(p * sorted.length) - 1),
	);
	return sorted[index];
}

function stats(values: number[]) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	const median =
		sorted.length % 2 === 0
			? (sorted[middle - 1] + sorted[middle]) / 2
			: sorted[middle];
	return {
		count: sorted.length,
		min: sorted[0],
		median,
		p95: percentile(sorted, 0.95),
		max: sorted.at(-1) ?? 0,
		over: sorted.filter((value) => value > THRESHOLD_MS).length,
	};
}

const runner = await initLIME({
	ziInd: load_pinyin(),
	algorithm: benchAlgorithm,
});
await runner.reset_context();

// 预热，避免把首次调用的初始化成本算进普通筛选。
await runner.single_ci(keys_to_pinyin("ni"));

// 1. 纯筛选：不触发长句补全的输入，重复测量稳定性。
for (let i = 0; i < 20; i++) {
	await measure("普通筛选 nihao", () =>
		runner.single_ci(keys_to_pinyin("nihao")),
	);
}

// 2. 渐近输入：每个 key 都单独计时，能看出哪一步触发了模型推理。
for (const key of ["n", "ni", "nih", "niha", "nihao"]) {
	await measure(`渐近 ${key}`, () =>
		runner.single_ci(keys_to_pinyin(key)),
	);
}

// 3. commit 返回和推理完成分开测。
for (let i = 0; i < 5; i++) {
	await measure("commit 返回", () => runner.commit("冰灯是"));
	await measure("commit 推理完成", () => runner.getEvalResult());
}

// 4. commit 后第一个 key：等待上一次 commit 的推理，再加筛选。
for (let i = 0; i < 5; i++) {
	await runner.commit("冰灯是");
	await measure("commit 后首键 n", () =>
		runner.single_ci(keys_to_pinyin("n")),
	);
}

// 5. 长句补全：按键路径中最多 4 次模型评估。
await runner.commit("冰灯是");
await runner.getEvalResult();
await measure("长句补全 lqxyyuvsgobzfh", () =>
	runner.single_ci(keys_to_pinyin("lqxyyuvsgobzfh", { shuangpin: "自然码" })),
);

const rows = Array.from(samples, ([name, values]) => {
	const s = stats(values);
	return {
		场景: name,
		次数: s.count,
		最小ms: s.min.toFixed(2),
		中位ms: s.median.toFixed(2),
		p95ms: s.p95.toFixed(2),
		最大ms: s.max.toFixed(2),
		"大于109ms": s.over > 0 ? `⚠ ${s.over}/${s.count}` : "",
		_over: s.over,
	};
});

console.log(`\n按键延迟（阈值 ${THRESHOLD_MS}ms，模型加载和索引构建不计入）`);
console.table(
	rows.map(({ _over, ...row }) => row),
);

const marked = rows.filter((row) => row._over > 0);
if (marked.length === 0) {
	console.log(`没有场景超过 ${THRESHOLD_MS}ms。`);
} else {
	console.log(`\n超过 ${THRESHOLD_MS}ms 的场景：`);
	for (const row of marked) {
		console.log(`- ${row.场景}: ${row._over}/${row.次数} 次，最大 ${row.最大ms}ms`);
	}
}

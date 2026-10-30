import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pinyin } from "pinyin-pro";
import { load_pinyin } from "../src/engine/key_map/pinyin/gen_zi_pinyin.ts";
import { keys_to_pinyin } from "../src/engine/key_map/pinyin/keys_to_pinyin.ts";
import { algorithmFactories } from "../src/engine/algorithms/index.ts";
import { type AlgorithmId, initLIME } from "../src/engine/main.ts";
import {
	type BaselineMode,
	DictionaryIME,
	WordIME,
} from "./baseline.ts";
import { toShuangpin } from "./shuangpin.ts";

function countHan(text: string): number {
	return text.match(/\p{Script=Han}/gu)?.length ?? 0;
}

type Segment = { text: string; chinese: boolean };

function segmentArticle(text: string): Segment[] {
	const segments: Segment[] = [];
	const segmenter = new Intl.Segmenter("zh-Hans", { granularity: "word" });
	for (const part of segmenter.segment(text)) {
		const piece = part.segment;
		const chinese = /^[\p{Script=Han}]+$/u.test(piece);
		const last = segments.at(-1);
		if (chinese && last?.chinese) {
			last.text += piece;
		} else {
			segments.push({ text: piece, chinese });
		}
	}
	return segments;
}

type Metrics = {
	name: string;
	sourceChars: number;
	coveredChars: number;
	queries: number;
	commits: number;
	keys: number;
	top1Chars: number;
	top5Chars: number;
	top1Queries: number;
	top5Queries: number;
	rankedQueries: number;
	rankSum: number;
	missing: number;
	ms: number;
};

function emptyMetrics(name: string): Metrics {
	return {
		name,
		sourceChars: 0,
		coveredChars: 0,
		queries: 0,
		commits: 0,
		keys: 0,
		top1Chars: 0,
		top5Chars: 0,
		top1Queries: 0,
		top5Queries: 0,
		rankedQueries: 0,
		rankSum: 0,
		missing: 0,
		ms: 0,
	};
}

async function runLIME(article: string, algorithm: AlgorithmId): Promise<Metrics> {
	const runner = await initLIME({ ziInd: load_pinyin(), algorithm });
	await runner.reset_context();

	const metrics = emptyMetrics(
		algorithm === "lime-v1" ? "LIME（模型）" : `LIME（${algorithm}）`,
	);
	const segments = segmentArticle(article);
	const start = Date.now();

	for (const segment of segments) {
		if (!segment.chinese) {
			await runner.commit(segment.text, false, true);
			metrics.commits++;
			continue;
		}

		const chars = Array.from(segment.text);
		const py = pinyin(segment.text, {
			type: "array",
			toneType: "none",
			v: true,
		});
		if (
			py.length !== chars.length ||
			py.some((item) => !toShuangpin(item))
		) {
			metrics.missing++;
			metrics.coveredChars += chars.length;
			await runner.commit(segment.text, false, true);
			metrics.commits++;
			continue;
		}

		let keys = py.map(toShuangpin).join("");
		metrics.keys += keys.length;
		let source = segment.text;
		let guard = 0;

		while (keys && source && guard++ < 500) {
			const ziInd = keys_to_pinyin(keys, { shuangpin: "自然码" });
			const result = await runner.single_ci(ziInd);
			metrics.queries++;

			const index = result.candidates.findIndex(
				(candidate) => candidate.word && source.startsWith(candidate.word),
			);
			if (index === -1) {
				metrics.missing++;
				metrics.coveredChars += countHan(source);
				await runner.commit(source, false, true);
				metrics.commits++;
				source = "";
				break;
			}

			const candidate = result.candidates[index];
			const covered = countHan(candidate.word);
			metrics.coveredChars += covered;
			metrics.rankedQueries++;
			metrics.rankSum += index;
			if (index === 0) {
				metrics.top1Chars += covered;
				metrics.top1Queries++;
			}
			if (index < 5) {
				metrics.top5Chars += covered;
				metrics.top5Queries++;
			}

			const nextKeys = candidate.remainkeys.map(toShuangpin).join("");
			await runner.commit(candidate.word, true, nextKeys.length === 0);
			metrics.commits++;
			source = source.slice(candidate.word.length);

			if (nextKeys.length >= keys.length) {
				break;
			}
			keys = nextKeys;
		}

		if (source) {
			metrics.missing++;
			metrics.coveredChars += countHan(source);
			await runner.commit(source, false, true);
			metrics.commits++;
		}
	}

	metrics.ms = Date.now() - start;
	metrics.sourceChars = segments.reduce(
		(sum, segment) => sum + (segment.chinese ? countHan(segment.text) : 0),
		0,
	);
	return metrics;
}

function runBaseline(article: string, mode: BaselineMode): Metrics {
	if (mode === "rime" || mode === "qwen") {
		return runWordBaseline(article, mode);
	}
	const names: Record<"base" | "adapt" | "bigram", string> = {
		base: "字典（基础字频）",
		adapt: "字典（+调频）",
		bigram: "字典（+调频+上下文）",
	};
	const ime = new DictionaryIME(mode);
	ime.reset();
	const metrics = emptyMetrics(names[mode]);
	const segments = segmentArticle(article);
	const start = Date.now();

	for (const segment of segments) {
		if (!segment.chinese) {
			ime.commitLiteral();
			continue;
		}

		const chars = Array.from(segment.text);
		const py = pinyin(segment.text, {
			type: "array",
			toneType: "none",
			v: true,
		});
		if (
			py.length !== chars.length ||
			py.some((item) => !toShuangpin(item))
		) {
			metrics.missing += chars.length;
			metrics.coveredChars += chars.length;
			for (const char of chars) ime.commit(char);
			continue;
		}

		const keys = py.map(toShuangpin).join("");
		metrics.keys += keys.length;
		const syllables = keys_to_pinyin(keys, { shuangpin: "自然码" });

		for (let i = 0; i < chars.length; i++) {
			const correct = chars[i];
			metrics.queries++;
			metrics.coveredChars++;
			metrics.commits++;

			const options = syllables[i];
			if (!options) {
				metrics.missing++;
				ime.commit(correct);
				continue;
			}

			const candidates = ime.candidates(options);
			const rank = candidates.indexOf(correct);
			if (rank === -1) {
				metrics.missing++;
			} else {
				metrics.rankedQueries++;
				metrics.rankSum += rank;
				if (rank === 0) {
					metrics.top1Chars++;
					metrics.top1Queries++;
				}
				if (rank < 5) {
					metrics.top5Chars++;
					metrics.top5Queries++;
				}
			}
			ime.commit(correct);
		}
	}

	metrics.ms = Date.now() - start;
	metrics.sourceChars = segments.reduce(
		(sum, segment) => sum + (segment.chinese ? countHan(segment.text) : 0),
		0,
	);
	return metrics;
}

function runWordBaseline(article: string, kind: "rime" | "qwen"): Metrics {
	const names = {
		rime: "雾凇词库（长词优先）",
		qwen: "Qwen token 词表（长词优先）",
	};
	const ime = new WordIME(kind);
	const metrics = emptyMetrics(names[kind]);
	const segments = segmentArticle(article);
	const start = Date.now();

	for (const segment of segments) {
		if (!segment.chinese) {
			ime.commitLiteral();
			continue;
		}

		const chars = Array.from(segment.text);
		const py = pinyin(segment.text, {
			type: "array",
			toneType: "none",
			v: true,
		});
		if (
			py.length !== chars.length ||
			py.some((item) => !toShuangpin(item))
		) {
			metrics.missing++;
			metrics.coveredChars += chars.length;
			continue;
		}

		let keys = py.map(toShuangpin).join("");
		metrics.keys += keys.length;
		let source = segment.text;
		let guard = 0;

		while (keys && source && guard++ < 500) {
			const candidates = ime.candidates(keys);
			metrics.queries++;
			const index = candidates.findIndex(
				(candidate) => candidate.word && source.startsWith(candidate.word),
			);
			if (index === -1) {
				metrics.missing++;
				metrics.coveredChars += countHan(source);
				break;
			}

			const entry = candidates[index];
			const covered = countHan(entry.word);
			metrics.coveredChars += covered;
			metrics.rankedQueries++;
			metrics.rankSum += index;
			if (index === 0) {
				metrics.top1Chars += covered;
				metrics.top1Queries++;
			}
			if (index < 5) {
				metrics.top5Chars += covered;
				metrics.top5Queries++;
			}

			ime.commit(entry.word);
			metrics.commits++;
			source = source.slice(entry.word.length);

			if (entry.key.length >= keys.length) break;
			keys = keys.slice(entry.key.length);
		}

		if (source) {
			metrics.missing++;
			metrics.coveredChars += countHan(source);
		}
	}

	metrics.ms = Date.now() - start;
	metrics.sourceChars = segments.reduce(
		(sum, segment) => sum + (segment.chinese ? countHan(segment.text) : 0),
		0,
	);
	return metrics;
}

function percent(value: number): string {
	return `${(value * 100).toFixed(2)}%`;
}

function printResults(results: Metrics[], articlePath: string) {
	const sourceChars = results[0]?.sourceChars ?? 0;
	console.log(
		`\n文章: ${articlePath}  ${sourceChars} 汉字  输入: 双拼（自然码）`,
	);
	console.table(
		results.map((result) => ({
			引擎: result.name,
			首选字符覆盖: percent(
				result.top1Chars / Math.max(1, result.sourceChars),
			),
			Top5字符覆盖: percent(
				result.top5Chars / Math.max(1, result.sourceChars),
			),
			覆盖率: percent(
				result.coveredChars / Math.max(1, result.sourceChars),
			),
			查询首选率: percent(result.top1Queries / Math.max(1, result.queries)),
			查询Top5: percent(result.top5Queries / Math.max(1, result.queries)),
			平均排名: (result.rankSum / Math.max(1, result.rankedQueries)).toFixed(2),
			缺失: result.missing,
			按键: result.keys,
			查询: result.queries,
			提交: result.commits,
			用时: `${(result.ms / 1000).toFixed(1)}s`,
		})),
	);
}

type RunConfig =
	| { kind: "lime"; algorithm: AlgorithmId }
	| { kind: "baseline"; mode: BaselineMode };

function parseAlgorithms(algorithm: string, algorithms?: string): AlgorithmId[] {
	const list = algorithms?.split(",").map((item) => item.trim()) ?? [algorithm];
	const result: AlgorithmId[] = [];
	for (const item of list) {
		if (!item) continue;
		if (!(item in algorithmFactories)) {
			throw new Error(`未知 algorithm: ${item}`);
		}
		result.push(item as AlgorithmId);
	}
	return result;
}

async function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			article: { type: "string", default: "bench/articles/冰灯.txt" },
			limit: { type: "string" },
			engine: { type: "string", default: "both" },
			"baseline-mode": { type: "string", default: "rime" },
			algorithm: { type: "string", default: "lime-v1" },
			algorithms: { type: "string" },
			ablation: { type: "boolean", default: false },
			json: { type: "string" },
		},
	});

	const articlePath = path.resolve(process.cwd(), String(values.article));
	let article = readFileSync(articlePath, "utf8").replaceAll("\r\n", "\n");
	const limit = values.limit ? Number(values.limit) : 0;
	if (limit > 0) {
		article = Array.from(article).slice(0, limit).join("");
	}

	const algorithms = parseAlgorithms(
		String(values.algorithm),
		values.algorithms ? String(values.algorithms) : undefined,
	);
	const configs: RunConfig[] = [];
	if (values.ablation) {
		for (const algorithm of algorithms) {
			configs.push({ kind: "lime", algorithm });
		}
		configs.push(
			{ kind: "baseline", mode: "base" },
			{ kind: "baseline", mode: "adapt" },
			{ kind: "baseline", mode: "bigram" },
			{ kind: "baseline", mode: "rime" },
			{ kind: "baseline", mode: "qwen" },
		);
	} else {
		const engine = String(values.engine);
		const baselineMode = String(values["baseline-mode"]);
		if (!["base", "adapt", "bigram", "rime", "qwen"].includes(baselineMode)) {
			throw new Error(`未知 baseline-mode: ${baselineMode}`);
		}
		if (engine === "lime" || engine === "both") {
			for (const algorithm of algorithms) {
				configs.push({ kind: "lime", algorithm });
			}
		}
		if (engine === "baseline" || engine === "both") {
			configs.push({
				kind: "baseline",
				mode: baselineMode as BaselineMode,
			});
		}
		if (configs.length === 0) {
			throw new Error(`未知 engine: ${engine}`);
		}
	}

	const results: Metrics[] = [];
	for (const config of configs) {
		const result = config.kind === "lime"
			? await runLIME(article, config.algorithm)
			: runBaseline(article, config.mode);
		results.push(result);
	}

	printResults(results, articlePath);

	if (values.json) {
		const jsonPath = path.resolve(process.cwd(), String(values.json));
		mkdirSync(path.dirname(jsonPath), { recursive: true });
		writeFileSync(
			jsonPath,
			JSON.stringify(
				{
					article: articlePath,
					textLength: countHan(article),
					shuangpin: "自然码",
					results,
				},
				null,
				2,
			),
		);
		console.log(`\n结果已写入 ${jsonPath}`);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

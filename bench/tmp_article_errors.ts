import { readFileSync } from "node:fs";
import path from "node:path";
import { pinyin } from "pinyin-pro";
import { load_pinyin } from "../src/engine/key_map/pinyin/gen_zi_pinyin.ts";
import { keys_to_pinyin } from "../src/engine/key_map/pinyin/keys_to_pinyin.ts";
import { initLIME } from "../src/engine/main.ts";
import { toShuangpin } from "./shuangpin.ts";

const articlePath = process.argv[2] ?? "bench/articles/论语.txt";
const limit = Number(process.argv[3] ?? 100);
const article = Array.from(readFileSync(articlePath, "utf8")).slice(0, limit).join("");
const segments: Array<{ text: string; chinese: boolean }> = [];
const segmenter = new Intl.Segmenter("zh-Hans", { granularity: "word" });
for (const part of segmenter.segment(article)) {
	const piece = part.segment;
	const chinese = /^[\p{Script=Han}]+$/u.test(piece);
	const last = segments.at(-1);
	if (chinese && last?.chinese) last.text += piece;
	else segments.push({ text: piece, chinese });
}

const runner = await initLIME({ ziInd: load_pinyin(), algorithm: "dict-llm-v1" });
await runner.reset_context();
const algo = runner.algorithm as any;
let totalQueries = 0;
let top1 = 0;
const errors: any[] = [];

for (const segment of segments) {
	if (!segment.chinese) {
		await runner.commit(segment.text, false, true);
		continue;
	}
	const chars = Array.from(segment.text);
	const py = pinyin(segment.text, { type: "array", toneType: "none", v: true });
	if (py.length !== chars.length || py.some((item) => !toShuangpin(item))) {
		await runner.commit(segment.text, false, true);
		continue;
	}
	let keys = py.map(toShuangpin).join("");
	let source = segment.text;
	let guard = 0;
	while (keys && source && guard++ < 50) {
		const input = keys_to_pinyin(keys, { shuangpin: "自然码" });
		const result = await runner.single_ci(input);
		totalQueries++;
		const index = result.candidates.findIndex(
			(c) => c.word && source.startsWith(c.word),
		);
		if (index === 0) top1++;
		const top = result.candidates.slice(0, 5).map((c) => c.word);
		if (index !== 0) {
			const drafts = algo.buildDrafts(input);
			const correctDrafts = drafts
				.filter((d: any) => source.startsWith(d.word))
				.map((d: any) => ({
					word: d.word,
					words: d.words.map((x: any) => x.word),
					end: d.end,
					draftScore: d.draftScore,
				}))
				.sort((a: any, b: any) => b.word.length - a.word.length);
			let selectedCorrect: any[] = [];
			let singleRank = -1;
			let singleCount = 0;
			let correctSingle: any;
			await runner.session.exclusive(async () => {
				const base = runner.session.committedLength;
				const baseProbs =
					await runner.session.recomputeNextProbabilities(200);
				const all = drafts.map((d: any) => {
					const tokens = algo.tokensOf(d.word, runner.session);
					return {
						draft: d,
						tokens,
						prescore: algo.prescore(d, tokens, baseProbs, input),
					};
				});
				const selected = algo.selectForEvaluation(all);
				selectedCorrect = selected
					.filter((s: any) => source.startsWith(s.draft.word))
					.map((s: any) => ({
						word: s.draft.word,
						words: s.draft.words.map((x: any) => x.word),
						prescore: s.prescore,
					}));
				const singles = all
					.filter((s: any) => s.draft.words.length === 1)
					.sort((a: any, b: any) => b.prescore - a.prescore);
				const foundSingle = singles.find((s: any) =>
					source.startsWith(s.draft.word),
				);
				singleRank = foundSingle ? singles.indexOf(foundSingle) : -1;
				singleCount = singles.length;
				correctSingle = foundSingle
					? {
							word: foundSingle.draft.word,
							prescore: foundSingle.prescore,
						}
					: undefined;
				await runner.session.sequence.eraseContextTokenRanges([
					{ start: base, end: runner.session.contextTokens.length },
				]);
			});
			const dictMatches = (algo.dictionary as any).matchAt(input, 0);
			errors.push({
				source,
				index,
				top,
				correctDrafts: correctDrafts.slice(0, 5),
				selectedCorrect,
				singleRank,
				singleCount,
				correctSingle,
				dictPrefixes: dictMatches
					.map((m: any) => m.entry.word)
					.filter((w: string) => source.startsWith(w))
					.slice(0, 10),
			});
		}
		if (index === -1) {
			await runner.commit(source, false, true);
			break;
		}
		const candidate = result.candidates[index];
		source = source.slice(candidate.word.length);
		keys = candidate.remainkeys.map(toShuangpin).join("");
		await runner.commit(candidate.word, true, keys.length === 0);
	}
}

console.log(`\n查询 ${totalQueries}，首选 ${top1} (${((top1 / totalQueries) * 100).toFixed(2)}%)，错误 ${errors.length}`);
for (const [i, error] of errors.entries()) {
	console.log(`\n--- ${i + 1} rank=${error.index} source=${error.source}`);
	console.log("top", error.top);
	console.log("dictPrefixes", error.dictPrefixes);
	console.log("correctDrafts", error.correctDrafts);
	console.log("selectedCorrect", error.selectedCorrect);
	console.log(
		"correctSingle",
		error.correctSingle,
		"rank",
		error.singleRank,
		"/",
		error.singleCount,
	);
}

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sources = ["base", "ext", "others"].map((name) => ({
	name,
	url: `https://fastly.jsdelivr.net/gh/iDvel/rime-ice@main/cn_dicts/${name}.dict.yaml`,
}));

type Entry = { word: string; pinyin: string; weight: number };

function parse(text: string): Entry[] {
	const out: Entry[] = [];
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (
			!line ||
			line.startsWith("#") ||
			line === "---" ||
			line === "..." ||
			line.startsWith("name:") ||
			line.startsWith("version:") ||
			line.startsWith("sort:")
		) {
			continue;
		}
		const fields = line.split("\t");
		const word = fields[0]?.trim();
		const pinyin = fields[1]?.trim();
		if (!word || !pinyin || !/^[\p{Script=Han}]{2,8}$/u.test(word)) {
			continue;
		}
		const weight = Number(fields[2] || 1);
		out.push({ word, pinyin, weight: Number.isFinite(weight) ? weight : 1 });
	}
	return out;
}

async function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			limit: { type: "string", default: "150000" },
			out: {
				type: "string",
				default: path.join(__dirname, "../assets/pinyin/words.dict.yaml"),
			},
		},
	});

	const entries = new Map<string, Entry>();
	for (const source of sources) {
		const response = await fetch(source.url);
		if (!response.ok) {
			throw new Error(`下载 ${source.name} 失败: ${response.status}`);
		}
		const text = await response.text();
		for (const entry of parse(text)) {
			const key = `${entry.word}\t${entry.pinyin}`;
			const existing = entries.get(key);
			if (!existing || entry.weight > existing.weight) {
				entries.set(key, entry);
			}
		}
		console.log(`${source.name}: ${entries.size} 条`);
	}

	const limit = Number(values.limit) || 150000;
	const selected = Array.from(entries.values())
		.sort(
			(a, b) =>
				b.weight - a.weight ||
				Array.from(b.word).length - Array.from(a.word).length ||
				(a.word < b.word ? -1 : 1),
		)
		.slice(0, limit);

	const lines = [
		`# Rime-ice word list: top ${selected.length} by weight (2-8 汉字).`,
		"# Source: https://github.com/iDvel/rime-ice (cn_dicts/base, ext, others)",
		"# 可由 bench/build_words.ts 重新生成。",
		"---",
		"name: words",
		`version: "${new Date().toISOString().slice(0, 10)}"`,
		"sort: by_weight",
		"...",
		...selected.map((entry) => `${entry.word}\t${entry.pinyin}\t${Math.round(entry.weight)}`),
	];

	const outPath = path.resolve(String(values.out));
	writeFileSync(outPath, `${lines.join("\n")}\n`);
	console.log(`写入 ${selected.length} 条到 ${outPath}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

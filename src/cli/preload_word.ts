import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../utils/config.d.ts";
import { get_dict } from "../key_map/rime_dict.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let userConfig: Config | undefined;

try {
	userConfig = (await import("../user_config.ts")).default;
} catch {
	console.log("使用默认配置");
}

const config = userConfig || (await import("../config.ts")).default;

const filePath = path.join(__dirname, "preload_word.txt");

const { checkAddUserWord } = config.runner;

const words: string[] = [];

if (Deno.args[0] === "rime") {
	const p = Deno.args[1];
	const d = get_dict(p);
	for (const w of d) {
		const word = w.split("\t")[0].trim();
		const value = Number(w.split("\t")[2]?.trim() || "0");
		if (word && value > 5000) words.push(word);
	}
}

const oldWords = new Set<string>();
try {
	for (const x of Deno.readTextFileSync(filePath).split("\n")) {
		if (x.trim()) oldWords.add(x.trim());
	}
} catch {
	// ignore
}

const textEncoder = new TextEncoder();
for (const [i, w] of words.entries()) {
	const res = await checkAddUserWord(w);
	if (res) oldWords.add(w);
	Deno.stdout.writeSync(
		textEncoder.encode(
			`预加载用户词 ${(((i + 1) / words.length) * 100).toFixed(2)}%\r`,
		),
	);
}
console.log(`\n保存完毕`);

Deno.writeTextFileSync(
	path.join(__dirname, "preload_word.txt"),
	Array.from(oldWords).join("\n"),
);
console.log("预加载用户词完成，数量", oldWords.size);

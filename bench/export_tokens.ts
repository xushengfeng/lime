import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	getLlama,
	readGgufFileInfo,
	type Token,
} from "node-llama-cpp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			model: {
				type: "string",
				default: path.join(
					__dirname,
					"../../Qwen3-0.6B-GGUF/Qwen3-0.6B-IQ4_XS.gguf",
				),
			},
			out: {
				type: "string",
				default: path.join(__dirname, "dicts/qwen_tokens.tsv"),
			},
		},
	});
	const modelPath = String(values.model);

	const info = await readGgufFileInfo(modelPath, {
		readTensorInfo: false,
		logWarnings: false,
	});
	const tokenCount = info.metadata.tokenizer.ggml.tokens?.length;
	if (!tokenCount) {
		throw new Error("模型里没有 tokenizer.ggml.tokens");
	}

	const llama = await getLlama({ gpu: false });
	const model = await llama.loadModel({ modelPath, vocabOnly: true });

	const seen = new Set<string>();
	const rows: Array<{ token: string; weight: number }> = [];
	for (let index = 0; index < tokenCount; index++) {
		const token = model.detokenize([index as Token]);
		if (!/^[\p{Script=Han}]{1,8}$/u.test(token)) continue;
		if (seen.has(token)) continue;
		seen.add(token);
		rows.push({
			token,
			weight: Math.max(1, Math.round(100_000 / (index + 1))),
		});
	}

	await model.dispose();

	const outPath = path.resolve(String(values.out));
	mkdirSync(path.dirname(outPath), { recursive: true });
	const lines = [
		`# Qwen token table from ${path.basename(modelPath)}`,
		...rows.map((row) => `${row.token}\t${row.weight}`),
	];
	writeFileSync(outPath, `${lines.join("\n")}\n`);
	console.log(`导出 ${rows.length} 个汉字 token 到 ${outPath}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

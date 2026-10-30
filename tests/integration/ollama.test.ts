import { test } from "vitest";
import {
	getOllamaModel,
	listOllamaModels,
} from "../../src/engine/ollama.ts";

test("加载 Ollama 模型列表", () => {
	const models = listOllamaModels();
	console.log("Ollama 模型列表:", models);
});

test("加载 Ollama 模型", () => {
	const model = getOllamaModel("qwen3:0.6b");
	console.log("Ollama 模型:", model);
});

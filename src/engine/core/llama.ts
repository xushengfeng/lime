import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLlama, type LlamaContext, type LlamaModel } from "node-llama-cpp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type LoadModelOptions = {
	modelPath?: string;
	contextSize?: number;
};

export type LoadedModel = {
	model: LlamaModel;
	context: LlamaContext;
};

export async function loadModel(op?: LoadModelOptions): Promise<LoadedModel> {
	const modelPath =
		op?.modelPath ??
		path.join(
			__dirname,
			"../../../../Qwen3-0.6B-GGUF/Qwen3-0.6B-IQ4_XS.gguf",
		);

	const llama = await getLlama({
		gpu: false,
	});

	console.log("加载模型", modelPath);

	const model = await llama.loadModel({
		modelPath: modelPath,
	});
	const context = await model.createContext({
		contextSize: { max: op?.contextSize ?? 4096 },
	});
	console.log("加载完成");

	return { model, context };
}

export class Lock {
	private pm: Promise<void> | null = null;

	async acquire() {
		if (this.pm) await this.pm;
	}

	async lock() {
		await this.acquire();
		const p = Promise.withResolvers<void>();
		this.pm = p.promise;

		return {
			release: () => {
				p.resolve();
			},
		};
	}
}

export class deBounce {
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private delay: number;
	private fun = () => {};
	private cancelled = false;
	constructor(delay: number, fun: () => void) {
		this.delay = delay;
		this.fun = fun;
	}

	reset() {
		if (this.timeout) clearTimeout(this.timeout);
		if (this.cancelled) return;
		this.timeout = setTimeout(() => {
			this.fun();
		}, this.delay);
	}

	cancel() {
		if (this.timeout) clearTimeout(this.timeout);
		this.cancelled = true;
	}
}

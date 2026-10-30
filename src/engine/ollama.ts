import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

type OllamaOptions = {
	ollamaPath?: string;
};

type OllamaManifest = {
	layers: Array<{ mediaType: string; digest: string }>;
};

function getDefaultOllamaPath(): string {
	const os = process.platform;

	if (os === "darwin") {
		return join(process.env.HOME || "", ".ollama", "models");
	} else if (os === "linux") {
		const userPath = join(process.env.HOME || "", ".ollama", "models");
		try {
			if (statSync(userPath).isDirectory()) {
				return userPath;
			}
		} catch {
			//
		}
		return "/usr/share/ollama/.ollama/models";
	} else if (os === "win32") {
		const userProfile = process.env.USERPROFILE || "";
		return join(userProfile, ".ollama", "models");
	}

	throw new Error(`Unsupported operating system: ${os}`);
}

function getOllamaDir(basePath: string) {
	return {
		manifests: join(basePath, "manifests/registry.ollama.ai/"),
		models: join(basePath, "blobs/"),
	};
}

export function listOllamaModels(op?: OllamaOptions) {
	const basePath = op?.ollamaPath || getDefaultOllamaPath();
	const dirs = getOllamaDir(basePath);
	try {
		const manifests = readdirSync(dirs.manifests, { withFileTypes: true });
		const models: string[] = [];
		for (const userNameSpace of manifests) {
			const modelsDir = readdirSync(join(dirs.manifests, userNameSpace.name), {
				withFileTypes: true,
			});
			for (const modelName of modelsDir) {
				if (modelName.isDirectory()) {
					for (const modelXinghao of readdirSync(
						join(dirs.manifests, userNameSpace.name, modelName.name),
					)) {
						models.push(
							`${userNameSpace.name === "library" ? "" : `${userNameSpace.name}/`}${modelName.name}:${modelXinghao}`,
						);
					}
				}
			}
		}
		return models;
	} catch (error) {
		console.error("Error reading Ollama models:", error);
		return [];
	}
}

export function getOllamaModel(model: string, op?: OllamaOptions) {
	const basePath = op?.ollamaPath || getDefaultOllamaPath();
	const dirs = getOllamaDir(basePath);
	const manifestPath = join(
		dirs.manifests,
		model.includes("/")
			? model.replace(":", "/")
			: `library/${model.replace(":", "/")}`,
	);
	try {
		const manifestData = JSON.parse(
			readFileSync(manifestPath, "utf8"),
		) as OllamaManifest;
		const layer = manifestData.layers.find(
			(l) => l.mediaType === "application/vnd.ollama.image.model",
		);
		if (!layer) {
			console.error(`No model layer found for ${model}`);
			return undefined;
		}
		const modelBlobPath = join(
			dirs.models,
			layer.digest.replace("sha256:", "sha256-"),
		);
		try {
			if (statSync(modelBlobPath).isFile()) {
				return modelBlobPath;
			} else {
				console.error(`Model blob path is not a file for ${model}`);
				return undefined;
			}
		} catch (error) {
			console.error(`Error accessing model blob path for ${model}:`, error);
			return undefined;
		}
	} catch (error) {
		console.error(`Error reading Ollama model manifest for ${model}:`, error);
		return undefined;
	}
}

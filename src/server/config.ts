import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Config } from "../config/types.ts";

const configPath = process.env.LIME_CONFIG;
const userConfigUrl = configPath
	? pathToFileURL(path.resolve(process.cwd(), configPath)).href
	: new URL("../../user_config.ts", import.meta.url).href;

let userConfig: Config | undefined;

if (configPath) {
	try {
		userConfig = (await import(userConfigUrl)).default;
	} catch (error) {
		throw new Error(
			`无法加载 LIME_CONFIG=${configPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
} else {
	try {
		userConfig = (await import(userConfigUrl)).default;
	} catch {
		console.log("使用默认配置");
	}
}

const config = userConfig || (await import("../config/default.ts")).default;

export default config;

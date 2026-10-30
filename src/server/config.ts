import type { Config } from "../config/types.ts";

const userConfigUrl = new URL("../../user_config.ts", import.meta.url);

let userConfig: Config | undefined;

try {
	userConfig = (await import(userConfigUrl.href)).default;
} catch {
	console.log("使用默认配置");
}

const config = userConfig || (await import("../config/default.ts")).default;

export default config;

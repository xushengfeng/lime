import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.ts";

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			include: ["bench/**/*.test.ts"],
			testTimeout: 600_000,
			hookTimeout: 600_000,
			pool: "forks",
			fileParallelism: false,
		},
	}),
);

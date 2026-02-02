import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const i: Record<string, string> = {};
for (const x of readdirSync(__dirname)) {
	if (x.endsWith(".html")) {
		const name = x === "index.html" ? "main" : x.replace(".html", "");
		i[name] = resolve(__dirname, x);
	}
}

export default defineConfig({
	build: {
		rollupOptions: {
			input: i,
		},
	},
});

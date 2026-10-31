import { serve } from "@hono/node-server";
import { parseArgs } from "node:util";
import app from "./app.ts";

const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	options: {
		port: { type: "string", short: "p" },
		host: { type: "string" },
	},
	allowPositionals: true,
});

const port =
	Number(values.port ?? positionals[0] ?? process.env.PORT) || 5000;
const hostname =
	values.host ?? process.env.HOST ?? "0.0.0.0";

serve({ fetch: app.fetch, port, hostname }, (info) => {
	console.log(`LIME 服务器已启动: http://localhost:${info.port}`);
});

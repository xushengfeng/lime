import { serve } from "@hono/node-server";
import app from "./app.ts";

const port = Number(process.env.PORT) || 5000;
const hostname = process.env.HOST || "0.0.0.0";

serve({ fetch: app.fetch, port, hostname }, (info) => {
	console.log(`LIME 服务器已启动: http://localhost:${info.port}`);
});

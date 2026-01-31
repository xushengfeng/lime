import { type Context, Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { verifyKey } from "./key.ts";
import type { Config } from "./utils/config.d.ts";

let userConfig: Config | undefined;

try {
	userConfig = (await import("./user_config.ts")).default;
} catch {
	console.log("使用默认配置");
}

const config = userConfig || (await import("./config.ts")).default;

const { single_ci, commit, getUserData } = config.runner;

const app = new Hono();

app.use("*", logger());
app.use(
	"/*",
	bearerAuth({
		verifyToken: (t) => {
			return verifyKey(t);
		},
	}),
);

app.post("/candidates", async (c) => {
	const body = await c.req.json<{ keys?: string }>();
	const keys = body.keys || "";

	console.log(keys);

	const pinyinInput = config.key2ZiInd(keys);
	const result = await single_ci(pinyinInput);

	return c.json(result);
});

app.post("/commit", async (c) => {
	try {
		const body = await c.req.json();
		const text = body.text || "";
		const isNew = body.new ?? true;
		const shouldUpdate = body.update ?? false;

		if (!text) {
			throw new HTTPException(400, { message: "未提供文本内容" });
		}

		await commit(text, shouldUpdate, isNew);

		return c.json({
			message: "文本提交成功",
		});
	} catch (error) {
		if (error instanceof HTTPException) throw error;
		console.error("提交文本失败:", error);
		throw new HTTPException(400, { message: "请求数据格式错误" });
	}
});

app.get("/userdata", (c) => {
	return c.json(getUserData());
});

export default app;

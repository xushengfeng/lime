import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { serveStatic } from "hono/deno";
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

const { single_ci, commit, getUserData, addUserWord } = config.runner;

function arrayLimtPush<T>(arr: T[], item: T, maxLen: number) {
	arr.push(item);
	if (arr.length <= maxLen) return;
	for (let i = 0; i < arr.length - maxLen; i++) {
		arr.shift();
	}
}

const inputLogMaxLen = 10 ** 5;
export const inputLog: {
	keyDeltaTimes: Array<number>;
	lastKeyTime: number | null;
	ziDeltaTimes: Array<number>;
	lastZiTime: number | null;
	lastCandidates: {
		time: number;
		candidates: string[];
	};
	offsetTimes: Record<number, Array<number>>;
} = {
	keyDeltaTimes: [],
	lastKeyTime: null,
	ziDeltaTimes: [],
	lastZiTime: null,
	lastCandidates: {
		time: 0,
		candidates: [],
	},
	offsetTimes: {},
};

try {
	const words = Deno.readTextFileSync(config.userWordsPath)
		.split("\n")
		.filter((w) => w.trim());
	const textEncoder = new TextEncoder();
	for (const [i, w] of words.entries()) {
		addUserWord(w);
		Deno.stdout.writeSync(
			textEncoder.encode(
				`加载用户词 ${(((i + 1) / words.length) * 100).toFixed(2)}%\r`,
			),
		);
	}
	console.log(`\n加载用户词完成，数量 ${words.length}`);
} catch {
	//
}

const app = new Hono();
const api = new Hono();
api.use(
	"/*",
	bearerAuth({
		verifyToken: (t) => {
			return verifyKey(t);
		},
	}),
);

api.use("*", logger());

api.post("/candidates", async (c) => {
	const body = await c.req.json<{ keys?: string }>();
	const keys = body.keys || "";

	console.log(keys);
	const time = Date.now();
	if (inputLog.lastKeyTime === null || keys.length === 1) {
		inputLog.lastKeyTime = time;
		inputLog.lastZiTime = time;
	} else {
		arrayLimtPush(
			inputLog.keyDeltaTimes,
			time - inputLog.lastKeyTime,
			inputLogMaxLen,
		);
		inputLog.lastKeyTime = time;
	}

	const pinyinInput = config.key2ZiInd(keys);
	const result = await single_ci(pinyinInput);

	if (result.candidates.length <= 1) {
		inputLog.lastZiTime = null;
	} else
		inputLog.lastCandidates = {
			time,
			candidates: result.candidates.map((c) => c.word),
		};

	return c.json(result);
});

api.post("/commit", async (c) => {
	try {
		const body = await c.req.json();
		const text = body.text || "";
		const isNew = body.new ?? true;
		const shouldUpdate = body.update ?? false;

		if (!text) {
			throw new HTTPException(400, { message: "未提供文本内容" });
		}

		const newT = await commit(text, shouldUpdate, isNew);

		if (isNew) {
			if (inputLog.lastZiTime !== null)
				arrayLimtPush(
					inputLog.ziDeltaTimes,
					(Date.now() - inputLog.lastZiTime) / text.length,
					inputLogMaxLen,
				);
			inputLog.lastZiTime = null;
			inputLog.lastKeyTime = null;
		}
		{
			const offset = inputLog.lastCandidates.candidates.indexOf(newT ?? "");
			if (offset !== -1 && inputLog.lastCandidates.time !== 0) {
				const time = Date.now();
				const ofts = inputLog.offsetTimes[offset] || [];
				arrayLimtPush(
					ofts,
					time - inputLog.lastCandidates.time,
					inputLogMaxLen,
				);
				inputLog.offsetTimes[offset] = ofts;
			}
			inputLog.lastCandidates = {
				time: 0,
				candidates: [],
			};
		}

		return c.json({
			message: "文本提交成功",
		});
	} catch (error) {
		if (error instanceof HTTPException) throw error;
		console.error("提交文本失败:", error);
		throw new HTTPException(400, { message: "请求数据格式错误" });
	}
});

api.get("/userdata", (c) => {
	return c.json(getUserData());
});

api.get("/inputlog", (c) => {
	return c.json(inputLog);
});

api.post("/learntext", async (c) => {
	const body = await c.req.text();
	await commit(body, true, true);
	return c.json({
		message: "文本提交成功",
	});
});

try {
	Deno.statSync("./interface/dist");
} catch {
	console.log(
		"没有构建前端，一些服务器页面可能不显示（不影响输入法），如果需要，运行：\ndeno run install_interface\ndeno run build_interface\n然后重启服务器",
	);
}

app.use(
	"*",
	cors({
		origin: "*",
	}),
);

app.use("/*", serveStatic({ root: "./interface/dist" }));

app.route("/api", api);

app.post("/candidates", (c) => {
	return api.fetch(c.req.raw);
});

app.post("/commit", (c) => {
	return api.fetch(c.req.raw);
});

export default app;

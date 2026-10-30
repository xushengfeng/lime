import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isMain } from "../shared/is-main.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.join(__dirname, "../../key.txt");

/**
 * 生成随机 key（URL-safe）并返回字符串。
 */
function generateKey(nBytes: number = 32): string {
	const randomBytes = new Uint8Array(nBytes);
	crypto.getRandomValues(randomBytes);
	return Buffer.from(randomBytes).toString("base64url");
}

/**
 * 对 key 做 SHA-256 并返回 hex 哈希。
 */
async function hashKey(key: string): Promise<string> {
	const data = new TextEncoder().encode(key);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);

	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function isNotFound(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

/**
 * 将哈希追加到文件（每行一个），如果已存在则不重复写入。
 */
async function saveHash(
	hashHex: string,
	keyPath: string = KEY_FILE,
): Promise<void> {
	const existing = new Set<string>();

	try {
		const content = await readFile(keyPath, "utf8");
		content.split("\n").forEach((line) => {
			const trimmed = line.trim();
			if (trimmed) existing.add(trimmed);
		});
	} catch (error) {
		if (!isNotFound(error)) {
			throw error;
		}
	}

	if (existing.has(hashHex)) {
		return;
	}

	await mkdir(path.dirname(keyPath), { recursive: true });
	await appendFile(keyPath, `${hashHex}\n`);
}

/**
 * 判断给定 key 的哈希是否存在于 key.txt 中。
 */
export async function verifyKey(
	key: string,
	keyPath: string = KEY_FILE,
): Promise<boolean> {
	try {
		const hashHex = await hashKey(key);

		try {
			const content = await readFile(keyPath, "utf8");
			return content.split("\n").some((line) => line.trim() === hashHex);
		} catch (error) {
			if (isNotFound(error)) {
				return false;
			}
			throw error;
		}
	} catch (error) {
		console.error("验证 key 失败:", error);
		return false;
	}
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			verify: { type: "string", short: "v" },
		},
	});

	if (values.verify) {
		const ok = await verifyKey(values.verify);
		if (ok) {
			console.log("Valid: key 的哈希存在于 key.txt。");
		} else {
			console.log("Invalid: key 的哈希不在 key.txt。");
		}
	} else {
		const key = generateKey();
		console.log("Generated key:", key);
		const h = await hashKey(key);
		await saveHash(h);
		console.log("Saved SHA-256 hash to", KEY_FILE);
	}
}

if (isMain(import.meta.url)) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}

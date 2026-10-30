import { parseArgs } from "node:util";
import { isMain } from "../shared/is-main.ts";
import {
	decryptJsonWithKey,
	deriveHiaeKey,
	encryptJson,
	type SecurePayload,
} from "../crypto/secure_payload.ts";

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}

async function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			key: { type: "string" },
			mode: { type: "string", default: "encrypt" },
		},
	});
	const key = values.key;
	if (!key) {
		console.error("missing --key");
		process.exit(2);
	}

	const input = await readStdin();
	const hiaeKey = await deriveHiaeKey(key);

	if (values.mode === "encrypt") {
		console.log(JSON.stringify(encryptJson(JSON.parse(input), hiaeKey)));
		return;
	}

	if (values.mode === "decrypt") {
		const value = decryptJsonWithKey<unknown>(
			JSON.parse(input) as SecurePayload,
			hiaeKey,
		);
		if (value === null) {
			console.error("HiAE decrypt failed");
			process.exit(1);
		}
		console.log(JSON.stringify(value));
		return;
	}

	console.error(`unknown --mode: ${values.mode}`);
	process.exit(2);
}

if (isMain(import.meta.url)) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}

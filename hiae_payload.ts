import { parseArgs } from "@std/cli/parse-args";
import {
  decryptJsonWithKey,
  deriveHiaeKey,
  encryptJson,
  type SecurePayload,
} from "./utils/secure_payload.ts";

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Deno.stdin.readable) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["key", "mode"],
    default: { mode: "encrypt" },
  });
  const key = args.key;
  if (!key) {
    console.error("missing --key");
    Deno.exit(2);
  }

  const input = await readStdin();
  const hiaeKey = await deriveHiaeKey(key);

  if (args.mode === "encrypt") {
    console.log(JSON.stringify(encryptJson(JSON.parse(input), hiaeKey)));
    return;
  }

  if (args.mode === "decrypt") {
    const value = decryptJsonWithKey<unknown>(
      JSON.parse(input) as SecurePayload,
      hiaeKey,
    );
    if (value === null) {
      console.error("HiAE decrypt failed");
      Deno.exit(1);
    }
    console.log(JSON.stringify(value));
    return;
  }

  console.error(`unknown --mode: ${args.mode}`);
  Deno.exit(2);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    Deno.exit(1);
  });
}

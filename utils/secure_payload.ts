import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeBase64Url, encodeBase64Url } from "@std/encoding/base64url";
import { decrypt, encrypt, NONCE_SIZE, TAG_SIZE } from "./hiae/index.ts";

export const HIAE_ENCRYPTION_HEADER = "X-Lime-Encryption";
export const HIAE_ENCRYPTION_VERSION = "hiae-v1";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.join(__dirname, "..", "key.txt");

export interface SecurePayload {
  v: typeof HIAE_ENCRYPTION_VERSION;
  n: string;
  ct: string;
  tag: string;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("invalid key hash");
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function sha256Bytes(text: string): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(text),
  );
  return new Uint8Array(hashBuffer);
}

export async function deriveHiaeKey(secret: string): Promise<Uint8Array> {
  return await sha256Bytes(secret);
}

export async function readSavedHiaeKeys(
  keyPath: string = KEY_FILE,
): Promise<Uint8Array[]> {
  let content: string;
  try {
    content = await Deno.readTextFile(keyPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(hexToBytes);
}

export function encryptJson(
  value: unknown,
  key: Uint8Array,
): SecurePayload {
  const nonce = new Uint8Array(NONCE_SIZE);
  crypto.getRandomValues(nonce);
  const plaintext = encoder.encode(JSON.stringify(value));
  const { ciphertext, tag } = encrypt(plaintext, new Uint8Array(0), key, nonce);
  return {
    v: HIAE_ENCRYPTION_VERSION,
    n: encodeBase64Url(nonce),
    ct: encodeBase64Url(ciphertext),
    tag: encodeBase64Url(tag),
  };
}

export function decryptJsonWithKey<T>(
  payload: SecurePayload,
  key: Uint8Array,
): T | null {
  if (payload.v !== HIAE_ENCRYPTION_VERSION) return null;

  const nonce = decodeBase64Url(payload.n);
  const ciphertext = decodeBase64Url(payload.ct);
  const tag = decodeBase64Url(payload.tag);
  if (nonce.length !== NONCE_SIZE || tag.length !== TAG_SIZE) return null;

  const plaintext = decrypt(
    ciphertext,
    tag,
    new Uint8Array(0),
    key,
    nonce,
  );
  if (plaintext === null) return null;

  return JSON.parse(decoder.decode(plaintext)) as T;
}

export async function decryptJsonWithSavedKeys<T>(
  payload: SecurePayload,
  keyPath?: string,
): Promise<T | null> {
  const result = await decryptJsonWithSavedKey<T>(payload, keyPath);
  return result?.value ?? null;
}

export async function decryptJsonWithSavedKey<T>(
  payload: SecurePayload,
  keyPath?: string,
): Promise<{ value: T; key: Uint8Array } | null> {
  const keys = await readSavedHiaeKeys(keyPath);
  for (const key of keys) {
    try {
      const value = decryptJsonWithKey<T>(payload, key);
      if (value !== null) return { value, key };
    } catch {
      //
    }
  }
  return null;
}

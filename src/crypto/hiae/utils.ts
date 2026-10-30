import { BLOCK_SIZE, type Block } from "./types.ts";

/**
 * Returns the little-endian encoding of unsigned 64-bit integer
 */
export function LE64(x: bigint): Uint8Array {
  const result = new Uint8Array(8);
  const low = Number(x & 0xffffffffn);
  const high = Number((x >> 32n) & 0xffffffffn);

  result[0] = low & 0xff;
  result[1] = (low >> 8) & 0xff;
  result[2] = (low >> 16) & 0xff;
  result[3] = (low >> 24) & 0xff;
  result[4] = high & 0xff;
  result[5] = (high >> 8) & 0xff;
  result[6] = (high >> 16) & 0xff;
  result[7] = (high >> 24) & 0xff;

  return result;
}

/**
 * Returns x after appending zeros until its length is a multiple of n bits
 */
export function zeroPad(x: Uint8Array, nBits: number): Uint8Array {
  const nBytes = nBits / 8;
  const currentLength = x.length;
  const targetLength = Math.ceil(currentLength / nBytes) * nBytes;

  if (currentLength === targetLength) {
    return x;
  }

  const result = new Uint8Array(targetLength);
  result.set(x);
  return result;
}

/**
 * Returns the first n bits of x
 */
export function truncate(x: Uint8Array, nBits: number): Uint8Array {
  const nBytes = Math.floor(nBits / 8);
  const remainingBits = nBits % 8;

  if (remainingBits === 0) {
    return x.slice(0, nBytes);
  }

  const result = new Uint8Array(nBytes + 1);
  result.set(x.slice(0, nBytes));
  if (nBytes < x.length) {
    result[nBytes] = x[nBytes] & ((1 << remainingBits) - 1);
  }
  return result.slice(0, Math.ceil(nBits / 8));
}

/**
 * Returns the last n bits of x
 */
export function tail(x: Uint8Array, nBits: number): Uint8Array {
  const totalBits = x.length * 8;
  const startBit = totalBits - nBits;
  const startByte = Math.floor(startBit / 8);
  const startOffset = startBit % 8;

  if (startOffset === 0) {
    return x.slice(startByte);
  }

  const nBytes = Math.ceil(nBits / 8);
  const result = new Uint8Array(nBytes);

  for (let i = 0; i < nBytes; i++) {
    if (startByte + i < x.length) {
      result[i] = x[startByte + i] >> startOffset;
      if (startByte + i + 1 < x.length) {
        result[i] |= x[startByte + i + 1] << (8 - startOffset);
      }
    }
  }

  return result;
}

/**
 * Compares a and b in constant-time
 */
export function ctEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }

  return diff === 0;
}

/**
 * XOR two byte arrays
 */
export function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length);
  const len = a.length;

  // Process 4 bytes at a time
  const len4 = len & ~3;
  for (let i = 0; i < len4; i += 4) {
    result[i] = a[i] ^ b[i];
    result[i + 1] = a[i + 1] ^ b[i + 1];
    result[i + 2] = a[i + 2] ^ b[i + 2];
    result[i + 3] = a[i + 3] ^ b[i + 3];
  }

  // Process remaining bytes
  for (let i = len4; i < len; i++) {
    result[i] = a[i] ^ b[i];
  }

  return result;
}

/**
 * XOR two byte arrays in-place (stores result in first array)
 */
export function xor_inplace(a: Uint8Array, b: Uint8Array): void {
  const len = a.length;

  // Process 4 bytes at a time
  const len4 = len & ~3;
  for (let i = 0; i < len4; i += 4) {
    a[i] ^= b[i];
    a[i + 1] ^= b[i + 1];
    a[i + 2] ^= b[i + 2];
    a[i + 3] ^= b[i + 3];
  }

  // Process remaining bytes
  for (let i = len4; i < len; i++) {
    a[i] ^= b[i];
  }
}

/**
 * XOR three byte arrays
 */
export function xor3(a: Uint8Array, b: Uint8Array, c: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length);
  const len = a.length;

  // Process 4 bytes at a time
  const len4 = len & ~3;
  for (let i = 0; i < len4; i += 4) {
    result[i] = a[i] ^ b[i] ^ c[i];
    result[i + 1] = a[i + 1] ^ b[i + 1] ^ c[i + 1];
    result[i + 2] = a[i + 2] ^ b[i + 2] ^ c[i + 2];
    result[i + 3] = a[i + 3] ^ b[i + 3] ^ c[i + 3];
  }

  // Process remaining bytes
  for (let i = len4; i < len; i++) {
    result[i] = a[i] ^ b[i] ^ c[i];
  }

  return result;
}

/**
 * Create a new block filled with zeros
 */
export function zeroBlock(): Block {
  return new Uint8Array(BLOCK_SIZE);
}

/**
 * Clone a block
 */
export function cloneBlock(block: Block): Block {
  return new Uint8Array(block);
}

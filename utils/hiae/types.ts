export type Block = Uint8Array; // 128-bit (16 bytes) AES block
export type State = Block[]; // 16 blocks of 128 bits each

export interface HiAEParams {
  key: Uint8Array; // 256 bits (32 bytes)
  nonce: Uint8Array; // 128 bits (16 bytes)
}

export interface EncryptResult {
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export const BLOCK_SIZE = 16; // 128 bits in bytes
export const KEY_SIZE = 32; // 256 bits in bytes
export const NONCE_SIZE = 16; // 128 bits in bytes
export const TAG_SIZE = 16; // 128 bits in bytes
export const STATE_BLOCKS = 16; // Number of 128-bit blocks in state

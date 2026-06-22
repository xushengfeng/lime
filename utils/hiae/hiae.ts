import { AESL_inplace } from "./aes.ts";
import { C0, C1 } from "./constants.ts";
import {
  BLOCK_SIZE,
  type Block,
  type EncryptResult,
  KEY_SIZE,
  NONCE_SIZE,
  STATE_BLOCKS,
  type State,
} from "./types.ts";
import {
  cloneBlock,
  ctEq,
  LE64,
  tail,
  truncate,
  xor,
  xor_inplace,
  zeroBlock,
  zeroPad,
} from "./utils.ts";

/**
 * HiAE state class managing the 2048-bit internal state
 */
export class HiAEState {
  private state: State;
  // Pre-allocated work buffers to avoid allocations in hot paths
  private workBuffer1: Uint8Array;
  private workBuffer2: Uint8Array;

  constructor() {
    this.state = new Array(STATE_BLOCKS);
    for (let i = 0; i < STATE_BLOCKS; i++) {
      this.state[i] = zeroBlock();
    }
    this.workBuffer1 = new Uint8Array(BLOCK_SIZE);
    this.workBuffer2 = new Uint8Array(BLOCK_SIZE);
  }

  /**
   * State rotation function - rotates blocks one position to the left
   */
  private rol(): void {
    const temp = this.state[0];
    for (let i = 0; i < STATE_BLOCKS - 1; i++) {
      this.state[i] = this.state[i + 1];
    }
    this.state[STATE_BLOCKS - 1] = temp;
  }

  /**
   * Core update function
   */
  private update(xi: Block): void {
    // Use work buffer for intermediate calculations
    this.workBuffer1.set(this.state[0]);
    xor_inplace(this.workBuffer1, this.state[1]);
    AESL_inplace(this.workBuffer1);
    xor_inplace(this.workBuffer1, xi);

    // Update state[0]
    this.workBuffer2.set(this.state[13]);
    AESL_inplace(this.workBuffer2);
    xor_inplace(this.workBuffer2, this.workBuffer1);

    // Store result and update other state blocks
    const temp = this.state[0];
    this.state[0] = this.workBuffer2;
    this.workBuffer2 = temp; // Reuse the old state[0] buffer

    xor_inplace(this.state[3], xi);
    xor_inplace(this.state[13], xi);
    this.rol();
  }

  /**
   * Update function with encryption
   */
  private updateEnc(mi: Block): Block {
    // Use work buffer for intermediate calculations
    this.workBuffer1.set(this.state[0]);
    xor_inplace(this.workBuffer1, this.state[1]);
    AESL_inplace(this.workBuffer1);
    xor_inplace(this.workBuffer1, mi);

    // Calculate ciphertext
    const ci = xor(this.workBuffer1, this.state[9]);

    // Update state[0]
    this.workBuffer2.set(this.state[13]);
    AESL_inplace(this.workBuffer2);
    xor_inplace(this.workBuffer2, this.workBuffer1);

    // Store result and update other state blocks
    const temp = this.state[0];
    this.state[0] = this.workBuffer2;
    this.workBuffer2 = temp; // Reuse the old state[0] buffer

    xor_inplace(this.state[3], mi);
    xor_inplace(this.state[13], mi);
    this.rol();

    return ci;
  }

  /**
   * Update function with decryption
   */
  private updateDec(ci: Block): Block {
    // Calculate t
    this.workBuffer1.set(ci);
    xor_inplace(this.workBuffer1, this.state[9]);

    // Calculate mi
    this.workBuffer2.set(this.state[0]);
    xor_inplace(this.workBuffer2, this.state[1]);
    AESL_inplace(this.workBuffer2);
    const mi = xor(this.workBuffer2, this.workBuffer1);

    // Update state[0]
    this.workBuffer2.set(this.state[13]);
    AESL_inplace(this.workBuffer2);
    xor_inplace(this.workBuffer2, this.workBuffer1);

    // Store result and update other state blocks
    const temp = this.state[0];
    this.state[0] = this.workBuffer2;
    this.workBuffer2 = temp; // Reuse the old state[0] buffer

    xor_inplace(this.state[3], mi);
    xor_inplace(this.state[13], mi);
    this.rol();

    return mi;
  }

  /**
   * Diffuse function - performs 32 update rounds, alternating between x0 and x1
   */
  private diffuse(x0: Block, x1: Block): void {
    for (let i = 0; i < 16; i++) {
      this.update(x0);
      this.update(x1);
    }
  }

  /**
   * Initialize state with key and nonce
   */
  init(key: Uint8Array, nonce: Uint8Array): void {
    if (key.length !== KEY_SIZE) {
      throw new Error(`Invalid key size: expected ${KEY_SIZE} bytes, got ${key.length}`);
    }
    if (nonce.length !== NONCE_SIZE) {
      throw new Error(`Invalid nonce size: expected ${NONCE_SIZE} bytes, got ${nonce.length}`);
    }

    const k0 = key.slice(0, 16);
    const k1 = key.slice(16, 32);

    // Initialize state blocks
    this.state[0] = cloneBlock(C0);
    this.state[1] = cloneBlock(k0);
    this.state[2] = cloneBlock(C0);
    this.state[3] = cloneBlock(nonce);
    this.state[4] = zeroBlock();
    this.state[5] = cloneBlock(k0);
    this.state[6] = zeroBlock();
    this.state[7] = cloneBlock(C1);
    this.state[8] = cloneBlock(k1);
    this.state[9] = zeroBlock();
    this.state[10] = xor(nonce, k1);
    this.state[11] = cloneBlock(C0);
    this.state[12] = cloneBlock(C1);
    this.state[13] = cloneBlock(k1);
    this.state[14] = zeroBlock();
    this.state[15] = xor(C0, C1);

    // Diffuse with k0 and k1
    this.diffuse(k0, k1);
  }

  /**
   * Absorb a block of associated data
   */
  absorb(ai: Block): void {
    this.update(ai);
  }

  /**
   * Encrypt a block
   */
  enc(mi: Block): Block {
    return this.updateEnc(mi);
  }

  /**
   * Decrypt a block
   */
  dec(ci: Block): Block {
    return this.updateDec(ci);
  }

  /**
   * Decrypt a partial block
   */
  decPartial(cn: Uint8Array): Uint8Array {
    const cnPadded = zeroPad(cn, 128);

    // Calculate keystream using work buffers
    this.workBuffer1.set(this.state[0]);
    xor_inplace(this.workBuffer1, this.state[1]);
    AESL_inplace(this.workBuffer1);
    xor_inplace(this.workBuffer1, cnPadded);
    const ks = xor(this.workBuffer1, this.state[9]);

    const ci = new Uint8Array(BLOCK_SIZE);
    ci.set(cn);
    ci.set(tail(ks, 128 - cn.length * 8), cn.length);

    const mi = this.updateDec(ci);
    return truncate(mi, cn.length * 8);
  }

  /**
   * Finalize and produce authentication tag
   */
  finalize(adLenBits: bigint, msgLenBits: bigint): Block {
    const lenBlock = new Uint8Array(BLOCK_SIZE);
    lenBlock.set(LE64(adLenBits), 0);
    lenBlock.set(LE64(msgLenBits), 8);

    this.diffuse(lenBlock, lenBlock);

    // XOR all state blocks to produce tag
    const tag = cloneBlock(this.state[0]);
    for (let i = 1; i < STATE_BLOCKS; i++) {
      xor_inplace(tag, this.state[i]);
    }

    return tag;
  }
}

/**
 * Encrypt a message with associated data
 */
export function encrypt(
  msg: Uint8Array,
  ad: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
): EncryptResult {
  const state = new HiAEState();
  state.init(key, nonce);

  // Process associated data directly without intermediate arrays
  const paddedAd = zeroPad(ad, 128);
  const adNumBlocks = paddedAd.length / BLOCK_SIZE;
  for (let i = 0; i < adNumBlocks; i++) {
    const blockStart = i * BLOCK_SIZE;
    state.absorb(paddedAd.subarray(blockStart, blockStart + BLOCK_SIZE));
  }

  // Process message directly and write to output buffer
  const paddedMsg = zeroPad(msg, 128);
  const msgNumBlocks = paddedMsg.length / BLOCK_SIZE;
  const ct = new Uint8Array(msgNumBlocks * BLOCK_SIZE);

  for (let i = 0; i < msgNumBlocks; i++) {
    const blockStart = i * BLOCK_SIZE;
    const encrypted = state.enc(paddedMsg.subarray(blockStart, blockStart + BLOCK_SIZE));
    ct.set(encrypted, i * BLOCK_SIZE);
  }

  // Finalize and get tag
  const tag = state.finalize(BigInt(ad.length * 8), BigInt(msg.length * 8));

  // Truncate ciphertext to original message length
  const truncatedCt = truncate(ct, msg.length * 8);

  return { ciphertext: truncatedCt, tag };
}

/**
 * Decrypt a ciphertext with associated data and verify authentication tag
 */
export function decrypt(
  ct: Uint8Array,
  tag: Uint8Array,
  ad: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
): Uint8Array | null {
  const state = new HiAEState();
  state.init(key, nonce);

  // Process associated data directly without intermediate arrays
  const paddedAd = zeroPad(ad, 128);
  const adNumBlocks = paddedAd.length / BLOCK_SIZE;
  for (let i = 0; i < adNumBlocks; i++) {
    const blockStart = i * BLOCK_SIZE;
    state.absorb(paddedAd.subarray(blockStart, blockStart + BLOCK_SIZE));
  }

  // Allocate output buffer
  const msg = new Uint8Array(ct.length);

  // Process full blocks directly
  const fullBlocks = Math.floor(ct.length / BLOCK_SIZE);
  for (let i = 0; i < fullBlocks; i++) {
    const blockStart = i * BLOCK_SIZE;
    const decrypted = state.dec(ct.subarray(blockStart, blockStart + BLOCK_SIZE));
    msg.set(decrypted, blockStart);
  }

  // Handle partial block if present
  const partialBytes = ct.length % BLOCK_SIZE;
  if (partialBytes > 0) {
    const cn = tail(ct, partialBytes * 8);
    const decrypted = state.decPartial(cn);
    msg.set(decrypted.subarray(0, partialBytes), fullBlocks * BLOCK_SIZE);
  }

  // Finalize and verify tag
  const expectedTag = state.finalize(BigInt(ad.length * 8), BigInt(ct.length * 8));

  if (!ctEq(tag, expectedTag)) {
    // Clear sensitive data
    msg.fill(0);
    return null;
  }

  return msg;
}

/**
 * Generate keystream (stream cipher mode)
 */
export function stream(len: number, key: Uint8Array, nonce?: Uint8Array): Uint8Array {
  if (len === 0) {
    return new Uint8Array(0);
  }

  const actualNonce = nonce || new Uint8Array(NONCE_SIZE);
  const { ciphertext } = encrypt(new Uint8Array(len), new Uint8Array(0), key, actualNonce);
  return ciphertext;
}

/**
 * Generate MAC (authentication only mode)
 */
export function mac(data: Uint8Array, key: Uint8Array, nonce: Uint8Array): Uint8Array {
  const state = new HiAEState();
  state.init(key, nonce);

  // Process data directly without intermediate arrays
  const paddedData = zeroPad(data, 128);
  const numBlocks = paddedData.length / BLOCK_SIZE;
  for (let i = 0; i < numBlocks; i++) {
    const blockStart = i * BLOCK_SIZE;
    state.absorb(paddedData.subarray(blockStart, blockStart + BLOCK_SIZE));
  }

  // Finalize with data length and zero message length
  return state.finalize(BigInt(data.length * 8), 0n);
}

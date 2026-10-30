import type { LlamaModel, Token } from "node-llama-cpp";

export type ZiIndFunc = (zici: string) => string[][];

export type ZiIndDefinition = {
	trans: ZiIndFunc;
	allSymbol: Set<string>;
};

export type TokenPinyin = string[][];

const EMPTY_TOKEN_SET: Set<number> = new Set();

/**
 * 模型词表上的不可变拼音索引。
 * 多个算法可以共享同一个实例，避免重复遍历全部 token。
 */
export class TokenIndexBase {
	readonly tokenPinyin = new Map<number, TokenPinyin>();
	readonly firstPinyinToken = new Map<string, Set<number>>();
	readonly unindexedZi = new Map<string, Set<string>>();
	readonly nextTokenId: number;

	constructor(model: LlamaModel, ziInd: ZiIndDefinition) {
		const { trans } = ziInd;
		const allSymbol = new Set(ziInd.allSymbol);

		let max = 0;
		for (const token_id of model.iterateAllTokens()) {
			max = Math.max(max, token_id);
		}
		this.nextTokenId = max + 1;

		for (const token_id of model.iterateAllTokens()) {
			const token = model.detokenize([token_id]);
			if (!token) continue;
			const pinyins = trans(token);
			allSymbol.delete(token);
			if (pinyins.length) {
				this.tokenPinyin.set(token_id, pinyins);
				for (const fp of pinyins[0]) {
					const s = this.firstPinyinToken.get(fp) ?? new Set();
					s.add(token_id);
					this.firstPinyinToken.set(fp, s);
				}
			}
		}

		for (const zi of allSymbol) {
			const pys = trans(zi);
			if (pys.length === 1) {
				for (const py of pys[0]) {
					const s = this.unindexedZi.get(py) ?? new Set();
					s.add(zi);
					this.unindexedZi.set(py, s);
				}
			}
		}

		if (allSymbol.size > 0) {
			console.log(
				"以下字未直接建立拼音索引:",
				Array.from(allSymbol).slice(0, 10).join(" "),
				"等",
			);
		}
	}
}

/**
 * 每个输入法实例自己的索引：共享基础词表，叠加用户词。
 */
export class TokenIndex {
	readonly base: TokenIndexBase;
	private readonly model: LlamaModel;
	private nextTokenId: number;

	private userTokens = new Map<number, Token[]>();
	private userPinyin = new Map<number, TokenPinyin>();
	private userFirstPinyin = new Map<string, Set<number>>();

	constructor(model: LlamaModel, ziInd: ZiIndDefinition | TokenIndexBase) {
		this.model = model;
		this.base =
			ziInd instanceof TokenIndexBase
				? ziInd
				: new TokenIndexBase(model, ziInd);
		this.nextTokenId = this.base.nextTokenId;
	}

	pinyinOf(tokenId: number): TokenPinyin | undefined {
		return this.userPinyin.get(tokenId) ?? this.base.tokenPinyin.get(tokenId);
	}

	firstTokens(pinyin: string): Set<number> {
		const base = this.base.firstPinyinToken.get(pinyin) ?? EMPTY_TOKEN_SET;
		const user = this.userFirstPinyin.get(pinyin);
		if (!user) return base;
		if (base.size === 0) return user;
		return new Set([...base, ...user]);
	}

	unindexed(pinyin: string): Set<string> | undefined {
		return this.base.unindexedZi.get(pinyin);
	}

	expandToken(tokenId: number): Token[] | undefined {
		return this.userTokens.get(tokenId);
	}

	get userTokenIds(): Iterable<number> {
		return this.userTokens.keys();
	}

	get userWords(): Map<number, Token[]> {
		return this.userTokens;
	}

	checkAddUserWord(word: string): boolean {
		const ts = this.model.tokenizer(word);
		if (ts.length <= 1) return false;
		if (ts.some((i) => !this.pinyinOf(i))) return false;
		return true;
	}

	addUserWord(word: string): number | undefined {
		const ts = this.model.tokenizer(word);
		if (ts.length === 0) return undefined;

		const token_id = this.nextTokenId++;
		this.userTokens.set(token_id, ts);
		this.addUserTokenToIndex(token_id, ts);
		return token_id;
	}

	clearUserWords() {
		this.userTokens.clear();
		this.userPinyin.clear();
		this.userFirstPinyin.clear();
		this.nextTokenId = this.base.nextTokenId;
	}

	loadUserWords(words: Record<number, Token[]>) {
		this.clearUserWords();
		let maxId = this.base.nextTokenId - 1;
		for (const [key, tokens] of Object.entries(words)) {
			const id = Number(key);
			if (!Number.isFinite(id) || tokens.length === 0) continue;
			this.userTokens.set(id, tokens);
			this.addUserTokenToIndex(id, tokens);
			maxId = Math.max(maxId, id);
		}
		this.nextTokenId = maxId + 1;
	}

	private addUserTokenToIndex(token_id: number, ts: Token[]) {
		const pys = ts.flatMap((i) => this.pinyinOf(i) || []);
		this.userPinyin.set(token_id, pys);
		for (const fp of pys[0] ?? []) {
			const s = this.userFirstPinyin.get(fp) ?? new Set();
			s.add(token_id);
			this.userFirstPinyin.set(fp, s);
		}
	}
}

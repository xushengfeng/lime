export type Candidate = {
	word: string;
	score: number;
	pinyin: string[];
	remainkeys: string[];
	preedit: string;
	consumedkeys: number;
};

export type Result = {
	candidates: Candidate[];
};

export type UserData<TToken = unknown> = {
	words: Record<number, Array<number>>;
	context: Array<{ t: string; token: TToken }>;
};

export type InputLog = {
	keyDeltaTimes: Array<number>;
	lastKeyTime: number | null;
	ziDeltaTimes: Array<number>;
	lastZiTime: number | null;
	ziCount: number;
	lastCandidates: {
		time: number;
		candidates: string[];
	};
	offsetTimes: Record<number, Array<number>>;
	/** 与直接从模型获取记录不同，模型有上下文限制，这里记录所有输入的文本，供后续微调使用 */
	history: string;
};

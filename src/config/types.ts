import type { ZiIndL } from "../engine/key_map/zi_ind.ts";
import type { IMERunner } from "../engine/main.ts";

export type Config = {
	runner: IMERunner;
	key2ZiInd: (key: string) => ZiIndL;
	userWordsPath: string;
};

import type { ZiIndL } from "../key_map/zi_ind.ts";
import type { LIME } from "../main.ts";

export type Config = {
	runner: LIME;
	key2ZiInd: (key: string) => ZiIndL;
	userWordsPath: string;
};

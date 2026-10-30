import type { ZiIndL } from "../engine/key_map/zi_ind.ts";
import type { LIME } from "../engine/main.ts";

export type Config = {
	runner: LIME;
	key2ZiInd: (key: string) => ZiIndL;
	userWordsPath: string;
};

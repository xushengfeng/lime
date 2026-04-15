import type { Candidate } from "../main.ts";

/**
 * @param top 优先词表
 * @param insert 插入位置，必须要有一个
 */
export function resortFeq(
	top: string[],
	insert: { index?: number; score?: number },
) {
	return (candidates: Candidate[]) => {
		if (insert.score === undefined && insert.index === undefined)
			return candidates;
		let index = insert.index;
		if (index === undefined) {
			index = candidates.findIndex((c) => c.score <= (insert.score || 0));
			if (index === -1) index = Infinity;
		}
		const keepC = candidates.slice(0, index);
		const needResort = candidates.slice(index);
		const feqW = needResort.filter((c) => top.includes(c.word));
		const otherW = needResort.filter((c) => !top.includes(c.word));
		return [...keepC, ...feqW, ...otherW];
	};
}

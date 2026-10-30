import { expect, test } from "vitest";
import type { ZiIndAndKey } from "../../src/engine/key_map/zi_ind.ts";
import { ziid_in_ziid } from "../../src/engine/ziind_in_ziind.ts";

test("拼音匹配", () => {
	const p1: ZiIndAndKey[] = [
		{ ind: "ni", key: "", preeditShow: "" },
		{ ind: "hao", key: "", preeditShow: "" },
		{ ind: "wo", key: "", preeditShow: "" },
	];
	expect(ziid_in_ziid([p1], [["wo", "ni"]])).toEqual([p1[2]]);
	expect(ziid_in_ziid([p1], [["wo", "ni"], ["shi"]])).toBe(false); // <
	expect(ziid_in_ziid([p1, p1], [["wo", "ni"], ["shi"]])).toBe(false); // 不相等
	expect(
		ziid_in_ziid(
			[p1, p1],
			[
				["wo", "ni"],
				["ni", "wo"],
			],
		),
	).toEqual([p1[2], p1[0]]); // === 取首个匹配的
	expect(ziid_in_ziid([p1, p1], [["wo", "ni"]])).toEqual([p1[2]]); // 要匹配的在输入里面
});

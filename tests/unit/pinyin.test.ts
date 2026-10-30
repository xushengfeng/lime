import { expect, test } from "vitest";
import { generate_fuzzy_pinyin } from "../../src/engine/key_map/pinyin/fuzzy_pinyin.ts";
import { load_pinyin } from "../../src/engine/key_map/pinyin/gen_zi_pinyin.ts";
import { keys_to_pinyin } from "../../src/engine/key_map/pinyin/keys_to_pinyin.ts";
import { spilt_pinyin } from "../../src/engine/key_map/pinyin/split_pinyin.ts";

test("split pinyin", () => {
	expect(spilt_pinyin("ni")).toEqual(["n", "i"]);
	expect(spilt_pinyin("zhe")).toEqual(["zh", "e"]);
	expect(spilt_pinyin("zhang")).toEqual(["zh", "ang"]);
});

test("fuzzy pinyin", () => {
	expect(new Set(generate_fuzzy_pinyin("shang"))).toEqual(
		new Set(["shang", "shan", "san", "sang"]),
	);
	expect(
		new Set(generate_fuzzy_pinyin("er", { all: { er: "e", e: "er" } })),
	).toEqual(new Set(["er", "e"]));
});

test("拼音 常规", () => {
	const x = keys_to_pinyin("nihao");
	expect(x).toEqual([
		[{ ind: "ni", key: "ni", preeditShow: "ni" }],
		[{ ind: "hao", key: "hao", preeditShow: "hao" }],
	]);
});

test("拼音 部分", () => {
	const x = keys_to_pinyin("nihaow").at(-1);
	expect(x?.length ?? 0).toBeGreaterThan(0);
	const x1 = x?.find((v) => v.ind === "wo");
	expect(x1).toEqual({ key: "w", ind: "wo", preeditShow: "w" });
});

test("拼音 部分2", () => {
	const x = keys_to_pinyin("nihao", { shuangpin: "自然码" }).at(-1);
	expect(x?.length ?? 0).toBeGreaterThan(0);
	const x1 = x?.find((v) => v.ind === "ou");
	expect(x1).toEqual({ key: "o", ind: "ou", preeditShow: "o" });
});

test("拼音 部分3", () => {
	const x = keys_to_pinyin("a");
	expect(x).toEqual([
		[
			{ key: "a", ind: "a", preeditShow: "a" },
			{ key: "a", ind: "ang", preeditShow: "a" },
			{ key: "a", ind: "ai", preeditShow: "a" },
			{ key: "a", ind: "an", preeditShow: "a" },
			{ key: "a", ind: "ao", preeditShow: "a" },
			{ key: "a", ind: "a", preeditShow: "a" }, // todo 去重
		],
	]);
});

test("拼音 部分4", () => {
	const x = keys_to_pinyin("a").at(-1);
	expect(x?.length ?? 0).toBeGreaterThan(0);
	expect(x?.find((v) => v.ind === "a")).toEqual({
		key: "a",
		ind: "a",
		preeditShow: "a",
	});
	expect(x?.find((v) => v.ind === "ai")).toEqual({
		key: "a",
		ind: "ai",
		preeditShow: "a",
	});
	const x1 = keys_to_pinyin("tma", { shuangpin: "自然码" }).at(-1);
	expect(x1?.length ?? 0).toBeGreaterThan(0);
	expect(x1?.find((v) => v.ind === "a")).toEqual({
		key: "a",
		ind: "a",
		preeditShow: "a",
	});
	expect(x1?.find((v) => v.ind === "ai")).toEqual({
		key: "a",
		ind: "ai",
		preeditShow: "a",
	});
	const x2 = keys_to_pinyin("tmaa", { shuangpin: "自然码" }).at(-1);
	expect(x2?.length ?? 0).toBeGreaterThan(0);
	console.log(x2);

	expect(x2?.at(-1)).toEqual({ key: "aa", ind: "a", preeditShow: "a" });
});

test("拼音 分隔符", () => {
	const x = keys_to_pinyin("ni'");
	expect(x).toEqual([[{ key: "ni'", ind: "ni", preeditShow: "ni" }]]);
	const x1 = keys_to_pinyin("ni'hao'wo");
	expect(x1).toEqual([
		[{ key: "ni'", ind: "ni", preeditShow: "ni" }],
		[{ key: "hao'", ind: "hao", preeditShow: "hao" }],
		[{ key: "wo", ind: "wo", preeditShow: "wo" }],
	]);
});

test("双拼", () => {
	const x = keys_to_pinyin("xxxx", { shuangpin: "自然码" });
	expect(x).toEqual([
		[{ key: "xx", ind: "xie", preeditShow: "xie" }],
		[{ key: "xx", ind: "xie", preeditShow: "xie" }],
	]);
});

test("字转化拼音", () => {
	const pinyin = load_pinyin();
	const x = pinyin.trans("你好");
	expect(x).toEqual([["ni"], ["hao"]]);
});

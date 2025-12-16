import { assertEquals } from "jsr:@std/assert@1.0.16";
import { spilt_pinyin } from "../split_pinyin.ts";
import { generate_fuzzy_pinyin } from "../fuzzy_pinyin.ts";
import { keys_to_pinyin } from "../keys_to_pinyin.ts";
import { assert } from "jsr:@std/assert@1.0.16/assert";
import { load_pinyin } from "../gen_zi_pinyin.ts";

Deno.test("split pinyin", () => {
	assertEquals(spilt_pinyin("ni"), ["n", "i"]);
	assertEquals(spilt_pinyin("zhe"), ["zh", "e"]);
	assertEquals(spilt_pinyin("zhang"), ["zh", "ang"]);
});

Deno.test("fuzzy pinyin", () => {
	assertEquals(
		new Set(generate_fuzzy_pinyin("shang")),
		new Set(["shang", "shan", "san", "sang"]),
	);
});

Deno.test("拼音 常规", () => {
	const x = keys_to_pinyin("nihao", false);
	assertEquals(x, [
		[{ py: "ni", key: "ni", preeditShow: "ni" }],
		[{ py: "hao", key: "hao", preeditShow: "hao" }],
	]);
});

Deno.test("拼音 部分", () => {
	const x = keys_to_pinyin("nihaow", false).at(-1);
	assert((x?.length ?? 0) > 0);
	const x1 = x?.find((v) => v.py === "wo");
	assertEquals(x1, { key: "w", py: "wo", preeditShow: "w" });
});

Deno.test("拼音 部分2", () => {
	const x = keys_to_pinyin("nihao").at(-1);
	assert((x?.length ?? 0) > 0);
	const x1 = x?.find((v) => v.py === "ou");
	assertEquals(x1, { key: "o", py: "ou", preeditShow: "o" });
});

Deno.test("拼音 分隔符", () => {
	const x = keys_to_pinyin("ni'", false);
	assertEquals(x, [[{ key: "ni'", py: "ni", preeditShow: "ni" }]]);
	const x1 = keys_to_pinyin("ni'hao'wo", false);
	assertEquals(x1, [
		[{ key: "ni'", py: "ni", preeditShow: "ni" }],
		[{ key: "hao'", py: "hao", preeditShow: "hao" }],
		[{ key: "wo", py: "wo", preeditShow: "wo" }],
	]);
});

Deno.test("双拼", () => {
	const x = keys_to_pinyin("xxxx", true);
	assertEquals(x, [
		[{ key: "xx", py: "xie", preeditShow: "xie" }],
		[{ key: "xx", py: "xie", preeditShow: "xie" }],
	]);
});

Deno.test("字转化拼音", () => {
	const pinyin = load_pinyin();
	const x = pinyin("你好");
	assertEquals(x, [["ni"], ["hao"]]);
});

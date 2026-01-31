import path from "node:path";
import { fileURLToPath } from "node:url";
import { pinyin } from "pinyin-pro";
import { load_pinyin } from "../key_map/pinyin/gen_zi_pinyin.ts";
import { keys_to_pinyin } from "../key_map/pinyin/keys_to_pinyin.ts";
import { initLIME, type Result } from "../main.ts";
import { generate_pinyin } from "../key_map/pinyin/all_pinyin.ts";
import {
	shuangpinMaps,
	generate_shuang_pinyin,
} from "../key_map/pinyin/shuangpin.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputSpeedDataPath = path.join(__dirname, "input_speed_data.json");

type SpeedData = {
	offset: Record<number, number>;
	keyCount: number;
	bestCommitCount: number;
	textLength: number;
};

function logOffset(offset: Record<number, number>) {
	console.log(
		"偏移",
		Object.entries(offset)
			.map(([k, v]) => `${k}: ${v}`)
			.join(", "),
		"非0偏移占比",
		Object.entries(offset)
			.filter(([k]) => Number(k) !== 0)
			.reduce((a, [, v]) => a + v, 0) /
			Object.values(offset).reduce((a, b) => a + b, 0),
		"偏移加权",
		Object.entries(offset)
			.map(([k, v]) => Number(k) * v)
			.reduce((a, b) => a + b, 0),
		"偏移按键数",
		Object.entries(offset)
			.filter(([k]) => Number(k) !== 0)
			.reduce((a, [, v]) => a + v, 0),
		"实际选择数",
		Object.entries(offset).reduce((a, [, v]) => a + v, 0),
	);
}

async function run() {
	const { commit, single_ci } = await initLIME({ ziInd: load_pinyin() });

	const file = path.join(__dirname, "冰灯.txt");

	const seg = new Intl.Segmenter("zh-Hans", { granularity: "word" });
	const test_text_raw = Deno.readTextFileSync(file);
	const test_text_x = Array.from(seg.segment(test_text_raw));
	const text_text_g: string[][] = [[]];
	for (const t of test_text_x) {
		if (!t.isWordLike) {
			text_text_g.push([t.segment]);
			text_text_g.push([]);
			continue;
		}
		if (t.segment.match(/^[\dA-Za-z]+$/)) {
			text_text_g.push([t.segment]);
			text_text_g.push([]);
			continue;
		}
		const last = text_text_g.at(-1);
		if (last && last.length < 5) {
			last.push(t.segment);
		} else {
			text_text_g.push([t.segment]);
		}
	}

	const test_text = text_text_g.map((v) => v.join(""));
	console.log(test_text);

	async function match(src_t: string, r: Result) {
		for (const [idx, candidate] of r.candidates.entries()) {
			const text = candidate.word;
			if (src_t.startsWith(text)) {
				if (src_t === text) {
					await commit(text, true, true);
				} else {
					await commit(text, true, false);
				}
				return { text, idx, rm: candidate.remainkeys };
			}
		}
	}

	const pinyin_k_l = generate_pinyin().toSorted((a, b) => b.length - a.length);
	const shuangpinMap = generate_shuang_pinyin(pinyin_k_l, shuangpinMaps.自然码);
	function pinyin2shuangpin(py: string) {
		for (const [k, v] of Object.entries(shuangpinMap)) {
			if (v.includes(py)) return k;
		}
		return py;
	}

	const offset: Record<number, number> = {};
	let keyCount = 0;
	let bestCommitCount = 0;

	for (let src_t of test_text) {
		let py = pinyin(src_t, { type: "array", toneType: "none", v: true })
			.map((i) => pinyin2shuangpin(i))
			.join("");
		const fuhao = " ，。《》？！“”：/、\n";

		keyCount += py.length;
		if (!fuhao.includes(src_t)) bestCommitCount++;

		const len = src_t.length;
		for (let _i = 0; _i < len; _i++) {
			const c = await single_ci(keys_to_pinyin(py, { shuangpin: "自然码" }));
			const m = await match(src_t, c);
			if (m === undefined) {
				if (!fuhao.includes(src_t)) console.log("找不到", src_t);
				await commit(src_t, false, true);
				continue;
			}
			py = m.rm.map((i) => pinyin2shuangpin(i)).join("");
			src_t = src_t.slice(m.text.length);
			console.log(m.text, m.idx, m.idx !== 0 ? c.candidates[0].word : "");
			offset[m.idx] = (offset[m.idx] || 0) + 1;
			if (src_t === "") break;
		}
	}

	logOffset(offset);
	console.log(
		"按键数",
		keyCount,
		"理想选择数",
		bestCommitCount,
		"文章长度",
		test_text_raw.length,
	);
	await Deno.writeTextFile(
		inputSpeedDataPath,
		JSON.stringify({
			offset,
			keyCount,
			bestCommitCount,
			textLength: test_text_raw.length,
		} as SpeedData),
	);
}

function cal(op: { keySpeed: number; offsetT: number[]; pageChangeT: number }) {
	const data = JSON.parse(
		Deno.readTextFileSync(inputSpeedDataPath),
	) as SpeedData;

	const { offset, keyCount, bestCommitCount, textLength } = data;

	const keySpeed = op.keySpeed; // 每分钟击键数
	const keyT = (1000 * 60) / keySpeed;

	const pageLen = op.offsetT.length;
	const getOffsetT = (offset: number) => {
		const p = offset % pageLen;
		return (
			op.offsetT[p] +
			Math.floor(offset / pageLen) * ((op.offsetT.at(-1) || 0) + op.pageChangeT)
		);
	};

	const speed =
		textLength /
		((keyCount * keyT +
			Object.entries(offset).reduce(
				(acc, [k, v]) => acc + getOffsetT(Number(k)) * v,
				0,
			)) /
			1000 /
			60);
	const bestSpeed =
		textLength /
		((keyCount * keyT + bestCommitCount * op.offsetT[0]) / 1000 / 60);

	logOffset(offset);
	console.log(
		"按键数",
		keyCount,
		"理想选择数",
		bestCommitCount,
		"文章长度",
		textLength,
		`击键速度 ${keySpeed} kpm`,
		`速度约 ${speed} cpm`,
		`理论最大速度 ${bestSpeed} cpm`,
		`${((speed / bestSpeed) * 100).toFixed(3)}%`,
	);
}

if (Deno.args[0] === "cal") {
	cal({
		keySpeed: Number(Deno.args[1]) || 80,
		pageChangeT: Number(Deno.args[1]) || 500,
		offsetT: Deno.args.slice(2).map((i) => Number(i)) || [
			400, 800, 1600, 2400, 3200,
		],
	});
} else {
	await run();
}

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
	offset: number;
	keyCount: number;
	commitCount: number;
	bestCommitCount: number;
	textLength: number;
};

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

	let offset = 0;
	let keyCount = 0;
	let commitCount = 0;
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
			commitCount++;
			py = m.rm.map((i) => pinyin2shuangpin(i)).join("");
			src_t = src_t.slice(m.text.length);
			console.log(m.text, m.idx, m.idx !== 0 ? c.candidates[0].word : "");
			offset += m.idx;
			if (src_t === "") break;
		}
	}

	console.log(
		"偏移",
		offset,
		"按键数",
		keyCount,
		"选择数",
		commitCount,
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
			commitCount,
			bestCommitCount,
			textLength: test_text_raw.length,
		} as SpeedData),
	);
}

function cal(
	op: { keySpeed: number; offsetT: number } = { keySpeed: 80, offsetT: 100 },
) {
	const data = JSON.parse(
		Deno.readTextFileSync(inputSpeedDataPath),
	) as SpeedData;

	const { offset, keyCount, commitCount, bestCommitCount, textLength } = data;

	const keySpeed = op.keySpeed; // 每分钟击键数
	const keyT = (1000 * 60) / keySpeed;
	const offsetT = op.offsetT; // 查找偏移需要的时间

	const speed =
		textLength /
		((keyCount * keyT + commitCount * keyT + offset * offsetT) / 1000 / 60);
	const bestSpeed =
		textLength / ((keyCount * keyT + bestCommitCount * keyT) / 1000 / 60);

	console.log(
		"偏移",
		offset,
		"按键数",
		keyCount,
		"选择数",
		commitCount,
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
		offsetT: Number(Deno.args[2]) || 100,
	});
} else {
	await run();
}

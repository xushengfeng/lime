import { generate_pinyin } from "./all_pinyin.ts";
import { generate_fuzzy_pinyin } from "./fuzzy_pinyin.ts";
import { generate_shuang_pinyin } from "./shuangpin.ts";

export type PinyinAndKey = {
	py: string;
	key: string;
	preeditShow: string;
};
export type PinyinL = Array<
	// 拆分后的序列
	Array<PinyinAndKey> // 多选，比如模糊音，半个拼音等
>;

const pinyin_k_l = generate_pinyin().toSorted((a, b) => b.length - a.length);

const sp_map = generate_shuang_pinyin(pinyin_k_l);

export function keys_to_pinyin(keys: string, shuangpin = true): PinyinL {
	const l: PinyinL = [];
	let k = keys;
	const split_key = "'";
	if (keys.startsWith(split_key)) return [];
	const shuangpinMap = shuangpin ? sp_map : {};

	function tryMatch(k: string) {
		let has = false;
		const kl: { i: string; pinyin: string }[] = [];
		for (const i in shuangpinMap) {
			kl.push({ i, pinyin: shuangpinMap[i] });
		}
		for (const i of pinyin_k_l) {
			kl.push({ i, pinyin: i });
		}
		for (const { i, pinyin } of kl) {
			if (k.startsWith(i)) {
				has = true;
				const pinyin_variants = generate_fuzzy_pinyin(pinyin);

				let ni = i;
				const next = k.at(i.length);
				if (next === split_key) {
					ni = i + split_key;
				}

				l.push(
					pinyin_variants.map((py) => ({
						py,
						key: ni,
						preeditShow: py,
					})),
				);
				k = k.slice(ni.length);
				return k;
			}
		}
		if (!has) {
			return undefined;
		}
	}

	let _count = 0;
	while (k.length > 0) {
		_count++;
		if (_count > keys.length * 2) {
			console.error("keys_to_pinyin possible infinite loop:", {
				keys,
				shuangpin,
				l,
				k,
			});
			break;
		}

		if (k.startsWith(split_key)) {
			l.push([{ py: "*", key: split_key, preeditShow: "*" }]);
			k = k.slice(1);
		}

		const nk = tryMatch(k);
		if (nk !== undefined) {
			k = nk;
		} else {
			for (let plen = 0; plen < k.length; plen++) {
				const xk = k.slice(0, plen + 1);
				let nxk = xk;
				const ll: PinyinAndKey[] = [];
				for (const [i, py] of Object.entries(shuangpinMap)) {
					if (i.startsWith(xk)) {
						const next = k.at(xk.length);
						if (next === split_key) {
							nxk = xk + split_key;
						}
						ll.push({
							py,
							key: nxk,
							preeditShow: ["zh", "ch", "sh"].includes(py.slice(0, 2))
								? py.slice(0, 2)
								: py[0],
						});
					}
				}
				for (const i of pinyin_k_l) {
					if (i.startsWith(xk)) {
						const next = k.at(xk.length);
						if (next === split_key) {
							nxk = xk + split_key;
						}
						ll.push({
							py: i,
							key: nxk,
							preeditShow: xk,
						});
					}
				}
				k = k.slice(nxk.length);
				if (ll.length) {
					l.push(ll);
					break;
				}
			}
		}
	}
	return l;
}

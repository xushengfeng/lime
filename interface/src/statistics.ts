import { button, ele, p, view } from "dkh-ui";
import { lime } from "./lime_api.ts";
import { nav } from "./nav.ts";

const limeInstance = new lime();

nav.addInto();

ele("h1").add("LIME 输入统计").addInto();

button("刷新统计")
	.on("click", async () => {
		await updateStatistics();
	})
	.addInto();

const statistics = view().style({ maxHeight: "50vh" }).addInto();

function average(arr: number[]): number {
	if (arr.length === 0) return 0;
	return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function toXPM(ms: number) {
	return (1000 * 60) / ms;
}

async function updateStatistics() {
	const data = await limeInstance.inputlog();
	console.log(data);
	statistics.clear();
	statistics.add(p(`按键次数：${data.keyDeltaTimes.length}`));
	const keyAvg = average(data.keyDeltaTimes);
	statistics.add(
		p(
			`平均按键间隔：${keyAvg.toFixed(2)} ms (${toXPM(keyAvg).toFixed(2)} kpm)`,
		),
	);
	const ziAvg = average(data.ziDeltaTimes);
	statistics.add(
		p(
			`平均字间隔（不计算初始思考时间）：${ziAvg.toFixed(2)} ms (${toXPM(ziAvg).toFixed(2)} wpm)`,
		),
	);

	const token = await limeInstance.userData();
	const ziCount = token.context.reduce((sum, cur) => sum + cur.t.length, 0);
	statistics.add(p(`输入字数：${ziCount} 字`));
	statistics.add(
		p(
			`每个字按键数（不算候选选择键）：${(data.keyDeltaTimes.length / ziCount).toFixed(2)}`,
		),
	);
}

export {};

import { button, ele, textarea, view } from "dkh-ui";
import { lime } from "./lime_api.ts";
import { nav } from "./nav.ts";

const limeInstance = new lime();

nav.addInto();

ele("h1").add("LIME 上下文管理").addInto();

button("获取上下文")
	.on("click", async () => {
		const data = await limeInstance.userData();
		console.log(data);
		contextView.clear();
		contextView.add(data.context.map((i) => i.t).join(""));
	})
	.addInto();

const contextView = view().style({ maxHeight: "50vh" }).addInto();

ele("h2").add("学习文本");

const lt = textarea().addInto();

button("学习")
	.on("click", async () => {
		await limeInstance.pushText(lt.gv);
		lt.clear();
	})
	.addInto();

export {};

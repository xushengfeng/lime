import { a, view } from "dkh-ui";

const nav = view("x");

const links: { link: string; name: string }[] = [
	{ link: "/", name: "首页" },
	{ link: "/demo.html", name: "交互演示" },
	{ link: "/context.html", name: "上下文管理" },
	{ link: "/statistics.html", name: "输入统计" },
];

const search = location.search;

for (const item of links) {
	const url = new URL(item.link, location.origin);
	if (search) {
		url.search = search;
	}
	a(url.toString()).add(item.name).addInto(nav);
}
export { nav };

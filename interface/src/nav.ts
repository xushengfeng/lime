import { a, view } from "dkh-ui";

const nav = view("x");

a("/").add("首页").addInto(nav);
a("/demo.html").add("交互演示").addInto(nav);
a("/context.html").add("上下文管理").addInto(nav);

export { nav };

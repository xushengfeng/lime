import { ele, p } from "dkh-ui";
import { nav } from "./nav.ts";

nav.addInto();

ele("h1").add("LIME").addInto();

p(
	"LIME —— LLM IME（Input Method Editor）是一个基于大语言模型的输入法项目，借助大模型优化联想，补全大厂输入法和开源缩入法的一些差距。",
).addInto();

export {};

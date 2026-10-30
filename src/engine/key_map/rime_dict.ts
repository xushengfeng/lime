import { readFileSync } from "node:fs";

export function get_dict(filepath: string) {
	const l: Array<string> = [];
	const texts = readFileSync(filepath, "utf8").split("\n");
	let is_meta = false;
	for (let i of texts) {
		if (i.endsWith("\n")) {
			i = i.slice(0, -1);
		}
		if (i.startsWith("#")) {
			continue;
		}
		if (i === "---") {
			is_meta = true;
			continue;
		}
		if (i === "...") {
			is_meta = false;
			continue;
		}
		if (i === "") {
			continue;
		}
		if (is_meta) {
			continue;
		}
		l.push(i);
	}
	return l;
}

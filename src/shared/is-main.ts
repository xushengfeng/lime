import { pathToFileURL } from "node:url";

export function isMain(moduleUrl: string): boolean {
	const entry = process.argv[1];
	return Boolean(entry) && pathToFileURL(entry).href === moduleUrl;
}

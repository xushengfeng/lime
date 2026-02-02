import type { Result, UserData } from "../../main.ts";
import type { inputLog } from "../../server.ts";

export class lime {
	constructor() {
		const p = this.getPassword();
		if (!p) {
			alert("请在 URL 中通过参数 passwd 指定访问密码，例如 ?passwd=你的密码");
		}
	}
	private getPassword(): string {
		return new URLSearchParams(location.search).get("passwd") || "";
	}
	private getHeader() {
		return new Headers({
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.getPassword()}`,
		});
	}
	private getServerUrl(): string {
		const baseUrl = new URL(
			new URLSearchParams(location.search).get("server") || location.origin,
		);
		baseUrl.pathname = "/api";
		return baseUrl.toString();
	}
	async candidates(keys: string) {
		const data = fetch(`${this.getServerUrl()}/candidates`, {
			method: "POST",
			headers: this.getHeader(),
			body: JSON.stringify({ keys: keys }),
		});
		const res = await (await data).json();
		return res as Result;
	}
	async commit(word: string, newT: boolean) {
		await fetch(`${this.getServerUrl()}/commit`, {
			method: "POST",
			headers: this.getHeader(),
			body: JSON.stringify({ text: word, new: newT }),
		});
	}
	async userData() {
		const data = await fetch(`${this.getServerUrl()}/userdata`, {
			method: "GET",
			headers: this.getHeader(),
		});
		const res = await data.json();
		return res as UserData;
	}
	async inputlog() {
		const data = await fetch(`${this.getServerUrl()}/inputlog`, {
			method: "GET",
			headers: this.getHeader(),
		});
		const res = await data.json();
		return res as typeof inputLog;
	}
}

import type { Result, UserData } from "../../main.ts";

export class lime {
	private getPassword(): string {
		return new URLSearchParams(location.search).get("passwd") || "";
	}
	private getServerUrl(): string {
		return (
			new URLSearchParams(location.search).get("server") ||
			"http://localhost:5000"
		);
	}
	async candidates(keys: string) {
		const data = fetch(`${this.getServerUrl()}/candidates`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.getPassword()}`,
			},
			body: JSON.stringify({ keys: keys }),
		});
		const res = await (await data).json();
		return res as Result;
	}
	async commit(word: string, newT: boolean) {
		await fetch(`${this.getServerUrl()}/commit`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.getPassword()}`,
			},
			body: JSON.stringify({ text: word, new: newT }),
		});
	}
	async userData() {
		const data = await fetch(`${this.getServerUrl()}/userdata`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.getPassword()}`,
			},
		});
		const res = await data.json();
		return res as UserData;
	}
}

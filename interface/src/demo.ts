import { ele, input, p, txt, view } from "dkh-ui";
import type { Result } from "../../main.ts";
import { nav } from "./nav.ts";

class lime {
	private getPassword(): string {
		return (
			passwd.gv || new URLSearchParams(location.search).get("passwd") || ""
		);
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
}

class ime {
	private keys: string[] = [];
	composing = false;
	candidates: Result["candidates"] = [];
	private limeInstance = new lime();

	private jilieWord: string = "";

	private pageIndex = 0;
	private cIndex = 0;

	addKey(e: KeyboardEvent) {
		if (this.composing) {
			if (e.key === "Backspace") {
				this.keys.pop();
				if (this.keys.length === 0) this.composingState = false;
				else this.updateCandidates();
			} else if (e.key === " ") {
				this.select(this.cIndex);
			} else if (e.key === "=") {
				this.pageIndex += 1;
				this.cIndex = this.pageIndex * 5;
				this.updateCandidatesUI();
			} else if (e.key === "-") {
				if (this.pageIndex > 0) this.pageIndex -= 1;
				this.cIndex = this.pageIndex * 5;
				this.updateCandidatesUI();
			} else if (e.key === "Escape") {
				this.composingState = false;
			} else if (e.key >= "1" && e.key <= "5") {
				const index = parseInt(e.key, 10) - 1;
				this.select(this.pageIndex * 5 + index);
			}
		}
		if (e.key >= "a" && e.key <= "z") {
			this.keys.push(e.key);
			if (this.keys.length) this.composingState = true;
			this.updateCandidates();
		}
	}
	async updateCandidates() {
		this.candidates = (
			await this.limeInstance.candidates(this.keys.join(""))
		).candidates;
		console.log(this.candidates);

		this.pageIndex = 0;
		this.cIndex = 0;
		this.updateCandidatesUI();
		if (this.candidates.length === 0) {
			// todo
		} else if (this.candidates.length === 1) {
			this.select(0);
		} else {
			const first = this.candidates[0];
			inputPreedit
				.clear()
				.add(this.jilieWord + first.preedit + first.remainkeys.join(""));
		}
	}
	updateCandidatesUI() {
		const start = this.pageIndex * 5;
		inputBar
			.clear()
			.add(
				this.candidates
					.slice(start, start + 5)
					.map((i, n) => view().add(txt(`${start + n + 1} ${i.word}`))),
			);
	}
	select(index: number) {
		const c = this.candidates[index];
		if (!c) return;
		console.log(c);
		this.jilieWord += c.word;
		if (c.remainkeys.length) {
			this.limeInstance.commit(this.jilieWord, false);
			this.keys = this.keys.slice(c.consumedkeys);
			this.updateCandidates();
		} else {
			this.composingState = false;
			this.limeInstance.commit(this.jilieWord, true);
			this.keys = [];
			addWords(this.jilieWord);
			this.jilieWord = "";
			this.updateCandidates();
			inputPreedit.clear();
		}
	}
	set composingState(val: boolean) {
		this.composing = val;
		inputPreedit.clear();
		inputBar.clear();
	}
}

const imeInstance = new ime();

nav.addInto();

ele("h1").add("LIME 交互演示").addInto();

p("大模型优化输入法联想").addInto();

const passwd = input("password").addInto();

const inputArea = view()
	.attr({ tabIndex: 1 })
	.style({ width: "100%", height: "100px", background: "#eee" })
	.addInto();

const inputPreedit = p()
	.style({ color: "#888", textDecoration: "underline" })
	.addInto(inputArea);

function addWords(t: string) {
	inputPreedit.el.before(t);
}

const inputBar = view("x").style({ gap: "8px" }).addInto();

inputArea.on("keydown", (e) => {
	e.preventDefault();
	e.stopImmediatePropagation();
	console.log(e.key);
	imeInstance.addKey(e);
});

export {};

export function spilt_pinyin(pinyin: string) {
	const initials = [
		"zh",
		"ch",
		"sh",
		"b",
		"p",
		"m",
		"f",
		"d",
		"t",
		"n",
		"l",
		"g",
		"k",
		"h",
		"j",
		"q",
		"x",
		"r",
		"z",
		"c",
		"s",
		"y",
		"w",
	];
	let initial = "";
	for (const init of initials) {
		if (pinyin.startsWith(init)) {
			initial = init;
			break;
		}
	}

	const final = pinyin.slice(initial.length);
	return [initial, final] as const;
}

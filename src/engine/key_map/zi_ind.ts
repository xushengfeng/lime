export type ZiIndAndKey = {
	ind: string; // 用来索引汉字的东西
	key: string;
	preeditShow: string;
};
export type ZiIndL = Array<
	// 拆分后的序列
	Array<ZiIndAndKey> // 多选，比如模糊音，半个拼音等
>;

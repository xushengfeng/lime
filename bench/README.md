# Bench

需要 Qwen 模型的评测，默认不随 `pnpm test` 运行。它们主要用于发现排序、长句生成和输入速度的退化，失败时先看输出再判断是否真的退化。

## Vitest 运行

```shell
pnpm bench
```

- `text_offset.test.ts`：按词提交，统计候选偏移和耗时
- `sentence.test.ts`：长句识别、删除、长词优先、处理等价
- `user_word.test.ts`：用户词和智能组词
- `ollama.test.ts`：检查本机 Ollama 模型

## 脚本运行

```shell
pnpm bench:speed [cal <kpm> <翻页时间> ...]
pnpm bench:word
```

- `input_speed.ts`：整篇文章模拟输入，输出候选偏移、按键数、提交数和速度估算
- `word_choice.ts`：统计「他/她/它」「的/地/得」等易混字的首选率

结果数据会写入 `tests/fixtures/input_speed_data.json`。

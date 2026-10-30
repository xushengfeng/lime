# Bench

需要 Qwen 模型的评测，默认不随 `pnpm test` 运行。它们主要用于发现排序、长句生成和输入速度的退化，失败时先看输出再判断是否真的退化。

## Vitest 运行

```shell
pnpm bench
```

- `lime_v1_golden.test.ts`：`lime-v1` 行为快照，防止重构改变候选
- `text_offset.test.ts`：按词提交，统计候选偏移和耗时
- `sentence.test.ts`：长句识别、删除、长词优先、处理等价
- `user_word.test.ts`：用户词和智能组词
- `ollama.test.ts`：检查本机 Ollama 模型

`LIME_ALGORITHM=lime-v2 pnpm bench` 可以让这些评测切换到其他算法。

`lime-v1` 的快照由 `pnpm bench:golden:gen` 生成。只有确认要更新参考行为时才运行它。

## 对比 / 消融

```shell
pnpm bench:compare
pnpm bench:compare --article bench/articles/孔乙己.txt
pnpm bench:compare --engine baseline --baseline-mode rime
pnpm bench:ablation
pnpm bench:compare --limit 300 --json bench/results/冰灯-300.json
pnpm bench:compare --algorithms lime-v1,lime-v2
```

`compare.ts` 用 `input_speed` 的方式模拟长句输入，双方都使用自然码双拼：

- `LIME（模型）`：Qwen 模型给出候选
- `字典（基础字频）`：只按 `assets/pinyin` 的 8105 字频排序
- `字典（+调频）`：加入在线字频
- `字典（+调频+上下文）`：再加入在线二元上下文
- `雾凇词库（长词优先）`：rime-ice 词典 + 在线词频/上下文 + 长词偏置
- `Qwen token 词表（长词优先）`：从模型 token 表导出的词表 + 长词偏置

`--ablation` 会一次跑上面六项；不加则只跑 LIME 和一个选定模式的 baseline（默认 `rime`）。`--algorithms lime-v1,lime-v2` 会在同一篇文章上并排跑多个 LLM 算法。

指标：

- `首选字符覆盖`：正确候选排第 1 时覆盖的汉字数 / 全文汉字数。这是**首个候选的字符覆盖率**，不是自由选择首个候选后的最终 CER；输入过程用 oracle 选择正确候选来测排序。
- `Top5字符覆盖`：正确候选在前 5 位时覆盖的汉字数 / 全文汉字数
- `覆盖率`：参与评测的汉字数 / 全文汉字数
- `查询首选率`：正确候选排首位的查询比例，按查询计，不按字数加权
- `平均排名`：正确候选的平均名次，越小越好
- `缺失`：找不到正确候选的次数
- `按键` / `查询` / `提交` / `用时`：模拟输入的成本

LIME 和词库 baseline 一次可能提交多个字，所以字符覆盖按候选实际覆盖的字数加权；字级 baseline 每字一次查询。完整结果见 `bench/results.md`。

## 词表

```shell
pnpm bench:words    # 从 rime-ice 生成 assets/pinyin/words.dict.yaml（前 15 万词）
pnpm bench:tokens   # 从 Qwen GGUF 导出 bench/dicts/qwen_tokens.tsv
```

这两个文件都是本地生成的，**不提交到仓库**，避免把几十 MB 的原始词库和模型派生数据放进 git。换模型后需要重新生成 token 表；没有 `words.dict.yaml` 时词库 baseline 会退回字表。

## 脚本运行

```shell
pnpm bench:speed [cal <kpm> <翻页时间> ...]
pnpm bench:latency
pnpm bench:word
```

- `input_speed.ts`：整篇文章模拟输入，输出候选偏移、按键数、提交数和速度估算
- `latency.ts`：分别测普通筛选、渐近输入、commit、commit 后首键和长句补全；只报告并标记超过 109ms 的场景，不做断言
- `word_choice.ts`：统计「他/她/它」「的/地/得」等易混字的首选率

结果数据会写入 `tests/fixtures/input_speed_data.json`。

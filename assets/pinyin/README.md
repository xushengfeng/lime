# 拼音词典

- `8105.dict.yaml`、`41448.dict.yaml`：字表，来自 [rime-ice](https://github.com/iDvel/rime-ice) 的 `cn_dicts/`。
- `words.dict.yaml`：**不提交到仓库**。由 rime-ice 的 `base.dict.yaml`、`ext.dict.yaml`、`others.dict.yaml` 合并，按权重取前 15 万条 2-8 汉字的词，保留原始拼音和权重。原始词库约 28MB、87 万条，太长，所以只保留生成方式。

生成：

```shell
pnpm bench:words
```

脚本会从 jsDelivr 拉取 rime-ice 原始词库，生成 `assets/pinyin/words.dict.yaml`。`bench/compare.ts` 的词库 baseline 会把拼音转换成自然码双拼后建前缀树，并按权重和长词偏置排序。没有生成该文件时，会退回只使用两张字表。

# 评测文章

| 文件 | 领域 | 来源 |
| --- | --- | --- |
| `冰灯.txt` | 现代说明文 | 项目原有测试文章 |
| `孔乙己.txt` | 现代小说 | 鲁迅《呐喊》，`Ac-heron/luxun` |
| `一件小事.txt` | 现代小说 | 鲁迅《呐喊》，`Ac-heron/luxun` |
| `论语.txt` | 先秦哲学 | `chinese-poetry/chinese-poetry` 的 `论语/lunyu.json` |

鲁迅作品已进入公有领域；《论语》为公有领域文本。抓取后去掉了 Markdown 包裹、标题、脚注和硬换行，保留原文标点。

原始地址：

- <https://github.com/Ac-heron/luxun>
- <https://github.com/chinese-poetry/chinese-poetry>

想增加文章时，直接放一个 UTF-8 的 `.txt` 到本目录，然后：

```shell
pnpm bench:compare --article bench/articles/你的文章.txt
```

# LIME

llm 驱动的输入法。目前支持拼音。

llm 常用的文本生成方式是自回归，也就是预测下一个词（token）的所有可能，然后通过某种方式采样选择某个可能，追加到模型输入，然后再次预测。这个项目，把词可能的选择采样交给了用户拼音，利用用户拼音来辅助采样。

使用小型大模型 Qwen3-0.6B-IQ4_XS ，兼顾速度和联想能力，打字时速度和普通引擎基本无异。

python 版本的见[python 分支](https://github.com/xushengfeng/lime/tree/python)，此版本用 ts 重写。

> [!CAUTION]
> 本项目的结构是运行一个 ai 服务器，输入法前端发送按键数据到服务器计算，然后返回你选择的文字\
> Rime 输入法前端可以使用 HiAE 对 `/candidates` 和 `/commit` 的请求与响应做加密认证\
> 你的按键输入仍然可能包括了你大部分隐私，请不要把服务器暴露在公网或不可信局域网\
> 如果关闭 HiAE 或使用开发 curl 示例，请只在本机可信环境中调试

## 运行

需要有 Node.js 运行时（建议 22 或更高版本）和 [pnpm](https://pnpm.io/)

下载本项目，建议通过命令`git clone https://github.com/xushengfeng/lime`，后续可以获取更新，当然也可以下载压缩包

建议切换到某个tag使用，或者在release上下载某个tag，这些tag是验证过的版本而不是中途开发可能存在问题的代码。

### 安装依赖

```shell
pnpm install
```

### 下载模型

```shell
git clone https://www.modelscope.cn/unsloth/Qwen3-0.6B-GGUF.git
```

模型文件夹的位置和项目应该是同级的，当然你也可以修改代码

### 开启服务器

```shell
pnpm start
```

开发时可以使用 `pnpm dev`，修改服务端代码后会自动重启。

创建密钥，一定程度上防止被滥用或隐私泄露

```shell
pnpm key
```

如果只是先看看这个项目的效果，可以跳转到下面的[说明](#前端)

## 作为输入法

这里使用[rime](https://rime.im/)作为前端。

复制项目 rime 文件夹里面的内容到你的 rime 输入法配置里面。可以修改`default.yaml`的`schema_list`，添加`-  schema: llm`，或者创建`default.custom.yaml`，内容如下：

```yaml
patch:
    schema_list/+:
        - schema: llm
```

总而言之，在rime里面启用`llm`这个schema。

确保系统安装了 [curl](https://curl.se/download.html)，大部分系统如Windows（win10 1803+）、Linux、macOS 都自带了。

创建密钥`pnpm key`，只需要创建一次，把输出的密钥改写在`llm_pinyin.lua`的`key`变量里面。

默认开启 HiAE 加密。先运行`pnpm build:hiae`生成`dist/hiae_payload.mjs`，再把`llm_pinyin.lua`中的`hiae_payload`改成这个文件的绝对路径，例如`/home/me/lime/dist/hiae_payload.mjs`。加密模式下 Lua 端不会发送明文 bearer key，服务端会用`key.txt`里保存的 key hash 验证并解密请求。

如果需要临时回退到旧的明文 bearer 请求，可以把`llm_pinyin.lua`里的`enable_hiae`改成`false`。

开启服务器，切换到 llm 拼音输入法即可使用。

注意，并不能与你其他的 rime 输入法结合，只能作为一个新的 rime 输入法。

## 特性

除了 ai 优化，还有一些输入法特性：

- 模糊音，可自定义转化表
- 双拼（自然码、搜狗、微软、小鹤、智能 ABC、拼音加加、紫光，自定义）
- `'`号分割拼音

## 配置

复制`user_config.example.ts`为`user_config.ts`，在`user_config.ts`里面修改配置。

比如可以把`shuangpin`的值改成`false`或者改成其他双拼方案。

建议使用现代的代码编辑器修改，比如 vscode、zed、neovim 等，它们提供代码检查，改配置时可以避免错误。

## 项目结构

- `src/engine`：输入法核心，拼音索引、候选生成、模型加载
- `src/server`：Hono 服务、鉴权、启动入口
- `src/crypto`：HiAE 加解密
- `src/cli`：密钥生成、用户词预加载等命令行工具
- `src/config`：配置类型和默认配置
- `interface`：Vite 前端
- `tests/unit`：不需要模型的单元测试
- `bench`：需要 Qwen 模型的防退化评测、对比/消融实验和速度基准
- `bench/articles`：评测文章（冰灯、孔乙己、论语等），可自行添加
- `bench/dicts`：从模型导出的 Qwen token 表
- `tests/fixtures`：测试数据
- `assets/pinyin`：rime-ice 字表和词表

## 现状

长句的输入可能并不智能。

输入太快可能会漏字母。

没有保存数据的功能，也没有生词记录，所以服务器重启后会丢失记忆。

## 理解与展望

模型有的地方让人惊喜，有些候选又不合适地排在后面。总的来说，联想能力不输以前传统大厂的输入法，利好开源输入法，但 AI 时代竞争会更激烈，大厂的或者新加入的输入法会更智能。

从拼音引导文字生成来看，人对语音的理解不是顺序的，是大体上顺序，小范围逆序，一些音的识别在后面才会有明确的结果或纠正。现在这个项目只能对部分置信度高的候选生成长词组，对于更长的长句，没有一定的把握是不会生成的。我了解到 fim 补全模式，这可以是一个方向，用它来表示没有把握的候选，但并不能提供拼音信息。有几种方向（AI 也告诉我了一些，我不是专业的，仅抛砖引玉），可以修改 mask，让拼音候选匹配的文字权重加大，占用位置编码，但不具体下来；类似翻译模型，前后关系在模型内部处理。为了更好补全，可以微调模型，减少其在指令遵循、编程相关的能力，提高其文学能力。另外发现不同的 token 粒度对置信度影响较大，在“ta de”中，“他的”是一个 token，但“他”和“的”各是一个 token，“他的”排名靠后，但“他”\*“的”的置信度还会更低，所以现在输入法采取长词优先，尽管这个不符合置信度排序。

在应用方面来说，不同焦点的切换应该发生给模型以提示，否则容易串。删除或者光标改变也应该考虑。这些输入法框架应该具有相关功能，我研究一下。

## 开发

Rime 前端默认使用 HiAE 加密。下面的 curl 示例仍保留为本机开发调试用的明文接口，需要传入 bearer key。

可以发送按键让引擎分析

```shell
curl --request POST \
  --url http://127.0.0.1:5000/candidates \
  --header 'content-type: application/json' \
  --header 'Authorization: Bearer your key' \
  --data '{
  "keys": "nihaoshijie"
}'
```

返回

```json
{
    "candidates": [
        {
            "pinyin": ["ni", "hao", "shi", "jie"],
            "score": 1.1879427571978856e-13,
            "word": "你好世界"
        }
    ]
}
```

选好词后，发送，将作为上下文记录

```shell
curl --request POST \
  --url http://127.0.0.1:5000/commit \
  --header 'content-type: application/json' \
  --header 'Authorization: Bearer your key' \
  --data '{
  "text": "你好世界"
}'
```

### 其他输入方案

添加类似`key_to_pinyin`的函数，用于把输入按键转换为文字索引，放在`src/engine/key_map`文件夹下。添加类似`load_pinyin`的函数，提供把文字转为索引的方法。

## 测试

```shell
pnpm test               # 单元测试，不需要模型
pnpm bench              # 模型相关的防退化评测
pnpm bench:compare      # LIME 与 baseline 对比
pnpm bench:ablation     # LIME + 字频/调频/上下文/雾凇词库/Qwen token 一起跑
pnpm bench:speed        # 长句输入速度评测
pnpm bench:word         # 用字准确率评测
pnpm typecheck
```

`bench/compare.ts` 默认用 `bench/articles/冰灯.txt`，两边都输入自然码双拼，统计首选字符覆盖、Top5、缺失和平均排名。可以换文章或截断：

```shell
pnpm bench:compare --article bench/articles/孔乙己.txt
pnpm bench:compare --limit 300 --json bench/results/冰灯-300.json
pnpm bench:words        # 重新生成雾凇词表
pnpm bench:tokens       # 重新导出 Qwen token 表
```

词表和 token 表都是本地生成的，不提交到仓库；首次跑词库/Token baseline 前需要先执行上面两条命令。没有 `words.dict.yaml` 时会退回只使用字表。

四篇不同领域文章上的首选字符覆盖（“字典”使用 `assets/pinyin` 字表，“雾凇词库”和“Qwen token”使用词表 + 长词优先）：

| 文章 | 汉字数 | LIME | 字典字频 | 字典+调频 | 字典+上下文 | 雾凇词库 | Qwen token |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 冰灯 | 936 | **69.66%** | 38.68% | 51.82% | 53.85% | 59.40% | 59.94% |
| 孔乙己 | 2180 | **66.70%** | 51.42% | 58.90% | 63.58% | 66.38% | 63.07% |
| 一件小事 | 865 | 61.97% | 59.54% | 62.20% | 63.58% | **67.28%** | 62.66% |
| 论语 | 1410 | **73.33%** | 37.02% | 51.84% | 54.11% | 62.27% | 62.41% |

**首选字符覆盖** = 正确候选排在**第 1 位**时覆盖的汉字数 / 全文汉字数，是首个候选的字符覆盖率，不是自由选择首个候选后最终文本的 CER；测试过程用正确文本作为 oracle 选择候选，只测排序。LIME 和词库 baseline 一次可能提交多个字，所以按候选覆盖的字数加权。

LIME 在冰灯和论语上领先约 10 到 11 个百分点，孔乙己基本持平，一件小事落后雾凇词库 5.31 个百分点；Top5 覆盖 LIME 在所有文章上都最高。baseline 的消融和详细方法见 `bench/results.md` 与 `bench/README.md`。

`bench/` 里的结果不是严格的单元测试，而是用来观察排序和输入体验是否退化的基准；失败时通常需要人工判断模型或排序策略是否真的变差。`bench:speed` 会按长句拼音模拟输入，统计索引、按键数、提交数，并可按 kpm 估算 cpm。

## 统计

服务器会尝试统计按键的速度（按照相邻请求来计算）、实际输入文字时间、查找候选的时间等，通过`/inputlog`可以获取，可以使用中位数等或者平均数计算你自己相关的打字数据。

## 高级配置

### 使用ollama的模型

添加`import { getOllamaModel } from "./src/engine/ollama.ts";`

`initLIME`的参数中设置`modelPath`，添加`getOllamaModel('模型名称')`，名称为`ollama list`命令列出的模型名称。

## 前端

执行`pnpm build:interface`构建前端，开发时可以使用`pnpm dev:interface`（默认端口 5179，API 会代理到 5000）。

重启服务器

访问 http://127.0.0.1:5000/demo.html?passwd=你的密码 将有个模拟平时输入法界面的页面

其他界面在 http://127.0.0.1:5000 可以导航，如上下文获取、输入统计计算等

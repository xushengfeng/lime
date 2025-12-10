# ai ime

llm 驱动的输入法。目前支持拼音。

记录用户历史输入。让 llm 预测下一个词，再用拼音筛选。

太小的模型预测不强，太大的模型性能不好。这里用了 qwen2-0.5b q4

目前作为云输入，还没有与具体输入法引擎结合在一起。

## 运行

### 仅测试

```shell
uv run test_engine.py
```

### 开启服务器

```shell
uv run server.py
```

可以发送按键让引擎分析

```shell
curl --request POST \
  --url http://127.0.0.1:5000/candidates \
  --header 'content-type: application/json' \
  --data '{
  "keys": "nihaoshijie",
  "pre_str": ""
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

在长句中，只选择前面部分的词，就附带在`pre_str`

选好词后，发送，将作为上下文记录

```shell
curl --request POST \
  --url http://127.0.0.1:5000/commit \
  --header 'content-type: application/json' \
  --data '{
  "text": "你好世界"
}'
```

## 现状

速度不可接受，组个短句需要数秒。之后可能考虑让他推理有把握的，让人参与到那些没有把握的组词中，或者结合传统拼音输入法词搜索等。

还没有设计模糊音、双拼等。

如何与真正的输入法结合起来？也许要用 rime 吧。

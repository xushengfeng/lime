# ai ime

llm 驱动的输入法。目前支持拼音。

记录用户历史输入。让 llm 预测下一个词，再用拼音筛选。

太小的模型预测不强，太大的模型性能不好。这里用了 qwen2-0.5b q4

目前作为云输入，还没有与具体输入法引擎结合在一起。

## 运行

### 安装依赖

```shell
uv sync
```

如果要安装 cpu 版本的运行时，需要在命令前添加`CMAKE_ARGS="-DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS"`

### 下载模型

```shell
git clone https://www.modelscope.cn/qwen/Qwen2-0.5B-Instruct-GGUF.git
```

### 开启服务器

```shell
uv run server.py
```

创建密钥，一定程度上防止被滥用或隐式泄露

```shell
uv run key.py
```

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

## 作为输入法

这里使用[rime](https://rime.im/)作为前端。

复制项目 rime 文件夹里面的内容到你的 rime 输入法配置里面。

安装 luasocket（见下面）。

创建密钥`uv run key.py`，只需要创建一次，把输出的密钥改写在`llm_pinyin.lua`的`key`变量里面。

开启服务器，切换到 llm 拼音输入法即可使用。

注意，并不能与你其他的 rime 输入法结合，只能作为一个新的 rime 输入法。

### 安装 luasocket

对于 linux，使用`luarocks`安装：

```
sudo luarocks install luasocket \
  LIBFLAG="-shared -llua"
```

## 现状

速度不可接受，组个短句需要数秒。

但是，如果是让人在中途选词，每次击键反应可以在几十毫秒级别，还能接受。即使打了一大串，模型只推理下一个词而不是尝试组句，这样快很多。

支持模糊音，自然码双拼。

现在使用 rime 可以一个词一个词输入，长句输入还不行。另外，输入太快会漏字母。

没有保存数据的功能，也没有生词记录，所以服务器重启后会丢失记忆。

## 开发

### 仅测试

```shell
uv run test_engine.py
```

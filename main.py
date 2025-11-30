from turtle import Turtle
from flask import Flask, request, jsonify
from pypinyin import lazy_pinyin
from transformers import AutoTokenizer, AutoModelForCausalLM
import torch
from typing import List, Dict, Tuple, TypedDict


class Candidate(TypedDict):
    word: str
    score: float
    pinyin: List[str]


BeamList = List[Tuple[float, str, str, List[Tuple[str, float]], List[str]]]

# 初始化 Flask 应用
print("初始化网络服务器")
app = Flask(__name__)

# 加载模型和分词器
model_name = "Qwen/Qwen3-0.6B"  # 或您使用的模型
print("加载模型", model_name)
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForCausalLM.from_pretrained(model_name)

# 上下文存储
pre_context = "下面的内容主题多样并且没有标点"
user_context = []


# 按键转拼音
def keys_to_pinyin(keys: str) -> str:
    # 示例：将按键直接映射为拼音（实际可根据需求扩展）
    # 比如双拼、模糊
    return keys


# 使用 Beam Search 生成候选词，拼音拆分基于候选词
def beam_search_generate(
    pinyin_input: str, max_beam_w=7, min_beam_w=2, top_k: int = 10
) -> List[Candidate]:
    """
    使用 Beam Search 生成候选词，逐步匹配拼音。

    :param pinyin_input: 用户输入的拼音
    :param beam_width: Beam Search 的宽度
    :param top_k: 最终返回的候选词数量
    :return: 候选词列表
    """
    prompt = get_context()
    inputs = tokenizer(prompt, return_tensors="pt")

    # 初始化 Beam Search 队列
    beam: BeamList = [
        (1.0, "", pinyin_input, [], [])
    ]  # (prob, context, remaining_pinyin, token_tails, matched_pinyin)

    final_candidates: List[Tuple[float, str, List[str]]] = []

    run_count = 0
    model_count = 0
    check_count = 0
    add_count = 0

    while beam:
        run_count += 1
        print(run_count)
        next_beam: BeamList = []
        for prob, context, remaining_pinyin, ltk, matched_pinyin in beam:
            if not remaining_pinyin:  # 如果拼音已经全部匹配完
                final_candidates.append((prob, context, matched_pinyin))
                continue

            model_count += 1
            inputs = tokenizer(prompt + context, return_tensors="pt")
            print("runmodel", prompt + context)
            with torch.no_grad():
                outputs = model(**inputs)
                logits = outputs.logits[:, -1, :]

            probabilities = torch.softmax(logits, dim=-1)
            tk = min(10**5, logits.size(-1))
            top_probs, top_indices = torch.topk(probabilities, tk)

            for i in range(tk):
                token_id = top_indices[0, i].item()
                token = tokenizer.decode([token_id])
                if len(token) < 1:
                    continue
                token_prob = top_probs[0, i].item()
                if token_prob < 10**-10:
                    break
                new_prob = prob * token_prob  # 累乘概率
                new_context = context + token

                token_pinyin = lazy_pinyin(token)
                token_pinyin_str = "".join(token_pinyin)
                check_count += 1
                if remaining_pinyin.startswith(token_pinyin_str):
                    if token != token_pinyin[0]:
                        new_remaining_pinyin = remaining_pinyin[len(token_pinyin_str) :]

                        add_count += (
                            1
                            if add_to_beam(
                                next_beam,
                                new_prob,
                                new_context,
                                new_remaining_pinyin,
                                ltk + [(token, token_prob)],
                                matched_pinyin + token_pinyin,
                                max_beam_w if run_count == 1 else min_beam_w,
                            )
                            else 0
                        )

        # 按概率排序并截取 Beam Width 个最优结果
        next_beam.sort(key=lambda x: x[0], reverse=True)  # 按概率从高到低排序
        print(next_beam)
        beam = next_beam

    # 提取最终候选词
    candidates: List[Candidate] = []
    for prob, tokens, matched_pinyin in final_candidates:
        candidates.append({"word": tokens, "score": prob, "pinyin": matched_pinyin})

    print(run_count, model_count, check_count, add_count)

    # 按得分排序并返回 Top-K
    candidates.sort(key=lambda x: x["score"], reverse=True)
    return candidates[:top_k]


def commit(text: str):
    user_context.append(text)


def get_context():
    return pre_context + "".join(user_context)


def clear_commit():
    user_context.clear()


def add_to_beam(
    next_beam: BeamList,
    new_prob: float,
    new_context: str,
    new_remaining_pinyin: str,
    tk: List[Tuple[str, float]],
    new_matched_pinyin: List[str],
    limit: int,
):
    """
    将新路径添加到 Beam
    """
    if len(next_beam) == limit:
        if new_prob < next_beam[-1][0]:
            return False

    print(new_prob, new_context, new_remaining_pinyin, tk, new_matched_pinyin)
    next_beam.append(
        (
            new_prob,
            new_context,
            new_remaining_pinyin,
            tk,
            new_matched_pinyin,
        )
    )
    if len(next_beam) >= limit:
        next_beam.sort(key=lambda x: x[0], reverse=True)
    if len(next_beam) > limit:
        next_beam.pop()
    return True


# API: 获取候选词
@app.route("/candidates", methods=["POST"])
def get_candidates() -> Dict[str, List[Dict[str, float]]]:
    data = request.json
    keys: str = data.get("keys", "")  # type: ignore

    pinyin_input = keys_to_pinyin(keys)
    candidates = beam_search_generate(pinyin_input)

    return jsonify({"candidates": candidates})  # type: ignore


# API: 提交文字
@app.route("/commit", methods=["POST"])
def commit_text() -> Dict[str, List[str]]:
    data = request.json
    text = data.get("text", "")  # type: ignore

    if not text:
        return jsonify({"error": "No text provided"}), 400  # type: ignore

    commit(text)

    return jsonify({"message": "Text committed successfully", "context": user_context})  # type: ignore


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)

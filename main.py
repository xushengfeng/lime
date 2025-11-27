from flask import Flask, request, jsonify
from pypinyin import lazy_pinyin
from transformers import AutoTokenizer, AutoModelForCausalLM
import torch
from typing import List, Dict

# 初始化 Flask 应用
app = Flask(__name__)

# 加载模型和分词器
model_name = "Qwen/Qwen3-0.6B"  # 或您使用的模型
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForCausalLM.from_pretrained(model_name)

# 上下文存储
user_context = ['下面']

# 按键转拼音
def keys_to_pinyin(keys: str) -> str:
    # 示例：将按键直接映射为拼音（实际可根据需求扩展）
    # 比如双拼、模糊
    return keys

# 根据拼音筛选候选词
def filter_candidates_by_pinyin(candidates: List[Dict[str, float]], pinyin_input: str) -> List[Dict[str, float]]:
    filtered_candidates = []
    for candidate in candidates:
        word = candidate["word"]
        word_pinyin = ''.join(lazy_pinyin(word))
        if pinyin_input in word_pinyin:
            filtered_candidates.append(candidate)
    return filtered_candidates

# 修改生成候选词逻辑，使用用户上下文作为 prompt
def generate_candidates(pinyin_input: str, top_k: int = 50) -> List[Dict[str, float]]:
    # 使用用户上下文作为 prompt
    prompt = ''.join(user_context)
    inputs = tokenizer(prompt, return_tensors="pt")

    with torch.no_grad():
        outputs = model(**inputs)
        logits = outputs.logits[:, -1, :]

    probabilities = torch.softmax(logits, dim=-1)
    top_probs, top_indices = torch.topk(probabilities, top_k)

    candidates = []
    for i in range(top_k):
        token_id = top_indices[0, i].item()
        token = tokenizer.decode([token_id])
        prob = top_probs[0, i].item()
        candidates.append({"word": token, "probability": prob})

    # 筛选候选词
    filtered_candidates = filter_candidates_by_pinyin(candidates, pinyin_input)
    return filtered_candidates

# API: 获取候选词
@app.route('/candidates', methods=['POST'])
def get_candidates() -> Dict[str, List[Dict[str, float]]]:
    data = request.json
    keys:str = data.get('keys', "")

    pinyin_input = keys_to_pinyin(keys)
    candidates = generate_candidates(pinyin_input)

    return jsonify({"candidates": candidates})

# API: 提交文字
@app.route('/commit', methods=['POST'])
def commit_text() -> Dict[str, List[str]]:
    data = request.json
    text = data.get('text', '')

    if not text:
        return jsonify({"error": "No text provided"}), 400

    # 将提交的文字添加到上下文中
    user_context.append(text)

    return jsonify({"message": "Text committed successfully", "context": user_context})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
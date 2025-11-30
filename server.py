from main import keys_to_pinyin, beam_search_generate, commit, clear_commit

from flask import Flask, request, jsonify
from typing import List, Dict


# 初始化 Flask 应用
print("初始化网络服务器")
app = Flask(__name__)


# API: 获取候选词
@app.route("/candidates", methods=["POST"])
def get_candidates() -> Dict[str, List[Dict[str, float]]]:
    data = request.json
    keys: str = data.get("keys", "")  # type: ignore
    pre_str: str = data.get("pre_str", "")  # type: ignore

    pinyin_input = keys_to_pinyin(keys)
    candidates = beam_search_generate(pinyin_input, pre_str=pre_str)

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

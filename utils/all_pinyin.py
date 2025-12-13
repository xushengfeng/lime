from typing import List, Set

# 尝试创建所有拼音，即使现实中不存在，比如 len

initials = [
    "zh",
    "ch",
    "sh",
    "b",
    "p",
    "m",
    "f",
    "d",
    "t",
    "n",
    "l",
    "g",
    "k",
    "h",
    "j",
    "q",
    "x",
    "r",
    "z",
    "c",
    "s",
    "y",
    "w",
    "",
]

finals = [
    "a",
    "o",
    "e",
    "i",
    "u",
    "v",
    "ai",
    "ei",
    "ui",
    "ao",
    "ou",
    "iu",
    "ie",
    "ve",
    "er",
    "an",
    "en",
    "in",
    "un",
    "ang",
    "eng",
    "ing",
    "ong",
    "ia",
    "iao",
    "ian",
    "iang",
    "iong",
    "ua",
    "uo",
    "ue",
    "uai",
    "uan",
    "uang",
]

# 特殊规则：某些声母和韵母不能组合
invalid_combinations = {
    # j, q, x 只能和 i, v 及其相关韵母组合
    ("j", "a"),
    ("j", "o"),
    ("j", "e"),
    ("j", "u"),
    ("j", "ai"),
    ("j", "ei"),
    ("j", "ao"),
    ("j", "ou"),
    ("j", "an"),
    ("j", "en"),
    ("j", "ang"),
    ("j", "eng"),
    ("j", "ong"),
    ("q", "a"),
    ("q", "o"),
    ("q", "e"),
    ("q", "u"),
    ("q", "ai"),
    ("q", "ei"),
    ("q", "ao"),
    ("q", "ou"),
    ("q", "an"),
    ("q", "en"),
    ("q", "ang"),
    ("q", "eng"),
    ("q", "ong"),
    ("x", "a"),
    ("x", "o"),
    ("x", "e"),
    ("x", "u"),
    ("x", "ai"),
    ("x", "ei"),
    ("x", "ao"),
    ("x", "ou"),
    ("x", "an"),
    ("x", "en"),
    ("x", "ang"),
    ("x", "eng"),
    ("x", "ong"),
    # b, p, m, f 不能和 ong 组合
    # ("b", "ong"), ("p", "ong"), ("m", "ong"), ("f", "ong"),
    # f 不能和 i, v 组合
    ("f", "i"),
    ("f", "v"),
    ("f", "ie"),
    ("f", "ve"),
    ("f", "in"),
    ("f", "vn"),
    ("f", "ing"),
    # g, k, h 不能和 i, v 组合
    ("g", "i"),
    ("g", "v"),
    ("g", "ie"),
    ("g", "ve"),
    ("g", "in"),
    ("g", "vn"),
    ("g", "ing"),
    ("k", "i"),
    ("k", "v"),
    ("k", "ie"),
    ("k", "ve"),
    ("k", "in"),
    ("k", "vn"),
    ("k", "ing"),
    ("h", "i"),
    ("h", "v"),
    ("h", "ie"),
    ("h", "ve"),
    ("h", "in"),
    ("h", "vn"),
    ("h", "ing"),
    # 其他特殊规则
    ("", "er"),  # 零声母不能和 er 组合（单独成音节）
    ("w", "e"),
    ("y", "o"),  # 特殊规则
}


def generate_pinyin():
    """生成所有可能的拼音组合"""
    pinyin_list: Set[str] = set()

    for initial in initials:
        for final in finals:
            # 跳过无效组合
            if (initial, final) in invalid_combinations:
                continue

            if initial in ["j", "q", "x", "y"] and final.startswith("v"):
                final = "u" + final[1:]

            pinyin = initial + final if initial else final  # 处理零声母
            pinyin_list.add(pinyin)

    return list(pinyin_list)

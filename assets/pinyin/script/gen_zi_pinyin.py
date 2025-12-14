from os import path
from typing import Dict, List, Set

script_dir = path.dirname(path.abspath(__file__))


def get_dict(filepath: str) -> Dict[str, List[str]]:
    d: Dict[str, List[str]] = {}
    with open(path.normpath(path.join(script_dir, filepath)), "r") as file:
        texts = file.readlines()
        is_meta = False
        for i in texts:
            if i.endswith("\n"):
                i = i[0:-1]
            if i.startswith("#"):
                continue
            if i == "---":
                is_meta = True
                continue
            if i == "...":
                is_meta = False
                continue
            if i == "":
                continue
            if is_meta:
                continue
            x = i.split("\t")
            zi = x[0]
            pinyin = x[1]
            if not zi or not pinyin:
                continue
            l = d[zi] if zi in d else []
            l.append(pinyin)
            d[zi] = l
    return d


def load_pinyin():
    a = get_dict("../8105.dict.yaml")
    b = get_dict("../41448.dict.yaml")
    d: Dict[str, Set[str]] = {}
    for i in a:
        l: Set[str] = d[i] if i in d else set()
        l = l | set(a[i])
        d[i] = l
    for i in b:
        l: Set[str] = d[i] if i in d else set()
        l = l | set(b[i])
        d[i] = l

    def pinyin(ci: str):
        l: List[List[str]] = []
        for i in ci:
            if i in d:
                l.append(list(d[i]))
            else:
                return []
        return l

    return pinyin

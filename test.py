from llama_cpp import Llama

llama = Llama("../Qwen2-0.5B-Instruct-GGUF/qwen2-0_5b-instruct-q4_0.gguf", n_ctx=128)
tokens = llama.tokenize(b"Hello, world!")
c = 0
for token in llama.generate(
    tokens,
    top_k=40,
    top_p=0.95,
    temp=1.0,
    repeat_penalty=1.0,
):
    c = c + 1
    if c > 20:
        l = list(llama.input_ids)
        print(llama.detokenize(l))
    if c > 515:
        break
    # print(llama.n_tokens,llama)
    print(llama.detokenize([token]).decode())

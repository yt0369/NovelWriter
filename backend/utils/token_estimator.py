def estimate_tokens(text: str) -> int:
    """粗略估算token数。中文约1.5字/token，英文约4字符/token。"""
    if not text:
        return 0
    cn_chars = sum(1 for c in text if '一' <= c <= '鿿')
    other = len(text) - cn_chars
    return int(cn_chars * 1.5 + other / 4)

import difflib


def generate_diff(original: str, new: str, filepath: str = "file") -> str:
    """生成unified diff格式的差异文本。"""
    original_lines = original.splitlines(keepends=True)
    new_lines = new.splitlines(keepends=True)
    diff = difflib.unified_diff(
        original_lines, new_lines,
        fromfile=f"a/{filepath}",
        tofile=f"b/{filepath}",
        lineterm="",
    )
    return "".join(diff)

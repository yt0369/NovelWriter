"""
模型路由器：按任务类型选择不同的模型配置。
"""
from enum import Enum
from dataclasses import dataclass


class TaskType(str, Enum):
    CHAT = "chat"           # 普通对话
    WRITING = "writing"     # 创作写作
    ANALYSIS = "analysis"   # 分析推理
    POLISH = "polish"       # 文本润色
    QUICK = "quick"         # 快速回复


@dataclass
class ModelConfig:
    temperature: float = 0.7
    max_tokens: int = 4096


# 任务类型 → 模型配置
_TASK_CONFIGS: dict[TaskType, ModelConfig] = {
    TaskType.CHAT: ModelConfig(temperature=0.7, max_tokens=4096),
    TaskType.WRITING: ModelConfig(temperature=0.85, max_tokens=8192),
    TaskType.ANALYSIS: ModelConfig(temperature=0.3, max_tokens=4096),
    TaskType.POLISH: ModelConfig(temperature=0.5, max_tokens=8192),
    TaskType.QUICK: ModelConfig(temperature=0.5, max_tokens=1024),
}


def get_model_config(task_type: TaskType) -> ModelConfig:
    """获取任务对应的模型配置。"""
    return _TASK_CONFIGS.get(task_type, ModelConfig())


def detect_task_type(user_message: str) -> TaskType:
    """根据用户消息自动检测任务类型。"""
    msg = user_message.lower()

    # 写作关键词
    writing_kw = ["写", "初稿", "章节", "正文", "撰写", "续写", "草稿", "开始写"]
    if any(kw in msg for kw in writing_kw):
        return TaskType.WRITING

    # 分析关键词
    analysis_kw = ["分析", "审核", "检查", "问题", "逻辑", "伏笔", "结构"]
    if any(kw in msg for kw in analysis_kw):
        return TaskType.ANALYSIS

    # 润色关键词
    polish_kw = ["润色", "优化", "修改", "改善", "文笔", "表达", "改写"]
    if any(kw in msg for kw in polish_kw):
        return TaskType.POLISH

    # 短消息用快速模式
    if len(msg) < 20:
        return TaskType.QUICK

    return TaskType.CHAT

from pydantic_settings import BaseSettings
from pathlib import Path


CONFIG_FILE = Path(__file__).parent / "config.json"


class Settings(BaseSettings):
    # Server
    host: str = "127.0.0.1"
    port: int = 8388

    # Paths
    projects_dir: Path = Path("../projects")

    # AI Provider (OpenAI-compatible)
    api_key: str = ""
    api_base_url: str = "https://blazeai.boxu.dev/api/"
    model: str = "qwen3.6-plus"
    active_backend_id: str = ""

    # 全局设置
    max_output_tokens: int | None = None
    context_token_limit: int = 256000
    safety_setting: str = "BLOCK_NONE"
    language: str = "zh"

    # 采样参数
    temperature: float = 0.7
    top_p: float = 0.95
    top_k: int = 20
    thinking_enabled: bool = False
    thinking_budget_tokens: int | None = None

    # Agent 行为控制
    enable_intent_detection: bool = False  # 意图识别（额外 LLM 调用）
    enable_execution_plan: bool = False    # 执行计划（额外 LLM 调用）
    enable_shadow_read: bool = True        # Shadow Read：审批前 LLM 可读取待审批内容
    enable_proactive_questionnaire: bool = True  # 主动问卷：检测缺失内容时自动弹出问卷

    # 自动提取
    auto_extract_conversation: bool = True
    auto_extract_document: bool = True
    auto_extract_chapter: bool = True

    # 模型路由
    model_routes: dict = {}

    # Embedding
    embedding_model: str = "BAAI/bge-small-zh-v1.5"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

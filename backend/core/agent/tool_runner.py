import asyncio
import logging
from models.tools import ToolCall, ToolResult, ToolResultStatus
from core.tools import execute_tool

logger = logging.getLogger(__name__)

# 读取类工具：可并发执行
READ_TOOLS = frozenset({"read_file", "glob", "grep", "query_memory", "list_characters", "get_character_profile", "list_events", "list_foreshadows", "check_unresolved_foreshadows", "get_outline_structure", "query_evolution"})


class ToolRunner:
    """工具执行器，带熔断器和错误追踪。"""

    def __init__(self, project_id: str, max_consecutive_failures: int = 4, session_id: str = ""):
        self.project_id = project_id
        self.session_id = session_id
        self.max_consecutive_failures = max_consecutive_failures
        self.consecutive_failures = 0
        self.total_tool_calls = 0
        self.error_tracker: dict[str, int] = {}  # error_msg -> count

    def reset_error_tracker(self):
        """每轮对话开始时清零错误追踪。"""
        self.error_tracker.clear()

    async def run(self, tool_call: ToolCall) -> ToolResult:
        """执行单个工具调用。"""
        self.total_tool_calls += 1
        has_raw = '_raw' in (tool_call.arguments or {})
        args_preview = str(tool_call.arguments)[:150]
        logger.debug("tool_run: %s(%s)%s", tool_call.name, args_preview, " [RAW!]" if has_raw else "")
        result = await execute_tool(tool_call, self.project_id, session_id=self.session_id)

        if result.status == ToolResultStatus.ERROR:
            error_msg = result.error or ""
            logger.debug("tool_error: %s -> %s", tool_call.name, error_msg)

            # 文件不存在是正常情况（初始化阶段、探索项目结构），不算连续失败
            is_file_not_found = "文件不存在" in error_msg or "不存在" in error_msg

            if not is_file_not_found:
                self.consecutive_failures += 1
                # 错误追踪：同一工具+同一错误消息出现 3 次后才强制停止
                error_key = f"{tool_call.name}:{error_msg}"
                self.error_tracker[error_key] = self.error_tracker.get(error_key, 0) + 1
                if self.error_tracker[error_key] >= 3:
                    self.consecutive_failures = self.max_consecutive_failures
        else:
            self.consecutive_failures = 0
            logger.debug("tool_ok: %s", tool_call.name)

        return result

    def is_circuit_broken(self) -> bool:
        """检查熔断器是否触发。"""
        return self.consecutive_failures >= self.max_consecutive_failures

    async def run_all(self, tool_calls: list[ToolCall]) -> list[ToolResult]:
        """执行多个工具调用（顺序执行，保持顺序）。"""
        results = []
        for tc in tool_calls:
            if self.is_circuit_broken():
                results.append(ToolResult(
                    status=ToolResultStatus.ERROR,
                    tool_name=tc.name,
                    error="熔断器触发：连续失败次数过多，停止执行",
                ))
                continue
            result = await self.run(tc)
            results.append(result)
        return results

    async def run_concurrent(self, tool_calls: list[ToolCall]) -> list[ToolResult]:
        """并发执行工具调用。

        连续的读取类工具可以并发；写入/审批类工具作为顺序屏障逐个执行。
        这样既保留读工具吞吐，又避免“写后读”在同一批工具调用中读到旧状态。
        """
        if not tool_calls:
            return []

        async def _run_read_batch(read_calls: list[ToolCall]) -> list[ToolResult]:
            async def _safe_run(tc):
                if self.is_circuit_broken():
                    return ToolResult(
                        status=ToolResultStatus.ERROR,
                        tool_name=tc.name,
                        error="熔断器触发：连续失败次数过多，停止执行",
                    )
                return await self.run(tc)

            return list(await asyncio.gather(*[_safe_run(tc) for tc in read_calls]))

        results: list[ToolResult] = []
        pending_reads: list[ToolCall] = []

        async def _flush_reads():
            nonlocal pending_reads
            if pending_reads:
                results.extend(await _run_read_batch(pending_reads))
                pending_reads = []

        for tc in tool_calls:
            if tc.name in READ_TOOLS:
                pending_reads.append(tc)
                continue

            await _flush_reads()
            if self.is_circuit_broken():
                results.append(ToolResult(
                    status=ToolResultStatus.ERROR,
                    tool_name=tc.name,
                    error="熔断器触发：连续失败次数过多，停止执行",
                ))
            else:
                results.append(await self.run(tc))

        await _flush_reads()
        return results

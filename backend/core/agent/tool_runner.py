import asyncio
from models.tools import ToolCall, ToolResult, ToolResultStatus
from core.tools import execute_tool

# 读取类工具：可并发执行
READ_TOOLS = frozenset({"read_file", "glob", "grep", "query_memory", "list_characters", "get_character_profile", "list_events", "list_foreshadows", "check_unresolved_foreshadows", "get_outline_structure", "query_evolution"})


class ToolRunner:
    """工具执行器，带熔断器和错误追踪。"""

    def __init__(self, project_id: str, max_consecutive_failures: int = 4):
        self.project_id = project_id
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
        print(f"[DEBUG] tool_run: {tool_call.name}({args_preview}){' [RAW!]' if has_raw else ''}")
        result = await execute_tool(tool_call, self.project_id)

        if result.status == ToolResultStatus.ERROR:
            error_msg = result.error or ""
            print(f"[DEBUG] tool_error: {tool_call.name} -> {error_msg}")

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
            print(f"[DEBUG] tool_ok: {tool_call.name}")

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
        """并发执行工具调用。读取类工具并发，写入类工具串行。"""
        if not tool_calls:
            return []

        # 分离读取类和写入类工具
        read_calls = []
        write_calls = []
        call_order = []  # 保持原始顺序

        for tc in tool_calls:
            if tc.name in READ_TOOLS and not self.is_circuit_broken():
                read_calls.append(tc)
                call_order.append(("read", len(read_calls) - 1))
            else:
                write_calls.append(tc)
                call_order.append(("write", len(write_calls) - 1))

        # 并发执行所有读取类工具
        read_results: list[ToolResult] = []
        if read_calls:
            async def _safe_run(tc):
                if self.is_circuit_broken():
                    return ToolResult(
                        status=ToolResultStatus.ERROR,
                        tool_name=tc.name,
                        error="熔断器触发：连续失败次数过多，停止执行",
                    )
                return await self.run(tc)

            read_results = list(await asyncio.gather(*[_safe_run(tc) for tc in read_calls]))

        # 串行执行写入类工具
        write_results: list[ToolResult] = []
        for tc in write_calls:
            if self.is_circuit_broken():
                write_results.append(ToolResult(
                    status=ToolResultStatus.ERROR,
                    tool_name=tc.name,
                    error="熔断器触发：连续失败次数过多，停止执行",
                ))
            else:
                result = await self.run(tc)
                write_results.append(result)

        # 按原始顺序重组结果
        results = [None] * len(tool_calls)
        for i, (kind, idx) in enumerate(call_order):
            if kind == "read":
                results[i] = read_results[idx]
            else:
                results[i] = write_results[idx]

        return results

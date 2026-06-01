"""
记忆工具：供Agent使用的知识图谱查询和管理工具。
"""
import json
from typing import Any

from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus
from core.memory.graph import create_node, update_node, delete_node, list_nodes, create_edge, get_edges_for_node
from core.memory.vector_search import hybrid_search
from db.database import get_db


def get_memory_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="query_memory",
            description="搜索知识图谱中的记忆节点（语义+模糊混合搜索）",
            parameters={"type": "object", "properties": {
                "query": {"type": "string", "description": "搜索关键词或描述"},
                "wing": {"type": "string", "description": "限定搜索的知识翼（可选）"},
                "top_k": {"type": "integer", "description": "返回结果数量，默认5"},
            }, "required": ["query"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="manage_memory",
            description="管理知识图谱节点（创建、更新、删除）",
            parameters={"type": "object", "properties": {
                "action": {"type": "string", "enum": ["create", "update", "delete"], "description": "操作类型"},
                "node_id": {"type": "string", "description": "节点ID（update/delete时必填）"},
                "name": {"type": "string", "description": "节点名称"},
                "wing": {"type": "string", "description": "知识翼：世界/角色/剧情/灵感"},
                "summary": {"type": "string", "description": "摘要"},
                "detail": {"type": "string", "description": "详细内容"},
                "category": {"type": "string", "description": "分类"},
                "importance": {"type": "string", "description": "重要性：low/normal/high/critical"},
                "tags": {"type": "array", "items": {"type": "string"}, "description": "标签列表"},
            }, "required": ["action"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="link_memory",
            description="在两个知识节点之间创建关系边",
            parameters={"type": "object", "properties": {
                "from_node_id": {"type": "string", "description": "源节点ID"},
                "to_node_id": {"type": "string", "description": "目标节点ID"},
                "edge_type": {"type": "string", "description": "关系类型：属于/关联/对立/因果/师徒/恋人等"},
                "note": {"type": "string", "description": "关系说明"},
            }, "required": ["from_node_id", "to_node_id", "edge_type"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="promote_to_shared",
            description="将知识提升为跨项目共享经验（其他项目也能学习到）",
            parameters={"type": "object", "properties": {
                "name": {"type": "string", "description": "知识名称"},
                "summary": {"type": "string", "description": "摘要"},
                "detail": {"type": "string", "description": "详细内容"},
                "category": {"type": "string", "description": "分类"},
                "tags": {"type": "array", "items": {"type": "string"}, "description": "标签列表"},
            }, "required": ["name", "summary"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="memory_status",
            description="""查看知识图谱的整体状态。
用途：开始写作任务前了解有哪些可用设定；不确定某知识是否存在时先看全貌。
listMode='summary' 返回统计摘要（省token）；listMode='ids' 返回全部节点目录（推荐，可配合 traverse_memory 使用）。""",
            parameters={"type": "object", "properties": {
                "listMode": {"type": "string", "enum": ["summary", "ids"], "description": "summary=只返回统计（默认）| ids=返回全部节点id+name+wing"},
            }, "required": []},
        )),
        ToolDefinition(function=ToolFunction(
            name="traverse_memory",
            description="""从指定节点出发，沿关系图走 N 步，发现关联知识。
和 query_memory 的区别：query_memory 按关键词搜索；traverse_memory 沿关系边走，返回关联路径。
用途：写某设定时查看关联设定；检查某规则影响了哪些设定；联想创作灵感。""",
            parameters={"type": "object", "properties": {
                "node_id": {"type": "string", "description": "起始节点ID（从 query_memory 或 memory_status 获取）"},
                "depth": {"type": "integer", "description": "遍历深度，默认2"},
                "edge_types": {"type": "array", "items": {"type": "string"}, "description": "限定关系类型（可选）：属于/关联/对立/因果等"},
            }, "required": ["node_id"]},
        )),
    ]


async def execute_memory_tool(tool_call: ToolCall, project_id: str) -> ToolResult:
    name = tool_call.name
    args = tool_call.arguments

    try:
        db = await get_db(project_id)

        if name == "query_memory":
            query = args["query"]
            wing = args.get("wing")
            top_k = args.get("top_k", 5)
            results = await hybrid_search(db, query, top_k=top_k, wing=wing)
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"results": results})

        elif name == "manage_memory":
            action = args["action"]

            if action == "create":
                node = await create_node(
                    db, project_id,
                    name=args.get("name", "未命名"),
                    wing=args.get("wing", "灵感"),
                    summary=args.get("summary", ""),
                    detail=args.get("detail", ""),
                    category=args.get("category", ""),
                    importance=args.get("importance", "normal"),
                    tags=args.get("tags"),
                )
                await db.close()
                return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"action": "created", "node": node})

            elif action == "update":
                node_id = args.get("node_id")
                if not node_id:
                    await db.close()
                    return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="更新需要node_id")
                node = await update_node(db, node_id, **{k: v for k, v in args.items() if k not in ("action", "node_id")})
                await db.close()
                if not node:
                    return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"节点不存在: {node_id}")
                return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"action": "updated", "node": node})

            elif action == "delete":
                node_id = args.get("node_id")
                if not node_id:
                    await db.close()
                    return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="删除需要node_id")
                ok = await delete_node(db, node_id)
                await db.close()
                if not ok:
                    return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"节点不存在: {node_id}")
                return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"action": "deleted", "node_id": node_id})

            else:
                await db.close()
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未知操作: {action}")

        elif name == "link_memory":
            edge = await create_edge(
                db, project_id,
                from_node_id=args["from_node_id"],
                to_node_id=args["to_node_id"],
                edge_type=args["edge_type"],
                note=args.get("note", ""),
            )
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"edge": edge})

        elif name == "promote_to_shared":
            from core.memory.evolutionary import promote_to_shared
            shared_db = await get_db(None)
            result = await promote_to_shared(
                shared_db,
                name=args["name"],
                summary=args["summary"],
                detail=args.get("detail", ""),
                category=args.get("category", ""),
                source_project_id=project_id,
                tags=args.get("tags"),
            )
            await shared_db.close()
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result=result)

        elif name == "memory_status":
            list_mode = args.get("listMode", "summary")

            # 获取所有节点
            nodes = await list_nodes(db, project_id)

            # 按 wing 分组统计
            wings: dict[str, int] = {}
            for n in nodes:
                wing = n.get("wing", "未分类")
                wings[wing] = wings.get(wing, 0) + 1

            # 获取边数量
            edges_result = await db.execute_fetchall(
                "SELECT COUNT(*) as cnt FROM knowledge_edges WHERE project_id = ?",
                (project_id,),
            )
            total_edges = dict(edges_result[0])["cnt"] if edges_result else 0

            result = {
                "totalNodes": len(nodes),
                "totalEdges": total_edges,
                "wings": wings,
            }

            if list_mode == "ids":
                result["nodes"] = [
                    {"id": n["id"], "name": n["name"], "wing": n.get("wing", "")}
                    for n in nodes
                ]

            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result=result)

        elif name == "traverse_memory":
            node_id = args.get("node_id")
            if not node_id:
                await db.close()
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="缺少 node_id 参数")

            depth = args.get("depth", 2)
            edge_types = args.get("edge_types")

            # 获取起始节点
            start_rows = await db.execute_fetchall(
                "SELECT * FROM knowledge_nodes WHERE id = ? AND project_id = ?",
                (node_id, project_id),
            )
            if not start_rows:
                await db.close()
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"节点不存在: {node_id}")

            start_node = dict(start_rows[0])

            # BFS 遍历
            visited = {node_id}
            frontier = [node_id]
            paths = []

            for _ in range(depth):
                next_frontier = []
                for current_id in frontier:
                    # 获取当前节点的所有边
                    edges = await get_edges_for_node(db, current_id, project_id)
                    for edge in edges:
                        target_id = edge["to_node_id"] if edge["from_node_id"] == current_id else edge["from_node_id"]
                        if target_id in visited:
                            continue
                        if edge_types and edge["edge_type"] not in edge_types:
                            continue
                        visited.add(target_id)
                        next_frontier.append(target_id)

                        # 获取目标节点信息
                        target_rows = await db.execute_fetchall(
                            "SELECT id, name, wing, summary FROM knowledge_nodes WHERE id = ?",
                            (target_id,),
                        )
                        if target_rows:
                            target = dict(target_rows[0])
                            paths.append({
                                "from": current_id,
                                "to": target_id,
                                "to_name": target.get("name", ""),
                                "to_wing": target.get("wing", ""),
                                "edge_type": edge["edge_type"],
                            })
                frontier = next_frontier

            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={
                "start": {"id": start_node["id"], "name": start_node["name"], "wing": start_node.get("wing", ""), "summary": start_node.get("summary", "")},
                "reachedCount": len(visited) - 1,
                "paths": paths,
            })

        else:
            await db.close()
            return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未知工具: {name}")

    except Exception as e:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=str(e))

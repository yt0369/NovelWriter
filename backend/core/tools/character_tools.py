import json
import time
import uuid

from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus
from db.database import get_db
from core.memory.graph import create_node, create_edge


PRESET_RELATION_TYPES = [
    "师徒", "同门", "朋友", "敌人", "恋人", "亲属", "上下级",
    "盟友", "对手", "暗恋", "宿敌", "契约", "守护", "利用",
]


def get_character_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="create_character",
            description="创建角色（同时创建知识图谱节点）",
            parameters={"type": "object", "properties": {
                "name": {"type": "string", "description": "角色名称"},
                "aliases": {"type": "string", "description": "别名，逗号分隔（可选）"},
                "role": {"type": "string", "description": "角色定位（可选）"},
                "profile_data": {"type": "string", "description": "角色详细资料JSON（可选）"},
            }, "required": ["name"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="update_character",
            description="更新角色信息",
            parameters={"type": "object", "properties": {
                "character_id": {"type": "string", "description": "角色ID"},
                "name": {"type": "string", "description": "角色名称（可选）"},
                "aliases": {"type": "string", "description": "别名（可选）"},
                "role": {"type": "string", "description": "角色定位（可选）"},
                "profile_data": {"type": "string", "description": "角色详细资料JSON（可选）"},
            }, "required": ["character_id"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="get_character_profile",
            description="获取角色详情",
            parameters={"type": "object", "properties": {
                "character_id": {"type": "string", "description": "角色ID"},
            }, "required": ["character_id"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="list_characters",
            description="列出所有角色",
            parameters={"type": "object", "properties": {}, "required": []},
        )),
        ToolDefinition(function=ToolFunction(
            name="link_characters",
            description="建立角色间的关系",
            parameters={"type": "object", "properties": {
                "from_character_id": {"type": "string", "description": "源角色ID"},
                "to_character_id": {"type": "string", "description": "目标角色ID"},
                "edge_type": {"type": "string", "description": "关系类型"},
                "note": {"type": "string", "description": "关系说明（可选）"},
            }, "required": ["from_character_id", "to_character_id", "edge_type"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="query_relationships",
            description=f"【查询人际关系】查询角色关系网络。支持按角色名、关系类型、目标角色、描述关键词搜索。返回匹配的关系列表。预设关系类型：{'、'.join(PRESET_RELATION_TYPES)}",
            parameters={"type": "object", "properties": {
                "character_name": {"type": "string", "description": "查询特定角色的所有关系（可选）"},
                "target_name": {"type": "string", "description": "查询两个特定角色之间的关系（可选）"},
                "relation_type": {"type": "string", "description": f"按关系类型筛选。预设类型：{'、'.join(PRESET_RELATION_TYPES)}（可选）"},
                "keyword": {"type": "string", "description": "按关系描述中的关键词模糊搜索（可选）"},
            }, "required": []},
        )),
        ToolDefinition(function=ToolFunction(
            name="manage_relationships",
            description=f"【批量管理人际关系】批量添加、更新、删除角色之间的关系。预设类型：{'、'.join(PRESET_RELATION_TYPES)}。强度：强（核心关系）、中（重要关系）、弱（次要关系）。",
            parameters={"type": "object", "properties": {
                "actions": {"type": "array", "description": "操作列表", "items": {"type": "object", "properties": {
                    "action": {"type": "string", "enum": ["add", "update", "delete"], "description": "操作类型"},
                    "from_name": {"type": "string", "description": "源角色名称"},
                    "to_name": {"type": "string", "description": "目标角色名称"},
                    "relation_type": {"type": "string", "description": "关系类型"},
                    "strength": {"type": "string", "enum": ["强", "中", "弱"], "description": "关系强度"},
                    "description": {"type": "string", "description": "关系描述"},
                    "is_bidirectional": {"type": "boolean", "description": "是否双向关系"},
                    "edge_id": {"type": "string", "description": "关系ID（update/delete时必填）"},
                }, "required": ["action"]}},
            }, "required": ["actions"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="manage_sub_category",
            description="【角色档案子分类管理】在角色档案的分类中添加、更新、删除子分类条目。分类类型：状态/属性/目标/技能/关系/经历/记忆。",
            parameters={"type": "object", "properties": {
                "character_id": {"type": "string", "description": "角色ID"},
                "category": {"type": "string", "enum": ["状态", "属性", "目标", "技能", "关系", "经历", "记忆"], "description": "分类名称"},
                "action": {"type": "string", "enum": ["add", "update", "delete", "list"], "description": "操作类型"},
                "entry_id": {"type": "string", "description": "条目ID（update/delete时必填）"},
                "entry_data": {"type": "object", "description": "条目数据（add/update时必填）", "properties": {
                    "title": {"type": "string", "description": "条目标题"},
                    "content": {"type": "string", "description": "条目内容"},
                    "importance": {"type": "string", "enum": ["low", "medium", "high", "critical"], "description": "重要度"},
                }},
            }, "required": ["character_id", "category", "action"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="archive_entry",
            description="【角色档案归档】归档或取消归档角色档案中的条目。用于管理积累型分类（关系/经历/记忆）的历史条目。",
            parameters={"type": "object", "properties": {
                "character_id": {"type": "string", "description": "角色ID"},
                "category": {"type": "string", "enum": ["关系", "经历", "记忆"], "description": "分类名称"},
                "action": {"type": "string", "enum": ["archive", "unarchive", "list_archived"], "description": "操作类型"},
                "entry_id": {"type": "string", "description": "条目ID（archive/unarchive时必填）"},
            }, "required": ["character_id", "category", "action"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="get_relationship_graph",
            description="【获取关系图谱】返回角色关系网络数据（节点+边），用于前端可视化。支持按角色ID过滤。",
            parameters={"type": "object", "properties": {
                "character_id": {"type": "string", "description": "中心角色ID（可选，不填则返回全部关系）"},
                "depth": {"type": "number", "description": "关系深度（默认2，最多3）"},
            }, "required": []},
        )),
    ]


async def execute_character_tool(tool_call: ToolCall, project_id: str) -> ToolResult:
    name = tool_call.name
    args = tool_call.arguments

    try:
        db = await get_db(project_id)

        if name == "create_character":
            char_id = str(uuid.uuid4())[:8]
            now = int(time.time())
            profile_data = args.get("profile_data")
            node = await create_node(
                db, project_id,
                name=args["name"],
                wing="角色",
                summary=args.get("aliases", ""),
                detail=profile_data or "",
                importance="normal",
            )
            await db.execute(
                "INSERT INTO character_profiles (id, project_id, name, aliases, role, profile_data, file_path, created_at, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (char_id, project_id, args["name"], args.get("aliases"), args.get("role"), profile_data, None, now, now),
            )
            await db.commit()
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"id": char_id, "name": args["name"], "knowledge_node_id": node["id"]})

        elif name == "update_character":
            character_id = args["character_id"]
            updates = {}
            for key in ("name", "aliases", "role", "profile_data"):
                if key in args and args[key] is not None:
                    updates[key] = args[key]
            if not updates:
                await db.close()
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="没有需要更新的字段")
            updates["last_modified"] = int(time.time())
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [character_id, project_id]
            await db.execute(f"UPDATE character_profiles SET {set_clause} WHERE id = ? AND project_id = ?", values)
            await db.commit()
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"id": character_id, "updated": list(updates.keys())})

        elif name == "get_character_profile":
            character_id = args["character_id"]
            rows = await db.execute_fetchall(
                "SELECT * FROM character_profiles WHERE id = ? AND project_id = ?",
                (character_id, project_id),
            )
            await db.close()
            if not rows:
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"角色不存在: {character_id}")
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"character": dict(rows[0])})

        elif name == "list_characters":
            rows = await db.execute_fetchall(
                "SELECT id, name, aliases, role FROM character_profiles WHERE project_id = ? ORDER BY created_at",
                (project_id,),
            )
            characters = [dict(r) for r in rows]
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"characters": characters})

        elif name == "link_characters":
            from_id = args["from_character_id"]
            to_id = args["to_character_id"]
            edge_type = args["edge_type"]
            note = args.get("note", "")
            from_rows = await db.execute_fetchall(
                "SELECT id FROM knowledge_nodes WHERE name IN (SELECT name FROM character_profiles WHERE id = ?) AND project_id = ? AND wing = '角色'",
                (from_id, project_id),
            )
            to_rows = await db.execute_fetchall(
                "SELECT id FROM knowledge_nodes WHERE name IN (SELECT name FROM character_profiles WHERE id = ?) AND project_id = ? AND wing = '角色'",
                (to_id, project_id),
            )
            if not from_rows:
                await db.close()
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未找到角色对应的知识节点: {from_id}")
            if not to_rows:
                await db.close()
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未找到角色对应的知识节点: {to_id}")
            edge = await create_edge(
                db, project_id,
                from_node_id=from_rows[0]["id"],
                to_node_id=to_rows[0]["id"],
                edge_type=edge_type,
                note=note,
            )
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"edge": edge})

        elif name == "query_relationships":
            char_name = args.get("character_name")
            target_name = args.get("target_name")
            rel_type = args.get("relation_type")
            keyword = args.get("keyword")

            query = """
                SELECT e.id, e.edge_type, e.note, e.created_at,
                       fn.name as from_name, tn.name as to_name
                FROM knowledge_edges e
                JOIN knowledge_nodes fn ON e.from_node_id = fn.id
                JOIN knowledge_nodes tn ON e.to_node_id = tn.id
                WHERE e.project_id = ? AND fn.wing = '角色' AND tn.wing = '角色'
            """
            params: list = [project_id]

            if char_name and target_name:
                query += " AND ((fn.name = ? AND tn.name = ?) OR (fn.name = ? AND tn.name = ?))"
                params.extend([char_name, target_name, target_name, char_name])
            elif char_name:
                query += " AND (fn.name = ? OR tn.name = ?)"
                params.extend([char_name, char_name])

            if rel_type:
                query += " AND e.edge_type = ?"
                params.append(rel_type)

            if keyword:
                query += " AND e.note LIKE ?"
                params.append(f"%{keyword}%")

            query += " ORDER BY e.created_at DESC"
            rows = await db.execute_fetchall(query, params)
            relationships = []
            for r in rows:
                row = dict(r)
                # 解析 note 中的 JSON 元数据
                try:
                    meta = json.loads(row["note"]) if row["note"] else {}
                except (json.JSONDecodeError, TypeError):
                    meta = {"description": row["note"] or ""}
                relationships.append({
                    "id": row["id"],
                    "from_name": row["from_name"],
                    "to_name": row["to_name"],
                    "relation_type": row["edge_type"],
                    "strength": meta.get("strength", "中"),
                    "description": meta.get("description", ""),
                    "is_bidirectional": meta.get("is_bidirectional", True),
                    "created_at": row["created_at"],
                })
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"relationships": relationships, "count": len(relationships)})

        elif name == "manage_relationships":
            actions = args.get("actions", [])
            results = []
            for act in actions:
                act_type = act.get("action")
                from_name = act.get("from_name", "")
                to_name = act.get("to_name", "")
                rel_type = act.get("relation_type", "")
                strength = act.get("strength", "中")
                description = act.get("description", "")
                is_bidirectional = act.get("is_bidirectional", True)
                edge_id = act.get("edge_id", "")

                if act_type == "add":
                    # 查找角色对应的知识节点
                    from_rows = await db.execute_fetchall(
                        "SELECT id FROM knowledge_nodes WHERE name = ? AND project_id = ? AND wing = '角色'",
                        (from_name, project_id),
                    )
                    to_rows = await db.execute_fetchall(
                        "SELECT id FROM knowledge_nodes WHERE name = ? AND project_id = ? AND wing = '角色'",
                        (to_name, project_id),
                    )
                    if not from_rows:
                        results.append({"action": "add", "status": "error", "error": f"角色不存在: {from_name}"})
                        continue
                    if not to_rows:
                        results.append({"action": "add", "status": "error", "error": f"角色不存在: {to_name}"})
                        continue
                    note_meta = json.dumps({"strength": strength, "description": description, "is_bidirectional": is_bidirectional}, ensure_ascii=False)
                    edge = await create_edge(
                        db, project_id,
                        from_node_id=from_rows[0]["id"],
                        to_node_id=to_rows[0]["id"],
                        edge_type=rel_type,
                        note=note_meta,
                    )
                    results.append({"action": "add", "status": "ok", "edge_id": edge["id"], "from": from_name, "to": to_name, "type": rel_type})

                elif act_type == "update":
                    if not edge_id:
                        results.append({"action": "update", "status": "error", "error": "缺少 edge_id"})
                        continue
                    note_meta = json.dumps({"strength": strength, "description": description, "is_bidirectional": is_bidirectional}, ensure_ascii=False)
                    await db.execute(
                        "UPDATE knowledge_edges SET edge_type = ?, note = ? WHERE id = ? AND project_id = ?",
                        (rel_type, note_meta, edge_id, project_id),
                    )
                    results.append({"action": "update", "status": "ok", "edge_id": edge_id})

                elif act_type == "delete":
                    if not edge_id:
                        results.append({"action": "delete", "status": "error", "error": "缺少 edge_id"})
                        continue
                    await db.execute("DELETE FROM knowledge_edges WHERE id = ? AND project_id = ?", (edge_id, project_id))
                    results.append({"action": "delete", "status": "ok", "edge_id": edge_id})

            await db.commit()
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"results": results, "total": len(actions)})

        elif name == "manage_sub_category":
            character_id = args["character_id"]
            category = args["category"]
            action = args["action"]
            entry_id = args.get("entry_id")
            entry_data = args.get("entry_data", {})

            rows = await db.execute_fetchall(
                "SELECT profile_data FROM character_profiles WHERE id = ? AND project_id = ?",
                (character_id, project_id),
            )
            if not rows:
                await db.close()
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"角色不存在: {character_id}")

            profile_data = json.loads(rows[0]["profile_data"] or "{}")
            if category not in profile_data:
                profile_data[category] = {"entries": [], "archived": []}

            cat_data = profile_data[category]
            if not isinstance(cat_data, dict):
                cat_data = {"entries": [], "archived": []}
                profile_data[category] = cat_data

            entries = cat_data.get("entries", [])

            if action == "list":
                await db.close()
                return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"entries": entries, "count": len(entries)})

            elif action == "add":
                new_entry = {
                    "id": f"sub-{uuid.uuid4().hex[:8]}",
                    "title": entry_data.get("title", ""),
                    "content": entry_data.get("content", ""),
                    "importance": entry_data.get("importance", "medium"),
                    "created_at": int(time.time()),
                }
                entries.append(new_entry)
                cat_data["entries"] = entries
                profile_data[category] = cat_data
                await db.execute(
                    "UPDATE character_profiles SET profile_data = ?, last_modified = ? WHERE id = ? AND project_id = ?",
                    (json.dumps(profile_data, ensure_ascii=False), int(time.time()), character_id, project_id),
                )
                await db.commit()
                await db.close()
                return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"entry": new_entry, "action": "added"})

            elif action == "update":
                if not entry_id:
                    await db.close()
                    return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="缺少 entry_id")
                for entry in entries:
                    if entry["id"] == entry_id:
                        entry.update(entry_data)
                        entry["updated_at"] = int(time.time())
                        break
                else:
                    await db.close()
                    return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"条目不存在: {entry_id}")
                cat_data["entries"] = entries
                profile_data[category] = cat_data
                await db.execute(
                    "UPDATE character_profiles SET profile_data = ?, last_modified = ? WHERE id = ? AND project_id = ?",
                    (json.dumps(profile_data, ensure_ascii=False), int(time.time()), character_id, project_id),
                )
                await db.commit()
                await db.close()
                return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"entry_id": entry_id, "action": "updated"})

            elif action == "delete":
                if not entry_id:
                    await db.close()
                    return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="缺少 entry_id")
                cat_data["entries"] = [e for e in entries if e["id"] != entry_id]
                profile_data[category] = cat_data
                await db.execute(
                    "UPDATE character_profiles SET profile_data = ?, last_modified = ? WHERE id = ? AND project_id = ?",
                    (json.dumps(profile_data, ensure_ascii=False), int(time.time()), character_id, project_id),
                )
                await db.commit()
                await db.close()
                return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"entry_id": entry_id, "action": "deleted"})

        elif name == "archive_entry":
            character_id = args["character_id"]
            category = args["category"]
            action = args["action"]
            entry_id = args.get("entry_id")

            rows = await db.execute_fetchall(
                "SELECT profile_data FROM character_profiles WHERE id = ? AND project_id = ?",
                (character_id, project_id),
            )
            if not rows:
                await db.close()
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"角色不存在: {character_id}")

            profile_data = json.loads(rows[0]["profile_data"] or "{}")
            if category not in profile_data:
                profile_data[category] = {"entries": [], "archived": []}

            cat_data = profile_data[category]
            if not isinstance(cat_data, dict):
                cat_data = {"entries": [], "archived": []}
                profile_data[category] = cat_data

            entries = cat_data.get("entries", [])
            archived = cat_data.get("archived", [])

            if action == "list_archived":
                await db.close()
                return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"archived": archived, "count": len(archived)})

            elif action == "archive":
                if not entry_id:
                    await db.close()
                    return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="缺少 entry_id")
                entry_to_archive = None
                remaining = []
                for e in entries:
                    if e["id"] == entry_id:
                        entry_to_archive = e
                    else:
                        remaining.append(e)
                if not entry_to_archive:
                    await db.close()
                    return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"条目不存在: {entry_id}")
                entry_to_archive["archived_at"] = int(time.time())
                archived.append(entry_to_archive)
                cat_data["entries"] = remaining
                cat_data["archived"] = archived
                profile_data[category] = cat_data
                await db.execute(
                    "UPDATE character_profiles SET profile_data = ?, last_modified = ? WHERE id = ? AND project_id = ?",
                    (json.dumps(profile_data, ensure_ascii=False), int(time.time()), character_id, project_id),
                )
                await db.commit()
                await db.close()
                return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"entry_id": entry_id, "action": "archived"})

            elif action == "unarchive":
                if not entry_id:
                    await db.close()
                    return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="缺少 entry_id")
                entry_to_unarchive = None
                remaining = []
                for e in archived:
                    if e["id"] == entry_id:
                        entry_to_unarchive = e
                    else:
                        remaining.append(e)
                if not entry_to_unarchive:
                    await db.close()
                    return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"归档条目不存在: {entry_id}")
                entry_to_unarchive.pop("archived_at", None)
                entries.append(entry_to_unarchive)
                cat_data["entries"] = entries
                cat_data["archived"] = remaining
                profile_data[category] = cat_data
                await db.execute(
                    "UPDATE character_profiles SET profile_data = ?, last_modified = ? WHERE id = ? AND project_id = ?",
                    (json.dumps(profile_data, ensure_ascii=False), int(time.time()), character_id, project_id),
                )
                await db.commit()
                await db.close()
                return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"entry_id": entry_id, "action": "unarchived"})

        elif name == "get_relationship_graph":
            character_id = args.get("character_id")
            depth = min(args.get("depth", 2), 3)

            # 获取所有角色关系
            query = """
                SELECT e.id, e.edge_type, e.note,
                       fn.id as from_id, fn.name as from_name,
                       tn.id as to_id, tn.name as to_name
                FROM knowledge_edges e
                JOIN knowledge_nodes fn ON e.from_node_id = fn.id
                JOIN knowledge_nodes tn ON e.to_node_id = tn.id
                WHERE e.project_id = ? AND fn.wing = '角色' AND tn.wing = '角色'
            """
            params = [project_id]
            rows = await db.execute_fetchall(query, params)

            nodes = {}
            edges = []

            for r in rows:
                row = dict(r)
                from_id = row["from_id"]
                to_id = row["to_id"]

                if from_id not in nodes:
                    nodes[from_id] = {"id": from_id, "name": row["from_name"]}
                if to_id not in nodes:
                    nodes[to_id] = {"id": to_id, "name": row["to_name"]}

                edges.append({
                    "id": row["id"],
                    "source": from_id,
                    "target": to_id,
                    "relation_type": row["edge_type"],
                    "note": row["note"] or "",
                })

            # 如果指定了中心角色，过滤相关节点
            if character_id:
                connected_ids = set()
                connected_ids.add(character_id)
                for _ in range(depth):
                    for edge in edges:
                        if edge["source"] in connected_ids:
                            connected_ids.add(edge["target"])
                        if edge["target"] in connected_ids:
                            connected_ids.add(edge["source"])
                nodes = {k: v for k, v in nodes.items() if k in connected_ids}
                edges = [e for e in edges if e["source"] in connected_ids and e["target"] in connected_ids]

            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={
                "nodes": list(nodes.values()),
                "edges": edges,
                "node_count": len(nodes),
                "edge_count": len(edges),
            })

        else:
            await db.close()
            return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未知工具: {name}")

    except Exception as e:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=str(e))

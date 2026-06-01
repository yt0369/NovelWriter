import json
import time
import uuid
from typing import Any

from db.database import get_db


def build_workflow_result(
    workflow_type: str,
    status: str,
    input_data: dict[str, Any] | None = None,
    output_data: dict[str, Any] | None = None,
    error: str | None = None,
    workflow_run_id: str | None = None,
) -> dict[str, Any]:
    input_payload = input_data or {}
    output_payload = output_data or {}
    result: dict[str, Any] = {
        "workflow_type": workflow_type,
        "status": status,
        "input": input_payload,
        "output": output_payload,
    }
    if workflow_run_id:
        result["workflow_run_id"] = workflow_run_id
    if error:
        result["error"] = error
    result.update(output_payload)
    return result


async def record_workflow_run(
    project_id: str,
    workflow_type: str,
    status: str,
    input_data: dict[str, Any] | None = None,
    output_data: dict[str, Any] | None = None,
    error: str | None = None,
) -> str:
    run_id = str(uuid.uuid4())[:8]
    now = int(time.time())
    db = await get_db(project_id)
    try:
        await db.execute(
            """INSERT INTO workflow_runs (id, project_id, workflow_type, status, input, output, error, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run_id,
                project_id,
                workflow_type,
                status,
                json.dumps(input_data or {}, ensure_ascii=False),
                json.dumps(output_data or {}, ensure_ascii=False),
                error,
                now,
                now,
            ),
        )
        await db.commit()
    finally:
        await db.close()
    return run_id


async def record_workflow_result(
    project_id: str,
    workflow_type: str,
    status: str,
    input_data: dict[str, Any] | None = None,
    output_data: dict[str, Any] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    run_id = await record_workflow_run(project_id, workflow_type, status, input_data, output_data, error)
    return build_workflow_result(
        workflow_type=workflow_type,
        status=status,
        input_data=input_data,
        output_data=output_data,
        error=error,
        workflow_run_id=run_id,
    )

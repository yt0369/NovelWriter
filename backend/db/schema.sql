-- Projects
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    genre TEXT,
    words_per_chapter INTEGER DEFAULT 3000,
    target_chapters INTEGER,
    chapters_per_volume INTEGER,
    preset_id TEXT,
    tags TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    last_modified INTEGER NOT NULL
);

-- Knowledge Graph
CREATE TABLE IF NOT EXISTS knowledge_nodes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    summary TEXT,
    detail TEXT,
    wing TEXT NOT NULL,
    room TEXT,
    category TEXT,
    sub_category TEXT,
    importance TEXT DEFAULT 'normal',
    tags TEXT,
    embedding BLOB,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    last_modified INTEGER NOT NULL,
    accessed_at INTEGER,
    access_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_kn_project ON knowledge_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_kn_wing ON knowledge_nodes(project_id, wing);

CREATE TABLE IF NOT EXISTS knowledge_edges (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    from_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    to_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    edge_type TEXT NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ke_project ON knowledge_edges(project_id);

-- Timeline
CREATE TABLE IF NOT EXISTS timeline_volumes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS timeline_chapters (
    id TEXT PRIMARY KEY,
    volume_id TEXT REFERENCES timeline_volumes(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    summary TEXT,
    sort_order INTEGER NOT NULL,
    file_path TEXT
);

CREATE TABLE IF NOT EXISTS timeline_events (
    id TEXT PRIMARY KEY,
    chapter_id TEXT REFERENCES timeline_chapters(id) ON DELETE SET NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    day INTEGER,
    hour INTEGER,
    story_line_id TEXT,
    status TEXT DEFAULT 'planned',
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS story_lines (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    is_main INTEGER DEFAULT 0
);

-- Foreshadowing
CREATE TABLE IF NOT EXISTS foreshadowing (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    plant_chapter_id TEXT,
    resolve_chapter_id TEXT,
    status TEXT DEFAULT 'planted',
    created_at INTEGER NOT NULL
);

-- Characters
CREATE TABLE IF NOT EXISTS character_profiles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    aliases TEXT,
    role TEXT,
    profile_data TEXT,
    file_path TEXT,
    created_at INTEGER NOT NULL,
    last_modified INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS character_state_history (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
    character_name TEXT NOT NULL,
    source_file_path TEXT,
    chapter_index INTEGER,
    state_summary TEXT,
    location TEXT,
    goal TEXT,
    emotion TEXT,
    health TEXT,
    abilities TEXT,
    relationships TEXT,
    evidence TEXT,
    confidence REAL,
    payload TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_csh_project_character ON character_state_history(project_id, character_id, chapter_index, created_at);
CREATE INDEX IF NOT EXISTS idx_csh_project_chapter ON character_state_history(project_id, chapter_index, created_at);

-- Agent Todo Items
CREATE TABLE IF NOT EXISTS todo_items (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    priority TEXT NOT NULL DEFAULT 'normal',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todo_project_done ON todo_items(project_id, done, created_at);

-- Chat
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    plan_mode_enabled INTEGER DEFAULT 0,
    thinking_enabled INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_modified INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    raw_parts TEXT,
    is_tool_output INTEGER DEFAULT 0,
    skip_in_history INTEGER DEFAULT 0,
    is_error INTEGER DEFAULT 0,
    metadata TEXT,
    timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cm_session ON chat_messages(session_id, timestamp);

-- File Versions
CREATE TABLE IF NOT EXISTS file_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fv_path ON file_versions(project_id, file_path);

-- Pending file changes produced by AI/workflows before user approval
CREATE TABLE IF NOT EXISTS pending_changes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    original_content TEXT NOT NULL,
    new_content TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    source TEXT NOT NULL DEFAULT 'agent',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pc_project_status ON pending_changes(project_id, status, created_at);

-- Workflow runs for structured writing flows
CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workflow_type TEXT NOT NULL,
    status TEXT NOT NULL,
    input TEXT,
    output TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wr_project ON workflow_runs(project_id, created_at);

-- Chapter-level consistency tasks generated from readiness and context risks
CREATE TABLE IF NOT EXISTS chapter_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    chapter_index INTEGER NOT NULL,
    title TEXT,
    task_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    source_type TEXT,
    source_id TEXT,
    source_file_path TEXT,
    fingerprint TEXT NOT NULL,
    label TEXT NOT NULL,
    detail TEXT,
    evidence TEXT,
    suggestion TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ct_project_fingerprint ON chapter_tasks(project_id, chapter_index, fingerprint);
CREATE INDEX IF NOT EXISTS idx_ct_project_chapter ON chapter_tasks(project_id, chapter_index, status, severity);

-- AI-extracted knowledge candidates awaiting user confirmation
CREATE TABLE IF NOT EXISTS knowledge_candidates (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_file_path TEXT,
    candidate_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kc_project_status ON knowledge_candidates(project_id, status, created_at);

-- Chapter summaries for long-form context retrieval
CREATE TABLE IF NOT EXISTS chapter_summaries (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    characters TEXT,
    key_events TEXT,
    foreshadowing TEXT,
    embedding BLOB,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cs_project_file ON chapter_summaries(project_id, file_path);

-- Per-project skill activation/default settings
CREATE TABLE IF NOT EXISTS project_skill_settings (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pss_project_skill ON project_skill_settings(project_id, skill_id);

-- Global Settings
CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Shared Knowledge (cross-project evolutionary memory)
CREATE TABLE IF NOT EXISTS shared_knowledge (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    summary TEXT,
    detail TEXT,
    category TEXT,
    source_project_id TEXT,
    source_node_id TEXT,
    embedding BLOB,
    tags TEXT,
    created_at INTEGER NOT NULL,
    last_modified INTEGER NOT NULL
);

-- Entity Versions (character/knowledge node version history)
CREATE TABLE IF NOT EXISTS entity_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    change_summary TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ev_entity ON entity_versions(entity_type, entity_id, version);

-- Execution Plans (agent execution plan persistence)
CREATE TABLE IF NOT EXISTS execution_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ep_session ON execution_plans(session_id);

-- Agent Memories (evolution system - cross-project learning)
CREATE TABLE IF NOT EXISTS agent_memories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    context TEXT,
    importance TEXT DEFAULT 'medium',
    related_skills TEXT,
    access_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    accessed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_am_project ON agent_memories(project_id, type);

-- Plan Notes (structured plan approval workflow)
CREATE TABLE IF NOT EXISTS plan_notes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pn_project ON plan_notes(project_id, status);

CREATE TABLE IF NOT EXISTS plan_note_lines (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plan_notes(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    order_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_note_annotations (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plan_notes(id) ON DELETE CASCADE,
    line_id TEXT NOT NULL REFERENCES plan_note_lines(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

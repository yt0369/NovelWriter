# NovelWriter

AI 驱动的小说创作助手，结合了智能代理、记忆系统和专业的写作技能，帮助你高效创作小说。

## 功能特性

- 🤖 **智能代理系统** - 基于多代理架构，提供智能写作辅助
- 🧠 **记忆系统** - 持久化的知识图谱和记忆管理
- 🎭 **角色管理** - 完整的角色创建、发展和关系管理
- 📝 **大纲规划** - 结构化的故事大纲和时间线管理
- ⚡ **伏笔追踪** - 智能的伏笔设置和回收管理
- 🔧 **写作技能库** - 多种专业的小说写作技能（角色设计、对话创作、大纲架构、世界构建等）
- 🎨 **多流派支持** - 支持科幻、武侠、玄幻、悬疑、言情等多种流派
- 📊 **版本控制** - 实体版本历史和变更追踪
- 🌐 **现代前端界面** - 基于 React + TypeScript + Vite

## 技术栈

### 后端
- **框架**: FastAPI (Python)
- **数据库**: SQLite + aiosqlite
- **AI 集成**: OpenAI 兼容接口（支持 OpenAI、DeepSeek、BlazeAI、SkyClaw 等）
- **向量搜索**: sentence-transformers
- **快速模糊匹配**: rapidfuzz

### 前端
- **框架**: React 19 + TypeScript
- **构建工具**: Vite
- **路由**: React Router
- **状态管理**: Zustand
- **Markdown 渲染**: react-markdown + remark-gfm

## 快速开始

### 前置要求

- Python 3.10+
- Node.js 18+
- npm 或 pnpm

### 安装与运行

#### 1. 克隆仓库

```bash
git clone https://github.com/yt0369/NovelWriter.git
cd NovelWriter
```

#### 2. 后端设置

```bash
cd backend

# 使用 Python venv 或 uv
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
# 或
.venv\Scripts\activate  # Windows

# 安装依赖
pip install -r requirements.txt

# 配置 API
cp backends.json.example backends.json
# 编辑 backends.json，填入你的 API 密钥
```

#### 3. 前端设置

```bash
cd frontend

# 安装依赖
npm install
# 或
pnpm install

# 开发模式运行
npm run dev
```

#### 4. 启动后端

```bash
cd backend
python main.py
```

后端将在 `http://localhost:8000` 运行

## 配置说明

### API 配置

编辑 `backend/backends.json` 来配置 AI 提供商：

```json
[
  {
    "id": "openai",
    "name": "OpenAI",
    "base_url": "https://api.openai.com/v1",
    "api_key": "your-api-key-here",
    "model_name": "gpt-4o",
    "temperature": 0.7,
    "top_p": 0.95,
    "top_k": 20
  }
]
```

支持的提供商：
- OpenAI
- DeepSeek
- BlazeAI
- SkyClaw
- 以及其他 OpenAI 兼容接口

### 其他配置

其他配置项可以在 `backend/config.py` 或通过环境变量设置。

## 使用说明

1. **创建项目** - 启动应用后，先创建一个新的小说项目
2. **设置 AI** - 在设置中配置 AI 提供商和模型
3. **开始创作** - 使用大纲、角色、时间线等功能规划你的小说
4. **AI 辅助** - 使用智能代理和写作技能来辅助创作

## 项目结构

```
NovelWriter/
├── backend/
│   ├── main.py                 # FastAPI 入口
│   ├── api/                    # API 路由
│   ├── core/                   # 核心逻辑
│   │   ├── agent/              # 智能代理
│   │   ├── memory/             # 记忆系统
│   │   ├── skills/             # 写作技能
│   │   └── tools/              # 工具集
│   ├── models/                 # 数据模型
│   ├── db/                     # 数据库
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/         # React 组件
│   │   ├── stores/             # Zustand 状态
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

## 开发指南

### 后端开发

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 前端开发

```bash
cd frontend
npm run dev
```

访问 `http://localhost:5173`

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License

# 🎓 Socratic Mentor: Voice-First GitHub Repo Onboarding

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![AI Powered](https://img.shields.io/badge/AI-Llama%203.3-blue)](https://developers.cloudflare.com/workers-ai/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> **⚠️ This README is a living document and is continually updated throughout development.**

A voice-first AI agent that helps developers onboard to unfamiliar GitHub repositories through Socratic dialogue. Paste a repo URL, speak your goals, and the agent will guide you through curated prerequisite readings, build a repo primer, quiz you with thought-provoking questions, and generate personalized study plans with flashcards.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Why Cloudflare?](#why-cloudflare)
- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Development](#development)
- [Deployment](#deployment)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## 🌟 Overview

**Socratic Mentor** is designed to solve a common problem: understanding a new codebase quickly and deeply. Instead of passively reading documentation, this AI agent actively engages you through:

1. **Repository Analysis**: Crawls the target GitHub repo to extract structure, key files, and code hotspots
2. **Prerequisite Curation**: Assembles foundational concepts and external documentation needed
3. **Socratic Dialogue**: Conducts an interactive voice/text walk-through with targeted questions
4. **Personalized Learning**: Remembers what stumped you and generates a 10-15 minute micro-study plan
5. **Flashcard Generation**: Creates 5 concept-focused flashcards for retention

This project is built entirely on Cloudflare's edge platform, demonstrating production-ready AI application architecture.

---

## ☁️ Why Cloudflare?

This project leverages Cloudflare's comprehensive edge computing stack to deliver a fast, scalable, and cost-effective AI experience:

| **Component** | **Cloudflare Service** | **Why It Matters** |
|---------------|------------------------|-------------------|
| **LLM Inference** | Workers AI (Llama 3.3) | Low-latency AI inference at the edge without managing infrastructure |
| **Orchestration** | Cloudflare Agents | Structured tool use, workflow coordination, multi-step reasoning |
| **Voice I/O** | Realtime API | WebRTC-based voice streaming with sub-100ms latency |
| **Session State** | Durable Objects | Persistent WebSocket connections + per-user state management |
| **Memory** | Vectorize | Semantic search over repo embeddings and user interaction history |
| **Preferences** | Workers KV | Fast, eventually-consistent key-value storage for user settings |
| **Caching** | R2 Storage | Cost-effective object storage for repo snapshots |
| **Frontend** | Pages | Git-integrated static site hosting with automatic deployments |

**Benefits:**
- ✅ **Zero cold starts** for AI inference
- ✅ **Global edge deployment** (~300 data centers)
- ✅ **Unified billing** and developer experience
- ✅ **Built-in observability** (logs, traces, analytics)
- ✅ **No server management** required

---

## ✨ Features

### Assignment Rubric Compliance

This project meets all requirements for the Cloudflare AI assignment:

- [x] **LLM**: Uses Llama 3.3 via Workers AI for Socratic dialogue and content generation
- [x] **Workflow/Coordination**: Cloudflare Agents orchestrate multi-step repo analysis and quiz generation
- [x] **User Input (Voice)**: Realtime API for primary voice interaction + text fallback via Pages frontend
- [x] **Memory/State**: Durable Objects for session state + Vectorize for semantic memory of concepts and user struggles

### Core Capabilities

- **🎙️ Voice-First UX**: Speak your learning goals and receive audio responses
- **📂 Intelligent Repo Parsing**: Extracts file structure, dependencies, key modules
- **🧠 Concept Extraction**: Identifies prerequisite knowledge (algorithms, patterns, frameworks)
- **❓ Socratic Questioning**: Guides understanding through targeted, scaffolded questions
- **📝 Study Plan Generation**: Creates time-boxed learning paths (10-15 min) based on your gaps
- **🃏 Flashcard Creation**: Generates 5 spaced-repetition-ready cards for concept retention
- **💾 Persistent Memory**: Tracks your progress across sessions

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare Edge                         │
│                                                             │
│  ┌──────────────┐         ┌──────────────────────┐        │
│  │   Pages      │◄────────┤  Cloudflare Realtime │        │
│  │  (Frontend)  │  WebRTC │   (Voice Streaming)   │        │
│  └──────┬───────┘         └──────────────────────┘        │
│         │                                                   │
│         │ HTTP/WS                                          │
│         ▼                                                   │
│  ┌──────────────────────────────────────────────────┐     │
│  │           Workers (Hono Router)                   │     │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │     │
│  │  │ agent.ts │  │github.ts │  │vectorize.ts  │  │     │
│  │  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │     │
│  └───────┼─────────────┼────────────────┼──────────┘     │
│          │             │                │                  │
│          ▼             ▼                ▼                  │
│  ┌──────────────┐ ┌─────────┐  ┌──────────────┐         │
│  │  Workers AI  │ │ GitHub  │  │  Vectorize   │         │
│  │ (Llama 3.3)  │ │   API   │  │  (Embeddings)│         │
│  └──────────────┘ └─────────┘  └──────────────┘         │
│                                                             │
│  ┌──────────────────┐  ┌─────────┐  ┌──────────┐         │
│  │ Durable Objects  │  │   KV    │  │    R2    │         │
│  │ (Session State)  │  │ (Prefs) │  │ (Cache)  │         │
│  └──────────────────┘  └─────────┘  └──────────┘         │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User speaks/types** repo URL + goal → Frontend (Pages)
2. **Frontend establishes** WebSocket/WebRTC → Durable Object
3. **Durable Object routes** request → Agent Worker
4. **Agent Worker**:
   - Calls `github.ts` tool → GitHub API (fetch repo structure)
   - Generates embeddings → Vectorize (stores file/concept vectors)
   - Invokes Workers AI → Llama 3.3 (generates Socratic prompts)
   - Returns structured response → Durable Object
5. **Durable Object** streams audio/text → Frontend
6. **Repeat** for quiz, study plan, flashcards

---

## 📦 Prerequisites

Before you begin, ensure you have:

- **Node.js** 18+ and npm/pnpm/yarn installed
- **Wrangler CLI**: `npm install -g wrangler` ([Docs](https://developers.cloudflare.com/workers/wrangler/install-and-update/))
- **Cloudflare Account** (free tier works): [Sign up](https://dash.cloudflare.com/sign-up)
- **Authenticated Wrangler**: Run `wrangler login`
- **GitHub Token** (optional, for higher rate limits): [Create token](https://github.com/settings/tokens)

### Cloudflare Resources to Create

You'll need to provision these via Wrangler or the dashboard:

1. **Vectorize Index**: `wrangler vectorize create socratic-mentor-embeddings --dimensions=768 --metric=cosine`
2. **KV Namespace**: `wrangler kv:namespace create KV_PREFS`
3. **R2 Bucket**: `wrangler r2 bucket create socratic-mentor-cache`
4. **D1 Database** (optional): `wrangler d1 create socratic-mentor-db`

Update the IDs in `wrangler.toml` after creation.

---

## 🚀 Setup

### 1. Clone the Repository

```bash
git clone https://github.com/<your-username>/cf_ai_repo_socratic_mentor.git
cd cf_ai_repo_socratic_mentor
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Copy `.env.example` to `.dev.vars` and add secrets:

```bash
# .dev.vars
GITHUB_TOKEN=your_github_personal_access_token
```

Set production secrets:

```bash
wrangler secret put GITHUB_TOKEN
```

### 4. Create Cloudflare Resources

Run the setup script (or execute commands manually):

```bash
# Create Vectorize index
wrangler vectorize create socratic-mentor-embeddings --dimensions=768 --metric=cosine

# Create KV namespace
wrangler kv:namespace create KV_PREFS
wrangler kv:namespace create KV_PREFS --preview

# Create R2 bucket
wrangler r2 bucket create socratic-mentor-cache
```

Update `wrangler.toml` with the generated IDs.

### 5. Run Migrations (if using D1)

```bash
wrangler d1 execute socratic-mentor-db --local --file=./migrations/001_initial.sql
```

---

## 💻 Development

### Start Local Development Server

```bash
npm run dev
# or
wrangler dev
```

This starts the Workers dev server with hot reloading. Access at `http://localhost:8787`.

### Develop Frontend Locally

```bash
cd pages-frontend
npm install
npm run dev
```

Vite dev server runs at `http://localhost:5173` (auto-proxies API calls to Workers).

### Test Voice Features

Voice features require HTTPS. Use Wrangler's remote dev mode:

```bash
wrangler dev --remote
```

---

## 🌐 Deployment

### Deploy Workers

```bash
npm run deploy
# or
wrangler deploy
```

### Deploy Frontend (Pages)

```bash
npm run deploy:frontend
# or
wrangler pages deploy pages-frontend/dist
```

Or connect your GitHub repo to Cloudflare Pages for automatic deployments on push.

### Verify Deployment

```bash
curl https://your-worker.your-subdomain.workers.dev/health
```

---

## 🎯 Usage

### Basic Workflow

1. **Open the app**: Navigate to your deployed Pages URL
2. **Paste repo URL**: Enter a GitHub repository (e.g., `https://github.com/cloudflare/workers-sdk`)
3. **Speak your goal**: Click the mic and say something like:
   > "I need to understand how the Wrangler CLI authenticates with Cloudflare"
4. **Engage with questions**: The agent will ask Socratic questions to guide your exploration
5. **Receive study plan**: Get a personalized 10-15 minute learning path with flashcards

### API Endpoints

- `POST /api/analyze`: Analyze a GitHub repo
- `POST /api/chat`: Send chat message (text or voice)
- `GET /api/session/:id`: Retrieve session state
- `POST /api/flashcards`: Generate flashcards
- `GET /api/health`: Health check

### Example cURL Commands

```bash
# Analyze a repo
curl -X POST https://your-worker.workers.dev/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"repoUrl": "https://github.com/cloudflare/workers-sdk", "goal": "Understand auth flow"}'

# Chat (text)
curl -X POST https://your-worker.workers.dev/api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "abc123", "message": "What is the role of the API client?"}'
```

---

## 📂 Project Structure

```
cf_ai_repo_socratic_mentor/
├─ workers/                    # Backend Workers code
│   ├─ agent.ts               # Cloudflare Agent orchestration + LLM calls
│   ├─ durable-object.ts      # Session state + WebSocket handler
│   ├─ github.ts              # GitHub API tools (fetch repo, parse files)
│   ├─ vectorize.ts           # Embedding generation + semantic search
│   ├─ router.ts              # Hono HTTP router (main entry point)
│   └─ types.ts               # TypeScript interfaces
├─ pages-frontend/            # Frontend application
│   ├─ index.html             # Main HTML entry
│   └─ src/
│       ├─ App.tsx            # React root component
│       ├─ voice.ts           # Realtime API integration
│       ├─ api.ts             # API client for Workers
│       └─ styles.css         # Global styles
├─ prompts/                   # System prompts for LLM
│   ├─ system.socratic.txt    # Main Socratic teaching prompt
│   ├─ tool.repo_map.txt      # Prompt for repo structure extraction
│   ├─ tool.concept_primer.txt # Prompt for prerequisite concepts
│   ├─ tool.socratic_quiz.txt # Prompt for generating quiz questions
│   └─ tool.study_flashcards.txt # Prompt for flashcard generation
├─ seed/                      # Example data
│   └─ README_demo.md         # Demo repository example
├─ migrations/                # D1 database migrations (if used)
├─ tests/                     # Vitest unit tests
├─ README.md                  # This file (continually updated)
├─ PROMPTS.md                 # AI prompt log for transparency
├─ wrangler.toml              # Cloudflare configuration
├─ package.json               # Node.js dependencies
├─ tsconfig.json              # TypeScript configuration
├─ .gitignore                 # Git ignore rules
└─ LICENSE                    # MIT License
```

---

## 🛠️ Troubleshooting

### Common Issues

#### Issue: "No Vectorize index found"

**Solution**: Ensure you've created the Vectorize index and updated `wrangler.toml`:

```bash
wrangler vectorize create socratic-mentor-embeddings --dimensions=768 --metric=cosine
```

#### Issue: "KV namespace not found"

**Solution**: Create the KV namespace and add the ID to `wrangler.toml`:

```bash
wrangler kv:namespace create KV_PREFS
```

#### Issue: Voice not working locally

**Solution**: Voice features require HTTPS. Use remote dev mode:

```bash
wrangler dev --remote
```

#### Issue: Rate limit errors from GitHub API

**Solution**: Add a GitHub personal access token to `.dev.vars` or production secrets:

```bash
wrangler secret put GITHUB_TOKEN
```

#### Issue: Durable Object not migrated

**Solution**: Ensure migrations are defined in `wrangler.toml` and redeploy:

```toml
[[migrations]]
tag = "v1"
new_classes = ["SessionDurableObject"]
```

### Debug Mode

Enable verbose logging:

```bash
wrangler dev --log-level debug
```

### Tail Production Logs

```bash
wrangler tail
```

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please ensure your code:
- Follows the existing style conventions
- Includes tests for new features
- Updates documentation as needed

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

## 🙏 Acknowledgments

- **Cloudflare** for the incredible edge computing platform
- **Meta** for Llama 3.3
- **GitHub** for the API that makes this possible

---

## 📚 Additional Resources

- [Cloudflare Agents Documentation](https://developers.cloudflare.com/agents/)
- [Workers AI Models](https://developers.cloudflare.com/workers-ai/models/)
- [Vectorize Guide](https://developers.cloudflare.com/vectorize/)
- [Durable Objects Guide](https://developers.cloudflare.com/durable-objects/)
- [Realtime API](https://developers.cloudflare.com/workers/runtime-apis/realtime/)

---

**Built with ❤️ on the Cloudflare Edge**

# 🧭 Code Compass

> **AI-powered codebase exploration through Socratic dialogue**

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Live Demo](https://img.shields.io/badge/demo-live-success)](https://code-compass.pages.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**[🚀 Live Demo](https://code-compass.pages.dev)**

An intelligent mentor that helps developers master unfamiliar codebases through conversation, not documentation. Paste a GitHub repository URL, describe your learning goal, and Code Compass guides you through the codebase using Socratic questions, semantic code search, and personalized study plans.

Traditional documentation is passive - you read and hope you understand. Code Compass is active:

1. **Forces Deep Thinking**: You can't passively consume answers
2. **Reveals Knowledge Gaps**: The AI identifies exactly what you don't understand
3. **Personalized Paths**: Study plans adapt to your specific struggles
4. **Spaced Repetition**: Flashcards reinforce concepts over time
5. **Transfer Learning**: Questions build metacognitive skills that apply to any codebase

---

## Project highlights

Built on Cloudflare's AI Agents platform, this project demonstrates:

- **Full-stack AI orchestration** with Workers AI (Llama 3.3), Vectorize, Durable Objects, and KV
- **Real-time voice streaming** using WebSocket connections and Whisper transcription
- **Intelligent code understanding** through semantic search over repository embeddings
- **Socratic teaching methodology** that guides learning rather than providing direct answers
- **Production-ready deployment** with CI/CD, TypeScript, and comprehensive error handling

---

## 🏗️ Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **LLM** | Workers AI (Llama 3.3) | Socratic dialogue, code explanations, study plan generation |
| **Embeddings** | Workers AI (BGE-base) | Semantic code search and concept matching |
| **Voice** | Workers AI (Whisper) | Real-time audio transcription via WebSocket |
| **Workflow** | Cloudflare Agents | Multi-step reasoning with 7 tool definitions |
| **Memory** | Vectorize (768-dim) | Repository code embeddings, user struggle tracking |
| **State** | Durable Objects | Session persistence, WebSocket connections |
| **Storage** | Workers KV | User preferences and settings |
| **Frontend** | React + Vite | Single-page application with voice recording |
| **Backend** | Hono Router | HTTP API + WebSocket upgrade handling |
| **CI/CD** | GitHub Actions | Automated testing, type checking, deployment |

---

## Core Capabilities

- **🎤 Voice-First UX**: Speak your questions and receive text responses in real-time
- **🔍 Semantic Code Search**: Vector similarity search finds relevant code across repositories
- **🧠 Socratic Teaching**: AI asks targeted questions to guide discovery, never gives direct answers
- **📚 Personalized Learning**: Generates 10-15 minute study plans with flashcards based on struggles
- **🌐 Real-time Collaboration**: WebSocket connections maintain conversation state
- **📊 Repository Analysis**: Automatic extraction of structure, hotspots, and prerequisites

## 🎯 Checks

✅ **LLM Integration**: Llama 3.3 with configurable models for different tasks  
✅ **Workflow Coordination**: Cloudflare Agents orchestrate 7 specialized tools  
✅ **Voice Input**: WebSocket-based RTC voice streaming with Whisper transcription  
✅ **Memory & State**: Vectorize for semantic memory + Durable Objects for sessions  

---

## 🚀 Quick Start
Prefer to try it right away? Launch the live demo - no setup required: 🧞 [Live Demo - code-compass.pages.dev](https://code-compass.pages.dev)
### Prerequisites

- Node.js 18+ and npm
- Cloudflare account ([sign up free](https://dash.cloudflare.com/sign-up))
- Wrangler CLI: `npm install -g wrangler`
- Authenticated: `wrangler login`

### Local Development

```bash
# 1. Clone and install dependencies
git clone https://github.com/suraj-ranganath/cf_ai_code_compass.git
cd cf_ai_code_compass
npm install

# 2. Create Cloudflare resources
npx wrangler vectorize create code-compass-embeddings --dimensions=768 --metric=cosine
npx wrangler kv:namespace create KV_PREFS
npx wrangler kv:namespace create KV_PREFS --preview

# 3. Update wrangler.toml with generated IDs
# (Copy the namespace IDs from the command output)

# 4. Set GitHub token (optional, for higher rate limits)
npx wrangler secret put GITHUB_TOKEN
# Paste your GitHub personal access token

# 5. Start local development
npm run dev
# Backend: http://localhost:8787

# In a new terminal:
cd pages-frontend
npm install
npm run dev
# Frontend: http://localhost:5173
```

### Deploy to Production

```bash
# Deploy Workers backend
npx wrangler deploy

# Build and deploy Pages frontend
cd pages-frontend && npm run build && cd ..
npx wrangler pages deploy pages-frontend/dist --project-name=code-compass --branch=main
```

**Production URLs:**
- Frontend: https://code-compass.pages.dev
- Backend: https://cf-ai-code-compass.suranganath.workers.dev

---

## 💡 Usage

1. **Open the app**: Visit https://code-compass.pages.dev
2. **Paste a GitHub URL**: Try `https://github.com/cloudflare/workers-sdk`
3. **Set your goal**: "Understand how Wrangler authenticates with Cloudflare"
4. **Enable voice** (optional): Check "Enable voice interaction" for audio input
5. **Start learning**: The AI analyzes the repo and asks opening questions
6. **Engage with questions**: Answer via voice or text - the AI tracks what you struggle with
7. **Get study materials**: Request flashcards or a personalized study plan

### Example Interaction

```
You: [Analyze github.com/expressjs/express] "Learn middleware patterns"

AI: "Looking at the Express repository, I found middleware/ and application.js. 
Before we dive in, what do you think app.use() does when you call it multiple times?"

You: "I'm not sure... does it chain functions somehow?"

AI: "Great instinct! Look at lib/application.js lines 180-220. What pattern do you 
notice in how the functions are stored?"

[After conversation...]

AI: "I noticed you struggled with 'function composition' and 'closure patterns'. 
Would you like me to generate flashcards to reinforce these concepts?"
```

---

## 📐 Architecture
```mermaid
flowchart TB
    subgraph Edge[Cloudflare Edge]
        User[User (Browser)]
        Pages[Pages\n(Frontend)]
        Router[Workers\n(Hono Router)]
        Agent[agent.ts]
        GithubTS[github.ts]
        VectorizeTS[vectorize]
        WorkersAI[Workers AI\n(LLM)]
        GitHubAPI[GitHub API]
        VectorizeAPI[Vectorize\n(768-dim)]
        Durable[Durable Objects\n(Sessions)]
        KV[KV Store\n(Prefs)]
    end

    User -- WebRTC / HTTP / WS --> Pages
    Pages --> Router

    Router --> Agent
    Router --> GithubTS
    Router --> VectorizeTS

    Agent --> WorkersAI
    GithubTS --> GitHubAPI
    VectorizeTS --> VectorizeAPI

    Router --> Durable
    Router --> KV
```

### Data Flow

1. **Repository Analysis** (POST `/api/analyze`)
   - Frontend sends repo URL + learning goal
   - Worker fetches repository structure via GitHub API
   - Extracts entry points, hotspots, dependencies
   - **Background**: Embeds all source files into Vectorize
   - Returns session ID + personalized welcome question

2. **Voice Interaction** (WebSocket `/api/realtime/:sessionId`)
   - User clicks voice button → records audio
   - Audio sent as base64 over WebSocket
   - Durable Object transcribes with Whisper
   - Transcription processed through agent workflow
   - Response streamed back in real-time

3. **Socratic Dialogue** (POST `/api/chat`)
   - User asks question (text or transcribed voice)
   - Agent invokes `search_code` tool → Vectorize semantic search
   - Retrieves relevant code snippets
   - Llama 3.3 generates Socratic question referencing actual code
   - Tracks concepts user struggles with

4. **Study Materials** (POST `/api/plan`, `/api/flashcards`)
   - Agent analyzes user's struggle history
   - Generates 10-15 minute study plan with specific files to review
   - Creates 5 flashcards with code examples from the repository

---

## 📂 Project Structure

```
cf_ai_code_compass/
├── workers/                    # Backend Workers code
│   ├── agent.ts               # Cloudflare Agents + tool definitions
│   ├── durable-object.ts      # Session state + WebSocket handler
│   ├── github.ts              # Repository analysis tools
│   ├── vectorize.ts           # Embeddings + semantic search
│   ├── router.ts              # HTTP router (main entry point)
│   └── types.ts               # TypeScript interfaces
├── pages-frontend/            # React frontend
│   ├── src/
│   │   ├── App.tsx           # Main UI component
│   │   ├── api.ts            # Backend API client
│   │   ├── voice.ts          # Audio recording + WebSocket
│   │   ├── components/       # UI components
│   │   └── styles/           # CSS styling
│   ├── index.html            # Entry point
│   └── vite.config.ts        # Vite configuration
├── prompts/                   # LLM system prompts
│   ├── system.socratic.txt   # Socratic teaching methodology
│   ├── tool.repo_map.txt     # Repository analysis prompt
│   ├── tool.concept_primer.txt # Prerequisite concepts prompt
│   ├── tool.socratic_quiz.txt  # Question generation prompt
│   └── tool.study_flashcards.txt # Flashcard creation prompt
├── .github/workflows/         # CI/CD pipeline
│   └── deploy.yml            # GitHub Actions workflow
├── README.md                  # This file
├── PROMPTS.md                 # AI interaction log (3000+ lines)
├── wrangler.toml              # Cloudflare configuration
├── package.json               # Dependencies and scripts
└── tsconfig.json              # TypeScript configuration
```

---

## 🔧 API Reference

### Core Endpoints

#### `POST /api/analyze`
Analyze a GitHub repository and create a learning session.

**Request:**
```json
{
  "repoUrl": "https://github.com/cloudflare/workers-sdk",
  "goal": "Understand Wrangler's authentication flow",
  "depth": 2
}
```

**Response:**
```json
{
  "sessionId": "uuid-v4",
  "analysis": {
    "repoName": "cloudflare/workers-sdk",
    "structure": [...],
    "hotspots": ["src/auth.ts", "src/config.ts"],
    "prerequisites": ["OAuth 2.0", "JWT tokens"]
  },
  "welcomeMessage": "You want to understand Wrangler's authentication flow - before we look at the code, what do you think happens when you run `wrangler login`?"
}
```

#### `GET /api/realtime/:sessionId` (WebSocket)
Real-time voice streaming and transcription.

**Connect:**
```javascript
const ws = new WebSocket('wss://your-worker.workers.dev/api/realtime/session-id');

// Send audio
ws.send(JSON.stringify({ type: 'voice', audio: base64AudioData }));

// Receive messages
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // Types: 'connected' | 'status' | 'transcription' | 'text_response' | 'error'
};
```

#### `POST /api/chat`
Send a text message to the Socratic mentor.

**Request:**
```json
{
  "sessionId": "uuid-v4",
  "message": "What does the middleware function do?"
}
```

**Response:**
```json
{
  "role": "assistant",
  "content": "Great question! I found middleware.ts in the repo. Before I explain, look at lines 45-60. What pattern do you notice about how the `next()` function is used?",
  "timestamp": 1698547200000
}
```

#### `POST /api/plan`
Generate a personalized study plan based on conversation history.

**Request:**
```json
{
  "sessionId": "uuid-v4"
}
```

**Response:**
```json
{
  "studyPlan": {
    "plan": [
      {
        "activity": "Read Express middleware documentation",
        "estimatedMinutes": 5,
        "resources": ["lib/middleware/init.js", "https://expressjs.com/guide/middleware"],
        "objective": "Understand middleware execution order"
      }
    ],
    "totalMinutes": 15,
    "focusAreas": ["Middleware composition", "Error handling"]
  }
}
```

#### `POST /api/flashcards`
Generate 5 flashcards for spaced repetition learning.

**Request:**
```json
{
  "sessionId": "uuid-v4"
}
```

**Response:**
```json
{
  "flashcards": [
    {
      "front": "In lib/application.js, what does app.use() return?",
      "back": "It returns `this` (the app instance) to enable method chaining: app.use(a).use(b).use(c)",
      "concept": "Method Chaining",
      "difficulty": 2,
      "sourceFile": "lib/application.js",
      "codeExample": "app.use(middleware1).use(middleware2);"
    }
  ]
}
```

#### `GET /api/search`
Semantic code search across ingested repositories.

**Query Parameters:**
- `q` (required): Search query
- `repo` (optional): Filter by repository name
- `topK` (optional): Number of results (default: 5)

**Example:**
```bash
curl "https://your-worker.workers.dev/api/search?q=authentication&repo=cloudflare/workers-sdk&topK=3"
```

---

## 🧪 Testing

### Manual Testing

```bash
# Health check
curl https://cf-ai-code-compass.suranganath.workers.dev/health

# Analyze repository
curl -X POST https://cf-ai-code-compass.suranganath.workers.dev/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/hono-dev/hono","goal":"Learn routing"}'

# Semantic search (after ingestion)
curl "https://cf-ai-code-compass.suranganath.workers.dev/api/search?q=middleware&topK=3"
```

### Automated Test Suite

```bash
chmod +x test-verification.sh
./test-verification.sh
```

Tests verify:
- Repository analysis with structure extraction
- Semantic code search functionality
- Study plan and flashcard generation
- Voice transcription (mocked)
- Session state persistence

---

## 🚢 Deployment

### Automated CI/CD

Every push to `main` triggers:
1. **Lint & Type Check**: Both Workers and frontend
2. **Deploy Workers**: To Cloudflare edge network
3. **Deploy Pages**: Build with Vite + deploy to CDN

**Setup GitHub Secrets:**

1. Go to repository Settings → Secrets and variables → Actions
2. Add `CLOUDFLARE_API_TOKEN`:
   - Create at https://dash.cloudflare.com/profile/api-tokens
   - Use "Edit Cloudflare Workers" template
   - Add permissions: Workers Scripts (Edit), Workers KV Storage (Edit), Pages (Edit)
3. Add `CLOUDFLARE_ACCOUNT_ID`:
   - Find in Cloudflare Dashboard (right sidebar)

### Manual Deployment

```bash
# Deploy backend
npx wrangler deploy

# Deploy frontend
cd pages-frontend && npm run build && cd ..
npx wrangler pages deploy pages-frontend/dist --project-name=code-compass --branch=main
```

### Environment Variables

Configure in `wrangler.toml`:

```toml
[vars]
LLM_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5"
MAX_REPO_FILES = "100"
QUIZ_QUESTIONS_COUNT = "6"
STUDY_PLAN_DURATION_MINUTES = "15"
```

**Secrets** (set with `wrangler secret put`):
- `GITHUB_TOKEN`: Personal access token for higher API rate limits (create at https://github.com/settings/tokens with `public_repo` scope)

---

## 🎓 How It Works: The Socratic Method

Code Compass uses a teaching methodology inspired by Socratic dialogue:

### 1. **Never Give Direct Answers**
Instead of explaining what middleware does, the AI asks:
> "Looking at `app.use()` in application.js, what do you think happens when you call it three times in a row?"

### 2. **Guide Through Questions**
Questions are carefully scaffolded from observation → analysis → prediction:
- **Observational**: "What do you notice about the function signature?"
- **Analytical**: "Why do you think it returns `this`?"
- **Predictive**: "What would happen if you removed the `next()` call?"

### 3. **Track Struggles & Adapt**
When users say "I don't know" or "I'm confused", the AI:
- Records the concept they're struggling with
- Provides contextual hints (3 levels)
- Adjusts question difficulty
- Generates targeted flashcards later

### 4. **Ground in Actual Code**
Every question references specific files and line numbers:
> "In `lib/router/index.js` lines 45-60, you'll find how routes are matched..."

This ensures learning is concrete, not abstract.

---

## 🛠️ Troubleshooting

### "No Vectorize index found"
```bash
npx wrangler vectorize create code-compass-embeddings --dimensions=768 --metric=cosine
# Update index_name in wrangler.toml
```

### "KV namespace not found"
```bash
npx wrangler kv:namespace create KV_PREFS
# Add the generated ID to wrangler.toml
```

### "Voice not working locally"
Voice requires HTTPS. Use remote dev mode:
```bash
npx wrangler dev --remote
```

### "GitHub rate limit exceeded"
Set a personal access token:
```bash
npx wrangler secret put GITHUB_TOKEN
# Create token at https://github.com/settings/tokens
# Required scopes: public_repo
```

### "WebSocket disconnected during tool calls"
This is normal for long-running operations. The frontend will automatically reconnect. Check logs:
```bash
npx wrangler tail --format pretty
```

---

## 🚀 Future Enhancements

- [ ] **Realtime Text-to-Speech**: Speak responses aloud using Workers AI TTS models in Real-time
- [ ] **Code Diff Explanations**: Analyze pull requests and explain changes
- [ ] **Multi-repo Learning**: Compare patterns across multiple codebases
- [ ] **Collaborative Sessions**: Multiple users learning together in real-time
- [ ] **Visual Code Maps**: Interactive diagrams showing module relationships
- [ ] **IDE Integration**: VS Code extension for inline Socratic guidance
- [ ] **Progress Tracking**: Dashboard showing concepts mastered over time
- [ ] **Custom Prompts**: Let users define their own teaching styles

---

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details.

---

## 🙏 Acknowledgments

Built with:
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) - Llama 3.3, Whisper, BGE embeddings
- [Cloudflare Agents](https://developers.cloudflare.com/agents/) - Tool orchestration
- [Vectorize](https://developers.cloudflare.com/vectorize/) - Vector database
- [Durable Objects](https://developers.cloudflare.com/durable-objects/) - Stateful edge compute
- [Hono](https://hono.dev/) - Lightweight HTTP framework
- [React](https://react.dev/) + [Vite](https://vitejs.dev/) - Frontend

Inspired by Socrates, the ancient Greek philosopher who taught through questions, not answers.

**Prompt Log**: All AI-assisted development prompts documented in [PROMPTS.md](./PROMPTS.md) (3000+ lines).

---

**Built with ❤️ on the Cloudflare AI Agents Platform**

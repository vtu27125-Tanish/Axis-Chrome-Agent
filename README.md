# 🧭 Axis — Voice-Driven AI Browser Co-Pilot

**Axis is a Chrome extension that lets you control your browser with your voice.** It doesn't just chat about what's on your screen — it sees the page (DOM + live screenshots) and takes real action: clicking, typing, navigating, and filling out forms, in real time, as you speak.

> Built as a full-stack AI agent system: a Manifest V3 Chrome extension talking over WebSockets to a FastAPI backend, orchestrating a Google ADK agent powered by Gemini.

---

## ✨ Features

- 🎙️ **Real-time voice control** — speak naturally, Axis interprets intent and acts
- 🖱️ **Autonomous browser actions** — clicks, form fills, navigation, scrolling, driven by live DOM + screenshot analysis
- 💬 **Text chat mode** — same agent, typed input, for when voice isn't convenient
- 🖼️ **AI image generation** — generate and insert images directly into the page
- 🧠 **Multi-tool agent planning** — the backend agent reasons over available tools (DOM actions, browser control, WebMCP, screenshots) to plan multi-step tasks
- 💾 **Session persistence** — conversation history and session data stored per user

## 🏗️ Architecture

```
extension/   → Chrome Extension (Manifest V3)
             sidepanel UI · content scripts · background service worker
             client-side agent engine (intent parsing, planning, execution)

backend/     → FastAPI server
             WebSocket endpoints for live voice (/ws) and chat (/ws-chat)
             session & user persistence (MySQL)

agent/       → Google ADK agent + tools
             screenshot capture, DOM actions, browser control,
             WebMCP, image generation, planning
```

**Data flow:** Extension captures voice/DOM/screenshot → streams over WebSocket to FastAPI backend → Google ADK agent (Gemini) reasons about intent and picks tools → actions are streamed back and executed live in the browser.

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| AI / Agent | Google ADK, Gemini Live API (voice), Gemini 3.1 Flash (chat/planning), Gemini 3.1 Flash Image |
| Backend | FastAPI, WebSockets, `aiomysql` |
| Extension | Vanilla JS, Chrome Manifest V3, Web Audio API |
| Database | MySQL |
| Deployment | Docker, Render (cloud-hosted, free tier) |

## 🚀 Getting Started

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r ../requirements.txt
```

Create a `.env` file in the project root:

```env
GOOGLE_GENAI_USE_VERTEXAI=false
GOOGLE_API_KEY=your-gemini-api-key
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=axis
```

Run it:

```bash
uvicorn backend.main:app --reload --port 8080
```

### Extension

1. Open `chrome://extensions`
2. Enable **Developer Mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Pin the Axis icon and open the side panel to start talking

## ☁️ Deployment

Axis ships as a Docker container and runs on any container-friendly host — currently deployed on **Render**. The extension simply points its `PROD_DOMAIN` config at the live backend URL over WebSocket Secure (`wss://`).

## 📌 Notes

- No automated test suite yet — a natural next step for this project.
- Agent tool definitions live in `agent/tools/`, making it straightforward to extend Axis with new browser capabilities.

---

<sub>Built with FastAPI, Google ADK, and Gemini.</sub>

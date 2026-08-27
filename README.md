# JavaAI — Intent Trace

A browser-based AI engineering workspace for making AI-generated code changes **inspectable, testable, and reversible**.

JavaAI turns a natural-language coding request into a reviewable semantic intent, visualizes its dependencies and impact, applies the change, runs the real test suite, and provides dependency-aware rollback.

**Natural-language request → Semantic Intent Graph → Review → Apply → Test → Roll back**

The project is built as a full-stack system: a React/Vite frontend communicates with a Bun backend, which manages projects, intents, executions, events, AI-assisted intent generation, and rollback.

## Live Demo

**Frontend:** https://javaaiintent.vercel.app

**Backend:** https://javaai-intent-trace-production.up.railway.app

The frontend is deployed on Vercel and the backend runs independently on Railway. The production frontend communicates with the deployed backend through `VITE_API_BASE_URL`.


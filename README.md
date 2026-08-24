# Intent Trace

## Project Description

Intent Trace is a backend for dependency-aware version control of AI-generated code. Instead of treating AI edits as isolated Git commits, it groups related changes into high-level **intents** and connects them through a dependency DAG. The backend calculates rollback blast radius, blocks unsafe reverts, supports ordered cascade rollback, and records an audit trail. It is designed as the foundation for a React-based developer interface for understanding and controlling AI-generated changes.

## Stack

Built with **TypeScript + Bun + Effect-TS**, using Effect for service composition, dependency injection, typed errors, PubSub, and streams. **Drizzle ORM + PGlite/PostgreSQL** provide typed persistence with an embedded PostgreSQL database for local development. **SSE + Effect PubSub** provide realtime event streaming. The architecture leaves integration seams for hosted PostgreSQL, ClickHouse, Electric SQL, and agent sandboxes such as e2b.

## API

The REST API supports intent creation, application, dependency management, rollback, Git commit association, graph visualization, audit events, and realtime updates. Key endpoints include `POST /intents`, `GET /intents/graph`, `GET /intents/:id/dependencies`, `POST /intents/:id/apply`, and `POST /intents/:id/revert`. Rollbacks support `dry_run` impact previews and dependency-safe `cascade` execution. `GET /intents/:id/stream` exposes realtime SSE events.

## Architecture

The system separates the **domain DAG**, **intent services**, **database**, **events**, and **HTTP** layers. The domain layer handles cycle detection, topological ordering, and transitive dependency analysis, while the Intent service manages the lifecycle and rollback logic. Drizzle/PGlite handles persistence and Effect PubSub/SSE handles realtime events. This separation keeps the core dependency logic testable and makes infrastructure replaceable as the system moves toward production.

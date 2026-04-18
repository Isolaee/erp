# ERP — Engineering Team Coordination Tool

## Overview
A full-stack web application for engineering team coordination. Tracks what each programmer is working on across hierarchical task lists (org/team/personal), with Claude AI to help refine and distribute tasks.

## Problem It Solves
- Engineering teams lack a single place to see who is working on what across org, team, and personal scopes
- Writing clear task descriptions and splitting work across people is tedious
- Target users: engineering team leads, developers, and admins managing small-to-mid-size engineering orgs

## Use Cases
1. A team lead uses the AI refine endpoint to describe a vague task — Claude rewrites it into concrete subtasks and assigns them across team members via tool calls
2. A developer logs in and sees their personal task queue alongside their team's list and org-wide priorities on a single dashboard
3. An admin invites a new engineer via a link, sets their role, and assigns them to a team without touching a database
4. A team follows a GitHub repo; live issues, PRs, and commits appear alongside tasks for that project

## Key Features
- **AI task refinement** — Claude reads context, calls tools (`create_task`, `update_task`, `assign_task`, `move_task`, `delete_task`), and streams a summary back over SSE
- **Hierarchical task lists** — ORGANIZATION / TEAM / PERSONAL scope with fine-grained visibility controls
- **Real-time updates** — Server-Sent Events push state changes to all connected clients instantly
- **GitHub integration** — per-team repo follows with issues, PRs, and commit feeds (Redis-cached, 5 min TTL)
- **Role-based access control** — ADMIN > TEAM_LEAD > MEMBER, with independent team-level roles
- **Invite-only registration** — admins generate invite links; no open sign-up

## Tech Stack
| Layer | Technology |
|---|---|
| Backend | Node.js + Express + TypeScript |
| ORM | Prisma + PostgreSQL 16 |
| Frontend | React + TypeScript + Vite + TailwindCSS |
| LLM | Anthropic Claude API (`@anthropic-ai/sdk`) |
| Realtime | Server-Sent Events (SSE) |
| Cache / Sessions | Redis 7 |
| Auth | JWT — 15 min access token + 7 day httpOnly refresh token |
| Infrastructure | Docker Compose |

## Getting Started

### Prerequisites
- Docker Desktop

### Start everything
```bash
cp backend/.env.example backend/.env
# Fill in ANTHROPIC_API_KEY, JWT_SECRET, JWT_REFRESH_SECRET in backend/.env

docker compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3001 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

### Seed the database
```bash
cd backend && npx prisma db seed
```
Creates an admin user and a demo team. Credentials are printed to the console.

### Useful commands
```bash
# Create a DB migration
cd backend && npx prisma migrate dev --name <name>

# Open Prisma Studio (DB GUI)
cd backend && npx prisma studio

# Backend only (requires running postgres + redis)
cd backend && npm run dev

# Frontend only
cd frontend && npm run dev
```

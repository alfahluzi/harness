# Workspace Architecture

## Overview

Workspace adalah konteks project tempat Coding Agent bekerja.

Workspace memiliki **persistent identity** yang tidak bergantung pada lokasi directory. Dengan demikian, project dapat dipindahkan ke directory lain tanpa kehilangan session dan history.

Workspace juga memiliki project-local directory `.nusa/` yang berfungsi sebagai **control plane** untuk Coding Agent. Directory ini menyimpan konfigurasi workspace, agent definitions, skills, serta planning artifacts.

Konsep utama:

```text
Workspace Identity
    └── workspace.id

Workspace Location
    ├── workspace.root
    └── workspace.cwd

Workspace Control Plane
    └── .nusa/
        ├── config.json
        ├── docs/
        ├── agents/
        └── skills/
```

---

# Directory Structure

Coding Agent di-install secara global:

```text
/usr/local/bin/nusa
```

Sedangkan konfigurasi dan artifacts bersifat project-local:

```text
my-project/
├── .git/
├── src/
├── package.json
│
└── .nusa/
    ├── config.json
    │
    ├── docs/
    │   └── plan/
    │       ├── <plan-name>.md
    │       └── <plan-name>.progress.md
    │
    ├── agents/
    │   ├── <agent-name>/
    │   │   ├── prompt.md
    │   │   └── config.json
    │   │
    │   └── ...
    │
    └── skills/
        ├── <skill-name>/
        │   ├── desc.md
        │   └── scripts/
        │       ├── <script-name>.js
        │       └── <script-name>.py
        │
        └── ...
```

Global installation dan project workspace merupakan dua hal yang berbeda.

```text
Global Installation
    │
    └── nusa executable

Project
    │
    └── .nusa/
        ├── config.json
        ├── docs/
        ├── agents/
        └── skills/
```

---

# `.nusa/`

`.nusa/` adalah **project-local control plane** Coding Agent.

Directory ini berisi segala sesuatu yang berkaitan dengan bagaimana Coding Agent bekerja pada project tertentu.

```text
.nusa/
├── config.json
├── docs/
├── agents/
└── skills/
```

`.nusa/` sebaiknya di-commit ke Git sehingga konfigurasi dan planning artifacts dapat dibagikan bersama source code.

Namun, credential, API key, token, atau secret tidak boleh disimpan di dalam directory ini.

---

# Workspace Configuration

## `config.json`

File:

```text
.nusa/config.json
```

menyimpan persistent configuration dan identity workspace.

Contoh:

```json
{
  "id": "ws_01K7ABC123XYZ",
  "version": 1
}
```

### Workspace ID

`id` adalah **persistent identity** workspace.

Identity tidak bergantung pada absolute filesystem path.

Contoh:

```text
Before:

/home/aldi/Documents/my-project
└── .nusa/config.json
    └── id = ws_01K7ABC123XYZ
```

Project kemudian dipindahkan:

```text
After:

/home/aldi/Projects/my-project
└── .nusa/config.json
    └── id = ws_01K7ABC123XYZ
```

Workspace tetap memiliki identity:

```text
ws_01K7ABC123XYZ
```

---

# WorkspaceContext

`WorkspaceContext` adalah object runtime yang merepresentasikan workspace aktif.

```ts
interface WorkspaceContext {
    id: string;
    root: string;
    cwd: string;
    configDir: string;
}
```

Contoh:

```ts
{
    id: "ws_01K7ABC123XYZ",

    root: "/home/aldi/Documents/my-project",

    cwd: "/home/aldi/Documents/my-project/src/components",

    configDir: "/home/aldi/Documents/my-project/.nusa"
}
```

## Properties

### `id`

Persistent workspace identity.

Digunakan untuk menghubungkan workspace dengan:

* sessions
* conversations
* tasks
* history
* execution state

### `root`

Root directory project.

Root ditemukan melalui workspace/project discovery.

### `cwd`

Directory tempat user menjalankan Coding Agent.

Contoh:

```bash
cd ~/Documents/my-project/src/components
nusa
```

Maka:

```text
cwd  = ~/Documents/my-project/src/components
root = ~/Documents/my-project
```

### `configDir`

Directory:

```text
<root>/.nusa
```

---

# Workspace Discovery

Coding Agent tidak boleh menganggap `process.cwd()` sebagai project root.

`process.cwd()` hanya menunjukkan lokasi command dijalankan.

Contoh:

```text
/home/aldi/Documents/my-project/
├── .git/
├── .nusa/
└── src/
    └── components/
        └── Button.tsx
```

User menjalankan:

```bash
cd src/components
nusa
```

Maka:

```text
process.cwd()
        │
        ▼
src/components
        │
        │ search upward
        ▼
src
        │
        ▼
my-project
        │
        ├── .git
        └── .nusa
```

Hasil:

```ts
{
    root: "/home/aldi/Documents/my-project",
    cwd: "/home/aldi/Documents/my-project/src/components"
}
```

Workspace discovery bertanggung jawab untuk menentukan:

```text
cwd
root
.nusa/
workspace.id
```

---

# Initialization

Command:

```bash
nusa init
```

digunakan untuk membuat workspace configuration.

Contoh:

```bash
cd ~/Documents/my-project
nusa init
```

akan menghasilkan:

```text
my-project/
└── .nusa/
    ├── config.json
    ├── docs/
    │   └── plan/
    ├── agents/
    └── skills/
```

`config.json` dibuat dengan unique workspace ID:

```json
{
  "id": "ws_01K7ABC123XYZ",
  "version": 1
}
```

---

# Planning Artifacts

Planning artifacts berada di:

```text
.nusa/docs/plan/
```

Struktur:

```text
docs/
└── plan/
    ├── authentication.md
    ├── authentication.progress.md
    ├── oauth.md
    └── oauth.progress.md
```

## Plan

File:

```text
<plan-name>.md
```

merupakan **source of truth untuk rencana pekerjaan**.

Contoh:

```text
authentication.md
```

berisi:

* objective
* requirements
* architecture
* implementation steps
* acceptance criteria

Plan sebaiknya tidak berubah secara bebas selama execution kecuali memang ada perubahan requirement atau replanning.

## Progress

File:

```text
<plan-name>.progress.md
```

menyimpan **execution progress** dari plan.

Contoh:

```text
authentication.progress.md
```

dapat berisi:

```text
[x] Create user table
[x] Implement password hashing
[x] Implement login endpoint
[ ] Implement refresh token
[ ] Add integration tests
```

Dengan pemisahan ini:

```text
<plan-name>.md
    │
    └── What should be built

<plan-name>.progress.md
    │
    └── What has been completed
```

Plan dan progress merupakan filesystem artifacts, bukan database state utama.

---

# Agent Definitions

Agent definitions berada di:

```text
.nusa/agents/
```

Setiap agent memiliki directory sendiri:

```text
agents/
├── coder/
│   ├── prompt.md
│   └── config.json
│
├── reviewer/
│   ├── prompt.md
│   └── config.json
│
└── planner/
    ├── prompt.md
    └── config.json
```

## `prompt.md`

Mendefinisikan behavior dan role agent.

Contoh:

```md
# Coder

You are an implementation agent.

Your responsibility is to implement the assigned task
while following the project's existing architecture and conventions.
```

## `config.json`

Mendefinisikan runtime configuration agent.

Contoh:

```json
{
  "model": "mimo-v2.5",
  "tools": [
    "read_file",
    "write_file",
    "search",
    "shell"
  ]
}
```

Sehingga:

```text
prompt.md
    │
    └── Agent behavior

config.json
    │
    └── Agent runtime configuration
```

---

# Skills

Skills adalah **reusable capabilities** yang dapat digunakan oleh agent.

Skills berbeda dengan agents.

```text
Agent
    = Who is performing the task

Skill
    = What capability is available
```

Struktur:

```text
skills/
├── database-migration/
│   ├── desc.md
│   └── scripts/
│       ├── create-migration.js
│       └── validate.py
│
├── testing/
│   ├── desc.md
│   └── scripts/
│       └── run-tests.js
│
└── git/
    ├── desc.md
    └── scripts/
        └── check-status.js
```

## `desc.md`

Menjelaskan capability dan cara penggunaannya.

Contoh:

```md
# Database Migration

Use this skill when creating or validating database migrations.

## When to use

Use when:
- Adding a new database table
- Modifying an existing schema
- Validating migration consistency

## Scripts

- `create-migration.js`
- `validate.py`
```

## `scripts/`

Berisi executable scripts yang dapat dipanggil oleh agent.

Script dapat menggunakan:

```text
JavaScript
Python
```

dan dapat diperluas ke language lain jika diperlukan.

---

# Agent vs Skill

Agent dan skill memiliki tanggung jawab berbeda.

```text
                    Agent
                      │
              ┌───────┴───────┐
              ▼               ▼
           Role/Prompt      Tools
                              │
                              ▼
                           Skills
                              │
                     ┌────────┴────────┐
                     ▼                 ▼
                  desc.md           scripts/
```

Contoh:

```text
coder
    │
    ├── prompt.md
    └── config.json
            │
            ├── file tools
            ├── shell tools
            └── skills
                 ├── testing
                 └── database-migration
```

Satu skill dapat digunakan oleh banyak agent.

---

# Database

Workspace tidak perlu disimpan sebagai entity database untuk penggunaan normal.

Filesystem adalah source of truth untuk workspace.

```text
Filesystem
    │
    └── .nusa/
         └── config.json
              └── workspace.id
```

Database digunakan untuk persistent application state.

Contoh:

```text
SQLite
├── sessions
├── messages
├── tasks
├── tool_calls
└── execution_history
```

---

# Session

Session menyimpan `workspace_id`, bukan absolute filesystem path.

Contoh schema:

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

Session:

```text
session_id
    │
    └── workspace_id
            │
            └── ws_01K7ABC123XYZ
```

Tidak menggunakan:

```text
/home/aldi/Documents/my-project
```

sebagai identity.

---

# Why Use Workspace ID?

Project dapat dipindahkan:

```text
/home/aldi/Documents/my-project
```

menjadi:

```text
/home/aldi/Projects/my-project
```

Tetapi:

```text
.nusa/config.json
```

tetap memiliki:

```text
id = ws_01K7ABC123XYZ
```

Ketika agent dijalankan kembali:

```text
New location
     │
     ▼
Workspace Discovery
     │
     ▼
Read config.json
     │
     ▼
workspace.id
     │
     ▼
SessionManager
     │
     ▼
Find existing sessions
```

Dengan demikian session tetap relevan meskipun filesystem location berubah.

---

# SessionManager

`SessionManager` tidak perlu mengetahui absolute filesystem path.

```ts
class SessionManager {
    constructor(
        private db: Database,
        private workspace: WorkspaceContext,
    ) {}

    async create() {
        return this.db.insert("sessions", {
            workspace_id: this.workspace.id,
        });
    }

    async list() {
        return this.db.query(
            `
            SELECT *
            FROM sessions
            WHERE workspace_id = ?
            ORDER BY updated_at DESC
            `,
            [this.workspace.id],
        );
    }
}
```

Dependency:

```text
WorkspaceContext
       │
       ▼
SessionManager
       │
       ▼
SQLite
```

---

# Path Resolution

Filesystem tools harus menggunakan `workspace.root` sebagai basis path.

Jangan menggunakan `process.cwd()` secara langsung di setiap tool.

Contoh:

```ts
class PathResolver {
    constructor(
        private root: string,
    ) {}

    resolve(relativePath: string) {
        return path.resolve(this.root, relativePath);
    }

    relative(absolutePath: string) {
        return path.relative(this.root, absolutePath);
    }
}
```

Contoh:

```ts
resolver.resolve("src/index.ts");
```

menghasilkan:

```text
/home/aldi/Documents/my-project/src/index.ts
```

Dengan demikian seluruh filesystem tools menggunakan workspace yang konsisten.

---

# Runtime Architecture

Secara keseluruhan:

```text
                    nusa
                         │
                         ▼
                       CLI
                         │
                         ▼
              Workspace Discovery
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
         process.cwd()       .nusa/
              │                config.json
              │                     │
              └──────────┬──────────┘
                         ▼
                WorkspaceContext
                         │
              ┌──────────┼──────────┐
              │          │          │
              ▼          ▼          ▼
             id         root       cwd
              │          │
              │          ▼
              │    PathResolver
              │          │
              │    ┌─────┴─────┐
              │    ▼           ▼
              │  File        Search
              │  Tool         Tool
              │
              ▼
        SessionManager
              │
              ▼
            SQLite
```

Workspace control plane:

```text
.nusa/
│
├── config.json
│       │
│       └── Workspace Identity
│
├── docs/
│   └── plan/
│       ├── <plan>.md
│       └── <plan>.progress.md
│
│       └── Planning Artifacts
│
├── agents/
│   └── <agent>/
│       ├── prompt.md
│       └── config.json
│
│       └── Agent Definitions
│
└── skills/
    └── <skill>/
        ├── desc.md
        └── scripts/
            ├── *.js
            └── *.py

        └── Reusable Capabilities
```

---

# Design Principles

## 1. Global executable, local workspace

```text
Global:
    nusa

Project:
    .nusa/
```

Installation location tidak menentukan workspace.

---

## 2. `cwd` bukan `root`

```text
cwd  = tempat command dijalankan
root = root project
```

Keduanya harus direpresentasikan secara terpisah.

---

## 3. Identity ≠ Location

```text
workspace.id   = persistent identity
workspace.root = current project location
workspace.cwd  = invocation location
```

Directory dapat berubah tanpa mengubah workspace identity.

---

## 4. Filesystem adalah source of truth untuk workspace

`.nusa/config.json` menyimpan workspace identity dan configuration.

Workspace tidak perlu diregistrasikan ke database untuk penggunaan normal.

---

## 5. Database menyimpan state, bukan workspace filesystem

Database menyimpan:

```text
Session
Message
Task
Tool Call
Execution History
```

dan menggunakan:

```text
workspace_id
```

untuk menghubungkan state tersebut dengan workspace.

---

## 6. `.nusa/` adalah project-local control plane

`.nusa/` menyimpan:

```text
Configuration
Planning
Agent Definitions
Skills
```

Directory ini sebaiknya version-controlled bersama project.

---

## 7. `process.cwd()` hanya digunakan pada boundary

Hindari:

```ts
const root = process.cwd();
```

di berbagai bagian codebase.

Gunakan:

```text
CLI
 ↓
WorkspaceResolver
 ↓
WorkspaceContext
 ↓
Application
```

Dengan demikian seluruh komponen memiliki satu sumber kebenaran untuk workspace aktif.

---

# Final Concept

```text
                         PROJECT
                            │
                            ▼
                     .nusa/
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
     config               docs                agents
        │                   │                   │
   workspace.id           plans             definitions
        │                   │                   │
        │              ┌────┴────┐        ┌────┴────┐
        │              ▼         ▼        ▼         ▼
        │            plan      progress  prompt    config
        │
        └─────────────────────────────────────┐
                                              │
                                              ▼
                                      WorkspaceContext
                                              │
                         ┌────────────────────┼───────────────────┐
                         │                    │                   │
                         ▼                    ▼                   ▼
                        root                 cwd                  id
                         │                    │                   │
                         ▼                    │                   ▼
                    PathResolver              │             SessionManager
                         │                    │                   │
                         ▼                    ▼                   ▼
                      Tools              Agent Runtime          SQLite
                         │                    │
                         └────────────────────┴──────────────────┐
                                                                  │
                                                                  ▼
                                                               Skills
```

The core principle is:

> **Workspace identity lives in `.nusa/config.json`; workspace location is discovered at runtime; project artifacts live in `.nusa/`; persistent runtime state such as sessions lives in SQLite and references the workspace through `workspace_id`.**

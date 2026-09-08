# How to Write Effective CLAUDE.md and AI Agent Documentation

A complete guide based on Anthropic's official documentation, expert community insights, and practical experience building a multi-file documentation system for real project.

This document serves two purposes:
1. **For humans**: understand the principles and create your own AI agent documentation
2. **For AI systems**: follow these rules to generate orchestrators and scenario-based docs for any codebase

---

## Table of Contents

1. [What is CLAUDE.md](#1-what-is-claudemd)
2. [The Instruction Budget Problem](#2-the-instruction-budget-problem)
3. [What to Include and What to Exclude](#3-what-to-include-and-what-to-exclude)
4. [The Orchestrator Pattern](#4-the-orchestrator-pattern)
5. [Global vs Project CLAUDE.md](#5-global-vs-project-claudemd)
6. [Writing Scenario-Based Docs](#6-writing-scenario-based-docs)
7. [Documenting Utilities and Shared Code](#7-documenting-utilities-and-shared-code)
8. [Rules for Writing Effective Instructions](#8-rules-for-writing-effective-instructions)
9. [Common Mistakes](#9-common-mistakes)
10. [Step-by-Step: Building Documentation for a New Project](#10-step-by-step-building-documentation-for-a-new-project)
11. [Maintenance](#11-maintenance)
12. [Reference: Final File Structure](#12-reference-final-file-structure)
13. [Sources](#13-sources)

---

## 1. What is CLAUDE.md

CLAUDE.md is a special markdown file that Claude Code reads **at the start of every conversation**. Its content is added to the context at the start of every session — the foundational instructions that shape all of Claude's behavior during a session.

LLMs are stateless: they retain nothing between sessions. CLAUDE.md is your primary mechanism for giving persistent context that the agent can't derive from code alone.

### File hierarchy

| Location | Scope | Shared? |
|---|---|---|
| `~/.claude/CLAUDE.md` | All projects globally | Personal |
| `./CLAUDE.md` | Current project | Yes, via git |
| `./CLAUDE.local.md` | Current project, personal | No (.gitignore) |
| `./subdir/CLAUDE.md` | Loaded when working in that directory | Yes |
| Parent directories | Loaded automatically (monorepo support) | Yes |

### @imports system

CLAUDE.md supports importing other files:
```markdown
See @README.md for project overview
```

**Important:** files imported via `@` are expanded and loaded into context **immediately at session start** — not "on demand". So `@` is only for what must always be in context. If a file is needed only in specific scenarios — mention its path as plain text without `@` ("For engine work read `docs/agent/engine.md`"), and the agent will open it itself when relevant.

This distinction is the foundation of the orchestrator pattern (see section 4).

---

## 2. The Instruction Budget Problem

This is the most critical concept to understand.

### The constraint

A common community heuristic (a rough guide, not a precisely measured fact): frontier LLMs reliably follow **~150–200 instructions**. Claude Code's own system prompt already consumes **~50 instructions**. That leaves **~100–150 instructions** for your CLAUDE.md and all imported files combined.

### The degradation model

As instruction count increases, instruction-following quality **decreases uniformly across ALL instructions** — not just the later ones. Adding 10 low-value instructions doesn't just waste space; it makes every other instruction slightly less likely to be followed.

### Practical implication

Every line in CLAUDE.md has a cost. The question for each line is:

> "Would removing this cause Claude to make mistakes?"

If the answer is no — delete it.

### Size guidelines

| Size | Verdict |
|---|---|
| < 60 lines | Ideal |
| 60–100 lines | Good |
| 100–200 lines | Acceptable if all lines are essential |
| 200–300 lines | Maximum — performance starts degrading |
| 300+ lines | Too long — Claude will ignore important rules |

These counts apply to the **main CLAUDE.md file together with all @imports** — files imported via `@` are expanded at session start and occupy the budget just the same. Scenario docs that CLAUDE.md references as plain text without `@` are opened by the agent only when needed — they don't permanently occupy the budget.

---

## 3. What to Include and What to Exclude

### Include

| Category | Why Claude needs it | Example |
|---|---|---|
| **Tech stack with versions** | Can't guess version-specific APIs | `FastAPI 0.100+ / Python 3.13 / SQLAlchemy 2.0 (async)` |
| **Commands Claude will run** | Needs exact syntax | `poetry run alembic revision --autogenerate -m "title"` |
| **Architecture decisions** | Can't infer design intent | `Extend BaseService, don't duplicate CRUD logic` |
| **Critical utility imports** | Prevents reinventing optimized code | `from app.core.data.json import json_parse` (never stdlib json) |
| **Non-obvious gotchas** | Will break things without knowing | `MUST import new models in app/db/base.py` |
| **Service access patterns** | Can't guess project conventions | `run.init_service(ServiceClass)` for lazy cached services |
| **Plain-text references to scenario docs** (without `@`) | The agent opens the file itself when relevant | `For engine work read docs/agent/engine.md` |

### Exclude

| Category | Why it's wasteful | Alternative |
|---|---|---|
| **Abstract principles** ("DRY", "SOLID", "write clean code") | Claude already knows these from training data | Convert to specific, actionable rules |
| **Commands you run manually** (dev server, DB reset) | Claude won't run them | Keep in README.md, reference as plain text (`see README.md`) |
| **Standard language conventions** | Claude already knows Python/JS/etc. conventions | Only mention deviations from defaults |
| **Detailed API documentation** | Too long, changes often | Link to docs instead |
| **File-by-file codebase descriptions** | Claude can read the files itself | Only mention non-obvious relationships |
| **Code style rules** (indentation, quotes, semicolons) | Linter's job, not LLM's job | Use ruff/eslint/prettier |
| **Long explanations or tutorials** | Wastes instruction budget | Move to scenario docs or skills |
| **Information that changes frequently** | Will be outdated and mislead | Derive from code dynamically |

### The DRY Principle Paradox

Abstract instructions like "follow DRY" are paradoxically **anti-DRY in the instruction budget** — they consume tokens without producing reliable behavior change. Claude was trained on these principles and generally follows them.

However, if a principle is critically important to you, **convert it from abstract to concrete**:

| Abstract (weak) | Concrete (strong) |
|---|---|
| "Follow DRY principles" | "Before writing new code, search the codebase for existing utilities. Reuse them." |
| "Ensure security" | "Never store raw passwords — use pwdlib with Argon2" |
| "Write performant code" | "Use `fast_deep_get()` for known paths, not `deep_get()`" |
| "Handle errors properly" | "Raise `FlowException` inside engine, `RouterException` in API layer" |

The concrete version tells Claude **what to do**, not just what philosophy to aspire to.

### Behavioral Guidelines

Beyond technical instructions ("what to use"), your CLAUDE.md benefits from explicit **behavioral rules** ("how to think and change code"). These address the most common LLM coding mistakes: overengineering, scope creep, silent assumptions, and unnecessary refactoring.

LLMs are trained to be helpful and thorough, which paradoxically leads to:
- "Improving" adjacent code that wasn't part of the request
- Adding speculative features "just in case"
- Silently picking one interpretation when multiple exist
- Writing 200 lines when 50 would suffice

Technical instructions (imports, file paths, patterns) don't fix these — you need explicit behavioral constraints.

#### Core behavioral rules for project CLAUDE.md

These fit in 4–7 lines and belong in a dedicated section:

```markdown
# Behavior & Workflow
- Surgical changes: Touch ONLY what you must. NEVER refactor adjacent code or format unrelated lines.
- Clean up: ALWAYS remove imports/variables/functions that YOUR changes made unused.
- Simplicity: Minimum code required. NO speculative features or unrequested "flexibility".
- Match style: Follow existing conventions and patterns. Don't "improve" what works.
- Execution: For multi-step tasks, state a brief plan first. If requirements are ambiguous, STOP and ask.
- Traceability: Every changed line must trace directly to the user's request.
- Dead code: If you notice unrelated dead code, mention it — don't delete it silently.
```

#### Thinking rules for global CLAUDE.md

Universal pre-implementation thinking rules belong in `~/.claude/CLAUDE.md` since they apply to all projects:

```markdown
# Thinking (before coding)
- State assumptions explicitly. If uncertain — ask before implementing.
- If multiple interpretations exist, present them. Don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear — stop, name what's confusing, ask.
```

These rules shape HOW the LLM approaches every task, regardless of project.

#### Abstract vs concrete behavioral rules

Apply the same concreteness principle as for technical rules:

| Abstract (weak) | Concrete (strong) |
|---|---|
| "Be careful with changes" | "Touch ONLY what you must. NEVER refactor adjacent code." |
| "Keep it simple" | "NO speculative features or unrequested flexibility." |
| "Plan before coding" | "For multi-step tasks, state a brief plan first." |
| "Ask when confused" | "If requirements are ambiguous, STOP and ask." |

#### Verification

These behavioral guidelines are working if:
- Diffs contain fewer unnecessary changes
- Fewer rewrites due to overcomplication
- Clarifying questions come before implementation, not after mistakes

---

## 4. The Orchestrator Pattern

The central architectural decision: **CLAUDE.md is a slim orchestrator, not an encyclopedia**.

### Problem

A single long CLAUDE.md file has several issues:
- Exceeds instruction budget → all rules degrade
- Loads ALL context in EVERY session → wastes tokens on irrelevant info
- Hard to maintain → contradictions accumulate
- Mixes concerns → API docs next to engine docs next to git conventions

### Solution

```
CLAUDE.md (orchestrator, ~40 lines)
  ├── README.md (commands, setup — plain-text reference)
  ├── docs/agent/api.md (agent opens when working on API)
  ├── docs/agent/engine.md (agent opens when working on engine)
  └── docs/agent/platform.md (agent opens when working on integrations)
```

CLAUDE.md contains:
1. **Stack overview** (1 line)
2. **Architecture map** (5–7 lines with plain-text references to details)
3. **Key utilities** (must-use imports to prevent reinvention)
4. **Service patterns** (how to access and extend)
5. **Model conventions** (critical rules only)
6. **Gotchas** (things that will break without explicit instruction)
7. **Git conventions** (commit format)

Everything else lives in scenario docs that Claude loads **only when relevant**.

### @import vs plain-text reference

Two mechanisms with opposite token economics:

- **`@import`** expands **immediately at session start**: the file's content is always in context and occupies the instruction budget. Use it only for what's needed in every session.
- **A plain-text path mention without `@`** ("For engine work read `docs/agent/engine.md`") loads nothing up front — the agent opens the file itself when the task calls for it. For example, if you ask Claude to "add a new condition for checking phone numbers," it will naturally read `docs/agent/platform.md` because the task involves the condition registry.

It's precisely these plain-text references that give **progressive disclosure** — the right context loads at the right moment, without eating into the budget every session.

### Commands: README.md vs CLAUDE.md

A common mistake is putting all commands in CLAUDE.md. The rule:

| Command type | Where to put it | Why |
|---|---|---|
| Commands Claude will execute (lint, typecheck, migrate) | CLAUDE.md | Claude needs exact syntax |
| Commands you run manually (dev server, DB reset, deploy) | README.md only | Wastes instruction budget |
| Commands in both categories | CLAUDE.md for Claude's subset, plain-text reference to README.md for full list | No duplication |

If all commands are already in README.md, reference it as plain text (without `@`, so you don't pull the whole README into every session):
```markdown
See README.md for setup commands and environment variables.
```

---

## 5. Global vs Project CLAUDE.md

### Global (`~/.claude/CLAUDE.md`)

Applies to **all projects**. Should contain only universal preferences:

```markdown
# Language
- Always respond in Ukrainian. Use Ukrainian for all explanations.
- Technical terms and code identifiers remain in English.

# Thinking (before coding)
- State assumptions explicitly. If uncertain — ask before implementing.
- If multiple interpretations exist, present them. Don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear — stop, name what's confusing, ask.

# Code style
- Prefer concise, readable code over clever abstractions
- Type-annotate all functions and variables in Python
- Match existing patterns and style, even if you'd do it differently
- No abstractions for single-use code. No speculative "flexibility".

# Workflow
- Before writing new code, search for existing utilities. Reuse them.
- Run typecheck and linter after making code changes
- Prefer running single tests over the full suite for speed
- When fixing a bug, write a failing test first, then fix
- Do not commit or suggest committing — IDE handles it
```

**Key rule**: every line here must be true for ALL your projects. If it's project-specific, it goes in the project CLAUDE.md.

### Project (`./CLAUDE.md`)

Specific to one codebase. This is the orchestrator described in section 4.

### Personal project overrides (`./CLAUDE.local.md`)

For personal preferences that shouldn't be shared with the team. Add to `.gitignore`.

---

## 6. Writing Scenario-Based Docs

Scenario docs are detailed guides for specific development workflows. They live in a dedicated folder (e.g., `docs/agent/`); CLAUDE.md references them as plain text without `@`, and the agent opens them when needed.

### Identifying scenarios

Analyze your actual development patterns. Common categories:

1. **CRUD/API work** — adding new endpoints, models, schemas, services
2. **Core logic** — modifying business logic, engine, algorithms
3. **Integrations** — connecting external services, APIs, platforms
4. **Infrastructure** — database migrations, deployment, configuration
5. **Testing** — test patterns, fixtures, mocking strategies

### Scenario doc structure

Each scenario doc should follow this template:

```markdown
# {Scenario Title}

Brief description of when this doc is relevant.

## Architecture / Pipeline
How components connect (a text diagram or bullet list).

## Key files
Grouped by role (entry points, core, state, utilities).
Format: `path/to/file.py` — what it does, key functions inside

## Step-by-step
Numbered steps for the most common task in this scenario.
Include code examples from your actual codebase.

## Patterns and conventions
Base classes to extend, decorators to use, return types expected.
Include real code examples with full imports.

## Constants & Enums
List relevant enums and where they live.

## Data helpers
Utility functions relevant to this scenario.
Show import paths and usage examples.

## Key files reference
Flat list of all critical files mentioned above for quick lookup.
```

### Writing principles for scenario docs

1. **Use actual code examples** from your codebase, not abstract illustrations
2. **Show the full import path** — Claude needs to know exactly where to import from
3. **Explain the "why" behind patterns** — "MUST return Request (never Response)" tells Claude the constraint
4. **Include the file structure** — where new files should be placed
5. **List base classes/registries** — what to extend, what decorator to use
6. **Reference constants and enums** — Claude needs to know which values are valid
7. **Group key files by role** — not alphabetically, but by function (entry points, core logic, state, utilities)

### Language

Write scenario docs in **English** — they are primarily for the AI agent, not for human reading. English maximizes token efficiency since the model was primarily trained on English text.

You can add localized synonyms for project-specific terms if the team uses non-English terminology:
```markdown
The flow engine (рушій флоу) is an event-driven workflow execution system.
```

---

## 7. Documenting Utilities and Shared Code

This is one of the highest-value sections in CLAUDE.md. Without explicit utility documentation, Claude will:

- Use `json.loads()` instead of your optimized `json_parse()` (orjson-based)
- Use `obj.get("a", {}).get("b")` instead of your `deep_get(obj, "a.b")`
- Write a new datetime formatter instead of using your `moment()`
- Use `print()` or `logging` instead of your `log` (loguru)
- Catch generic `Exception` instead of using domain-specific `FlowException`

### Format in CLAUDE.md

List critical utilities as **exact import statements** with notes on when to use (and when NOT to use an alternative):

```markdown
# Key utilities (always prefer these over writing new ones)
- `from app.core.data.json import json_parse, json_parse_or_default` — fast JSON via orjson (never use stdlib json)
- `from app.core.data.utils import deep_get, fast_deep_get, get_by_key, deep_set` — nested dict access
- `from app.core.db.redis import RedisService` — always use for Redis operations
- `from app.core.logging import log` — loguru logger (never use stdlib logging)
```

The "(never use X)" suffix is critical — it tells Claude what to avoid, not just what to prefer.

### In scenario docs

Repeat and expand utility documentation with usage details:

```markdown
## Data helpers (use these, don't rewrite)
- `fast_deep_get(obj, ("key1", "key2"))` — tuple path, fastest for known paths
- `deep_get(obj, "key1.key2")` — dotted string path
- `get_by_key(obj, "key")` — works on dict, list, or object (getattr)
- `deep_set(obj, "key1.key2", value)` — sets nested value
```

**Redundancy between CLAUDE.md and scenario docs is acceptable here** — it reinforces the instruction across different contexts. The orchestrator has a brief mention; the scenario doc has full details.

### Discovering utilities to document

Search your codebase for:
- `core/`, `utils/`, `helpers/`, `lib/`, `common/` directories
- Functions imported in 5+ files (they're clearly reusable)
- Custom wrappers around standard library functions (json, datetime, logging)
- Base classes that other classes inherit from
- Decorators used for registration patterns

---

## 8. Rules for Writing Effective Instructions

### Be actionable, not aspirational

```
❌ "Write clean, maintainable code following SOLID principles"
✅ "Extend BaseService, don't duplicate CRUD logic"
```

### Be specific about file paths

```
❌ "Import models in the base file"
✅ "MUST import new models in app/db/base.py — Alembic won't detect them otherwise"
```

### Use emphasis sparingly

You can use MUST, CRITICAL, IMPORTANT, NEVER — but only for truly critical rules. If everything is emphasized, nothing is. Reserve emphasis for things that will cause **silent failures** if ignored (like the Alembic import gotcha).

### Keep rules honest

Don't include rules you won't enforce. If you write "always ask before installing packages" and then say "just install it," Claude learns to ignore your rules. Write only what you'll actually hold to.

### Show the format, not just the rule

```
❌ "Use scoped commit messages"
✅ "Commit format: `scope: description` (e.g. `flow: fix hook receiving`)"
```

### One rule per line

Don't pack multiple rules into a single bullet point. Each line should be independently parseable by the model.

### Negative instructions are powerful

Telling Claude what NOT to do is often more effective than telling it what to do:
```markdown
- never use stdlib json — use `json_parse` from app/core/data/json
- never hard-delete — set deleted_at via `moment()`
- never use synchronous DB calls — async only with asyncpg
```

---

## 9. Common Mistakes

### Mistake 1: The Abstract Principle Dump

```markdown
# ❌ Bad CLAUDE.md
- Follow DRY principles
- Write clean code following SOLID
- Ensure security (data encryption, input validation, XSS/CSRF protection)
- Optimize for performance
- Consider scalability and high load scenarios
```

Claude already knows these. This wastes 5 instructions worth of budget on zero behavioral change.

### Mistake 2: The Command Encyclopedia

```markdown
# ❌ Bad: Every possible command
- Dev server: `poetry run dev`
- Worker: `poetry run arq app.worker.tasks.WorkerSettings`
- Docker build: `docker-compose up -d --build`
- Docker logs: `docker-compose logs -f backend`
- Reset DB: `poetry run python scripts/alembic/reset_db_full.py`
- Reset DB (semi): `poetry run python scripts/alembic/reset_db.py`
- Rollback: `poetry run python scripts/alembic/rollback_migration.py`
```

Most of these are run manually by the developer. Only include commands Claude will actually execute.

### Mistake 3: Code Style as Instructions

```markdown
# ❌ Bad: Using LLM as a linter
- Use 4 spaces for indentation
- Maximum line length: 100 characters
- Use single quotes for strings
- Sort imports alphabetically
```

This is the linter's job. LLMs are slower and less reliable at formatting than deterministic tools. If you need formatting enforcement, use a hook that runs the linter after edits.

### Mistake 4: The Monolithic CLAUDE.md

Putting everything in one file: commands, architecture, all scenarios, all file descriptions, all patterns. Result: 400+ lines, Claude ignores half.

**Solution**: Orchestrator pattern (section 4).

### Mistake 5: Auto-generated and Forgotten

Running `/init` and never reviewing the output. The generated file captures obvious patterns but misses:
- Your specific utility functions
- Non-obvious gotchas
- Team workflow preferences
- What NOT to do

Always manually review and refine.

### Mistake 6: Missing utility documentation

The most insidious mistake. Without explicit "use THIS function" instructions, Claude will write new code that duplicates your existing optimized utilities. This creates:
- Performance regressions (stdlib json vs orjson)
- Inconsistency (multiple datetime formatters)
- Maintenance burden (duplicate code to update)

---

## 10. Step-by-Step: Building Documentation for a New Project

### Phase 1: Foundation (30 min)

1. **Run `/init`** to generate a starter CLAUDE.md
2. **Delete everything that's obvious** — standard conventions, self-evident practices
3. **Add your tech stack** with specific versions on line 1
4. **Add a plain-text reference to `README.md`** for commands
5. **Identify 3–5 development scenarios** that you repeat most often

### Phase 2: Orchestrator (1 hour)

6. **Map your architecture** — what are the layers? Where do files go?
7. **List critical utilities** — imports that Claude should always use instead of writing new ones. Search your `core/`, `utils/`, `helpers/`, `lib/` directories for:
   - Custom JSON parsers
   - Logging wrappers
   - Date/time helpers
   - Data access utilities (deep_get, etc.)
   - Response/error builders
   - Base classes and their key methods
8. **Document gotchas** — things that break silently. Ask yourself: "What did I learn the hard way?"
9. **Add git conventions** — commit format, branch naming if non-standard
10. **Count your lines** — aim for 30–50 in the orchestrator

### Phase 3: Scenario Docs (2–3 hours)

11. **For each scenario**, create `docs/agent/{scenario}.md`:
    - Read the key files for that scenario
    - Document the step-by-step workflow with real code
    - Include architecture diagrams (text-based)
    - List all key files grouped by role
    - Document base classes, registries, decorators to extend
    - Include constants and enums with file paths
    - Add data helper documentation specific to this scenario

12. **Add plain-text references** to CLAUDE.md for each scenario doc (without `@` — so they aren't loaded every session)

### Phase 4: Global File (15 min)

13. **Review `~/.claude/CLAUDE.md`** — only universal cross-project rules
14. **Remove anything project-specific** — it belongs in the project file
15. **Keep it under 15 lines**

### Phase 5: Validation (ongoing)

16. **Test in a fresh session** — does Claude follow the rules?
17. **Monitor for these signals**:
    - Claude ignores a rule → file too long, or rule too vague
    - Claude asks a question answered in CLAUDE.md → phrasing is ambiguous
    - Claude reinvents a utility → utility isn't listed in CLAUDE.md
    - Claude uses wrong patterns → scenario doc needs more examples
18. **Every few weeks**: ask Claude to "Review this CLAUDE.md and suggest improvements"

---

## 11. Maintenance

### Adding new instructions

Before adding, apply this decision tree:

```
Is this universally applicable to all tasks?
  Yes → CLAUDE.md
  No → Is it specific to a development scenario?
    Yes → scenario doc in docs/agent/
    No → Is it a command I run manually?
      Yes → README.md only
      No → Does Claude already do this correctly without the instruction?
        Yes → Don't add it
        No → Add to the most specific location
```

### Removing stale instructions

Signs an instruction is stale:
- References files/functions that no longer exist
- Describes patterns that were refactored away
- Contradicts other instructions in the same file
- Claude follows it without it being written (it's now internalized behavior)

### Evolving scenario docs

When you add significant new patterns (new registries, new service types, new file structures), update the relevant scenario doc immediately. The doc should always reflect the **current** state of the codebase, not its history.

### After major refactors

Re-read all CLAUDE.md files and scenario docs. Refactors often invalidate:
- File paths
- Class/function names
- Import paths
- Architectural patterns

A stale doc is worse than no doc — it actively misleads.

---

## 12. Reference: Final File Structure

```
Project root
├── CLAUDE.md                    # Orchestrator (~40 lines)
│                                # Stack, architecture map with plain-text
│                                # references, key utilities, service patterns,
│                                # model conventions, gotchas, git
│
├── CLAUDE.local.md              # Personal overrides (gitignored)
├── README.md                    # Commands, setup, env vars (plain-text reference)
│
├── docs/agent/                  # Scenario-based docs (English)
│   ├── api.md                   # New API sections: routers, models, schemas, services
│   ├── engine.md                # Flow engine: runner, state, nodes, workers
│   └── platform.md              # Integrations: actions, conditions, effects, parsers
│
└── ~/.claude/CLAUDE.md          # Global: language, thinking rules, code style, workflow

~/.claude/projects/<project>/memory/   # Claude's auto-memory (MEMORY.md + files) —
                                       # lives outside the repo, not in git
```

### Sizing targets

| File | Target lines | Content |
|---|---|---|
| `~/.claude/CLAUDE.md` | 15–25 | Universal preferences + behavioral rules |
| `./CLAUDE.md` | 30–50 | Orchestrator with plain-text references to scenario docs |
| Each scenario doc | 50–200 | Detailed workflow + code examples |
| Total instruction load per session | < 200 | Orchestrator + 1–2 relevant scenario docs |

---

## 13. Sources

- [Best Practices for Claude Code — Anthropic official docs](https://code.claude.com/docs/en/best-practices)
- [Writing a good CLAUDE.md — HumanLayer Blog](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [How to Write a Good CLAUDE.md — Builder.io](https://www.builder.io/blog/claude-md-guide)
- [Claude Code Best Practices — GitHub (awattar)](https://github.com/awattar/claude-code-best-practices)
- [Claude Code Best Practices — GitHub (shanraisshan)](https://github.com/shanraisshan/claude-code-best-practice)
- [Using CLAUDE.MD files — Anthropic Blog](https://claude.com/blog/using-claude-md-files)
- [CLAUDE.md Best Practices — UX Planet](https://uxplanet.org/claude-md-best-practices-1ef4f861ce7c)
- Andrej Karpathy — behavioral CLAUDE.md pattern (Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution)

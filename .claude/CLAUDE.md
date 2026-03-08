# CLAUDE.md – Project Memory for Claude Code

This file contains persistent instructions, conventions and tooling rules for this Python project.  
Claude Code reads it automatically in this directory (and subdirectories).

## Project Overview
- Language     : Python 3.11+ (or 3.12+ preferred)
- Package manager & venv tool : **uv** (Astral's fast Rust-based replacement for pip + venv + poetry)
- Formatter    : **black** (single source of truth for code style — line length 88 or 100)
- Linter       : ruff (fast linting + import sorting — black-compatible)
- Test runner  : pytest
- Type checker : mypy (or pyright / ty if configured)
- Project config file : pyproject.toml (all tool settings live here)

## Critical Tooling Rules – MUST follow these
- **NEVER** use `pip`, `python -m venv`, `virtualenv`, `poetry`, `conda` or `pipx` directly.
- **ALWAYS** use **uv** commands for:
  - Adding / removing dependencies     →  uv add / uv remove
  - Installing / syncing lockfile      →  uv sync    (creates .venv if needed)
  - Running anything in the project    →  uv run <command>
  - Running scripts / one-offs         →  uv run python script.py   or   uv run --with httpx ...
  - Running tools                      →  uv run black .   or   uv run ruff check .
  - Creating new project               →  uv init (already done)

- **Formatting rule (non-negotiable)**:
  - Use **black** exclusively for formatting.
  - Command: `uv run black .`  or  `uv run black --check .` (CI / pre-commit)
  - Line length: 88 (default) — do NOT change unless pyproject.toml overrides it.
  - Respect black's opinionated style — no manual style debates.

- **Linting & import sorting**:
  - Use **ruff** (replaces flake8 + isort + many others)
  - Commands:
    - Check        →  `uv run ruff check .`
    - Fix auto     →  `uv run ruff check --fix .`
    - Format       →  `uv run ruff format .`   (black compatible mode)
  - Ruff should be configured in pyproject.toml → [tool.ruff] section

- **Testing**:
  - Always prefer TDD or at least write tests **before** or **together** with features
  - Run tests:     `uv run pytest`
  - Run one file:  `uv run pytest tests/test_xxx.py`
  - Run with coverage:  `uv run pytest --cov=src`

- **Type checking**:
  - Use mypy strict mode if configured
  - Command: `uv run mypy src tests`  or  `uv run ty check` (if using ty)

## Workflow Preferences
1. Check existing style → read nearby files first
2. Plan → write/update tests → implement → format/lint/type-check → commit
3. Before suggesting changes:
   - Reference patterns already used in the codebase
   - Prefer small, focused edits
4. Use modern Python features (3.11+ / 3.12+):
   - Type hints everywhere (use | union syntax, Self, etc.)
   - dataclasses (with slots=True when possible)
   - match / case statements
   - Exception groups / except* when appropriate

## Important Commands Cheat Sheet
- Setup / update env    :  uv sync
- Add production dep    :  uv add fastapi
- Add dev dep           :  uv add --dev pytest ruff black mypy
- Run the main app      :  uv run python -m my_project.main   (or uv run main.py)
- Run linter + format   :  uv run ruff check --fix . && uv run black .
- Run all quality checks:  uv run ruff check . && uv run black --check . && uv run mypy . && uv run pytest
- Lock dependencies     :  uv lock

## pyproject.toml is the single source of truth
- All tool configs (black, ruff, mypy, pytest, coverage, etc.) live in pyproject.toml
- Respect settings there — do NOT override them in commands unless explicitly told

## Gotchas & Anti-patterns to avoid
- Never suggest `pip install ...` or `python -m pip ...`
- Never create .venv manually — let uv handle it
- Never commit .venv or uv cache files — .gitignore should already exclude them
- Do not use print() for logging in library code — prefer logging module
- Avoid large god-files — prefer small focused modules
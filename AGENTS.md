# AGENTS.md

## Purpose
- Guidance for coding agents working in this repository.
- Prefer repository-native commands and existing patterns over framework defaults.
- Scope: whole monorepo (`apps/api` NestJS API + `agents` Go daemon).

## Repository layout
- `apps/api` — NestJS TypeScript backend.
- `agents` — Go agent module.
- `bin` — built agent binaries.
- `deploy/systemd` — service units.
- `deploy/packaging/deb` — packaging assets.

## Rule files discovered
- No repository `.cursorrules` file found.
- No `.cursor/rules/` directory found.
- No `.github/copilot-instructions.md` file found.
- Root `AGENTS.md` did not exist; this file is the canonical agent guide.

## Tooling summary
- Package manager: `npm` workspaces at repo root.
- API runtime/build system: NestJS + TypeScript + Jest + ESLint + Prettier.
- Agent runtime/build system: Go 1.22.2.
- Root automation exists in both `package.json` scripts and `Makefile`.

## Install commands
- Install JS dependencies from repo root: `npm install`
- There are no extra Go dependency steps beyond normal module resolution.

## Preferred commands
- Prefer root `npm` scripts for routine work.
- For Go work, prefer `npm run agent:*` or `go -C ./agents ...`.
- `make` targets for the Go agent are now module-aware and safe to use.

## Build commands
- Build everything: `npm run build`
- Build API only: `npm run api:build`
- Build agent only: `npm run agent:build`
- Alternative API build: `make api-build`
- Alternative agent build: `make agent-build`
- Alternative full build: `make build`

## Run commands
- Run API in dev/watch mode: `npm run api:start:dev`
- Run API once: `npm run api:start`
- Run agent: `npm run agent:run`
- Alternative API dev: `make api-dev`
- Alternative agent run: `make agent-run`

## Lint / format commands
- Lint API: `npm run api:lint`
- Root lint alias: `npm run lint`
- Format Go code: `npm run fmt`
- API local formatter script: `npm --workspace=api run format`
- Note: API lint runs ESLint with `--fix`, so it may modify files.

## Test commands
- Run all tests: `npm run test`
- Run API unit tests: `npm run api:test`
- Run agent tests: `npm run agent:test`
- API coverage: `npm --workspace=api run test:cov`
- API e2e tests: `npm --workspace=api run test:e2e`
- Alternative full test: `make test`
- Alternative agent test: `make agent-test`

## Single-test commands
- Single API unit test file from repo root:
  - `npm --workspace=api run test -- src/app.controller.spec.ts`
- Single API unit test by pattern inside `apps/api`:
  - `npm run test -- app.controller.spec.ts`
- Single API e2e test file from repo root:
  - `npm --workspace=api run test:e2e -- test/app.e2e-spec.ts`
- Single Go package test:
  - `go -C ./agents test ./internal/app`
- Single Go test by name:
  - `go -C ./agents test ./internal/app -run TestStopIsIdempotent -v`

## Known command/test caveats
- Current API e2e test is failing: `apps/api/test/app.e2e-spec.ts` expects `'Hello World!'`, but the controller returns `'logovisor api is running'`.
- If you touch API behavior, update the e2e expectation or implementation so unit and e2e tests agree.

## Verification order for common changes
- API-only change: run `npm run api:lint` then `npm run api:test`
- Go-only change: run `npm run fmt` then `npm run agent:test`
- Cross-project change: run `npm run lint` and `npm run test`
- If you changed API startup/build config, also run `npm run api:build`
- If you changed Go entrypoints or packaging, also run `npm run agent:build`

## TypeScript / NestJS style
- Use Prettier defaults from `apps/api/.prettierrc`:
  - single quotes
  - trailing commas
- ESLint is authoritative; do not fight autofixes.
- `prettier/prettier` is enforced as an error.
- `@typescript-eslint/no-floating-promises` is a warning; explicitly `await` or intentionally discard with `void`.
- `@typescript-eslint/no-explicit-any` is disabled, but use `any` only when a better type is impractical.
- `sourceType` is configured as `commonjs`; follow existing project setup.

## TypeScript imports
- Put external imports first, then local relative imports.
- Keep imports minimal and specific.
- Use one import statement per module unless TypeScript syntax requires otherwise.
- Match existing relative import style such as `./app.service`.

## TypeScript formatting / structure
- Use semicolons.
- Prefer short, readable methods.
- Keep controllers thin; move business logic into services.
- Follow Nest conventions: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.spec.ts`.
- Bootstrap async entrypoints with `void bootstrap();` when intentionally fire-and-forget.

## TypeScript types
- Add explicit return types to public methods and exported functions.
- Use concrete DTOs/interfaces/types when data shapes become non-trivial.
- Use generics where Nest helpers already expect them, e.g. `app.get<AppController>(AppController)`.
- Avoid type assertions unless integration boundaries make them necessary.

## TypeScript naming
- Classes: `PascalCase`
- Methods/functions/variables: `camelCase`
- Constants that are true compile-time constants may use `UPPER_SNAKE_CASE`, but existing code mostly uses `camelCase` locals.
- Test files end in `.spec.ts` or `.e2e-spec.ts`.

## TypeScript error handling
- Fail fast on startup errors rather than swallowing them.
- Await async Nest calls (`app.listen`, `app.init`, etc.).
- If intentionally ignoring a promise, mark it with `void`.
- Keep error handling consistent with framework conventions instead of adding ad hoc wrappers.

## Testing style in API
- Unit tests use Jest and live beside source in `src`.
- E2E tests live under `apps/api/test`.
- Use descriptive `describe`/`it` blocks tied to behavior, not implementation details.
- Keep expectations aligned with real service responses.

## Go style
- Always run `gofmt`; repository exposes `npm run fmt`.
- Follow standard Go layout already in use: `cmd/` for entrypoints, `internal/` for internal packages.
- Keep package names short and lowercase.
- Prefer small structs and focused methods.

## Go imports
- Use standard Go import grouping as produced by `gofmt`.
- Standard library imports come first; internal module imports come after a blank line.
- Do not hand-format import blocks against `gofmt` output.

## Go naming and API design
- Export only what needs to be shared across packages.
- Constructors should remain concise (`New()` is the established pattern here).
- Receiver names should be short and consistent (`a *App`).
- Channels and synchronization primitives should have intention-revealing names.

## Go concurrency and lifecycle patterns
- Preserve idempotent shutdown behavior using `sync.Once` where appropriate.
- Use `context.Context` for cancellation and shutdown coordination.
- Keep signal handling in `cmd/.../main.go`; keep application logic in `internal/...`.
- Prefer explicit shutdown timeouts for stop paths.

## Go error handling
- Use normal Go `if err != nil` flows.
- Return errors from library/app code; use `log.Fatal` only at process entrypoints.
- Do not panic for expected operational failures.

## Testing style in Go
- Prefer table-driven tests when cases multiply.
- Keep concurrency tests deterministic with channels/timeouts.
- Use `t.Fatal` / `t.Fatalf` for unrecoverable failures.
- Run focused tests with `-run` before broader suites when iterating.

## Change discipline for agents
- Make the smallest change that satisfies the request.
- Do not silently fix unrelated issues unless they block the task.
- If a command is known broken, avoid documenting it as the primary path.
- When touching tests, keep unit and e2e expectations synchronized.
- Preserve existing file/folder naming conventions.

## Good defaults for agent execution
- Start from repo root unless a command clearly belongs in a subproject.
- For API changes, inspect `apps/api/package.json`, ESLint config, and nearby tests first.
- For Go changes, execute via `go -C ./agents ...` from repo root.
- Prefer commands that already succeeded in this repository over theoretically equivalent alternatives.

## Quick command reference
- `npm install`
- `npm run api:start:dev`
- `npm run api:build`
- `npm run api:lint`
- `npm run api:test`
- `npm --workspace=api run test -- src/app.controller.spec.ts`
- `npm --workspace=api run test:e2e -- test/app.e2e-spec.ts`
- `npm run agent:build`
- `npm run agent:test`
- `go -C ./agents test ./internal/app -run TestStopIsIdempotent -v`

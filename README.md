# logovisor

Backend monorepo for log collection and monitoring.

## Structure

- `apps/api` — NestJS master backend
- `agents` — Go daemon agent
- `deploy/systemd` — service units for agent deployment
- `deploy/packaging/deb` — future deb packaging assets

## Quick start

```bash
npm install
make api-dev
make agent-run
```

## Useful commands

```bash
make api-build
make api-test
make api-lint
make agent-build
make agent-test
make build
make test
```

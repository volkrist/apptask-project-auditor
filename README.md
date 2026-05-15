# AppTask Project Auditor

## Auth bootstrap (current scope)

Session is stored in `playwright/.auth/user.json` (gitignored).

### Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

### First-time login (headed)

```bash
# Windows PowerShell
$env:APPTASK_EMAIL="you@example.com"
$env:APPTASK_PASSWORD="your-password"
npm run auth:login
```

If captcha appears, complete it in the opened browser.  
Alternative (interactive codegen):

```bash
npm run auth:record
```

### Board smoke test

```bash
npm run test:board
```

Uses `APPTASK_BOARD_URL` from env or default `https://apptask.ru/c/7/board/445`.

On failure: `npx playwright show-report` or open trace from `test-results/`.

### Commands

| Command | Description |
|---------|-------------|
| `npm run auth:login` | Headed login → save storage state |
| `npm run auth:record` | Interactive codegen + save state |
| `npm run test:board` | Smoke: open board, assert loaded |
| `npm run typecheck` | TypeScript check |

See [AGENTS.md](./AGENTS.md) for full MVP scope (rules, Discord — not implemented yet).

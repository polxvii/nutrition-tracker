# CLAUDE.md — Nutrition Tracker

Personal nutrition PWA (React 18 + Vite 6 + Tailwind v4 + Supabase), hosted on Cloudflare Pages (push `main` → auto-deploy).
Full context lives in `docs/` — read **docs/PROJECT_OVERVIEW.md** first; diagrams in **docs/ARCHITECTURE.md**; account changes in **docs/ACCOUNT_MIGRATION.md**.

## Working with the owner
- The owner writes in Thai — reply in Thai. **All in-app UI text must be English.**
- The app is login-gated: you can't drive it live. Verify with `npm run build` (must pass) and let the owner test on their phone.
- When a shipped change "isn't showing", suspect the stale PWA service-worker cache first (hard refresh / reopen / unregister SW).

## Hard rules (security / data)
- Server-side secrets never get a `VITE_` prefix (that bundles them into the browser).
- The Supabase anon key is public (RLS-gated). **Never use or request the `service_role` key.**
- **Never modify production data directly.** Draft SQL for the owner to run in the Supabase SQL Editor.
- Schema changes go into `supabase/schema.sql` as idempotent `add column if not exists` / `create ... if not exists` blocks.
- Creating accounts or entering passwords on the owner's behalf is prohibited.
- No direct `ANTHROPIC_API_KEY` in the app (Accenture policy). AI = the user's own Gemini key (BYOK), encrypted with `KEY_ENCRYPTION_SECRET` — that secret must match between local `.env` and Cloudflare.

## Code conventions
- Match the surrounding code: comment density, naming, Tailwind idioms; reuse `components/ui.jsx` (`Button`, `Card`, `Field`, `Input`, `Select`, `Collapsible`).
- Shared colour logic lives in `src/lib/tiers.js`; per-day goals come from `src/lib/goalHistory.js` (`goalForDate`). Don't fork these.
- Calorie model is **gross**: exercise is informational, never subtracted from intake.
- Macro colours: protein `#22c55e`, carbs `#3b82f6`, fat `#FEC6DF`.

## Git
- Conventional commits in English (`feat:`, `fix:`, `perf:`, `style:`, `docs:`), body explains why. End with the Co-Authored-By line the harness provides.
- On Windows PowerShell, pass multi-line commit messages via bash heredoc: `git commit -F - <<'EOF' ... EOF`.
- Commit/push only when asked or when the owner's request clearly implies shipping.

## Keep docs current
After any feature, schema, env, or architecture change, update the matching section of `docs/` (see the table in `docs/README.md`). If `docs/ARCHITECTURE.md` changes, run `node docs/build-diagrams.mjs` and commit the regenerated `docs/architecture.html`.

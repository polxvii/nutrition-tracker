# 🥗 Nutrition Tracker

PWA บันทึกโภชนาการสำหรับ body recomposition (เพิ่มกล้าม + ลดไขมัน) — ติดหน้าจอ iPhone ได้ sync ทุกเครื่องผ่าน Supabase
Live: <https://nutrition-tracker-as3.pages.dev>

**Stack:** React 18 · Vite 6 · Tailwind CSS v4 · vite-plugin-pwa · Supabase (Auth + Postgres/RLS) · Cloudflare Pages + Functions · Google Gemini (BYOK) · Open Food Facts · Recharts

## 📚 เอกสาร
- **[docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md)** — ทุกอย่างของโปรเจค (feature, DB, logic, env, gotchas)
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — diagram ทั้งหมด (หรือเปิด [docs/architecture.html](docs/architecture.html))
- **[docs/ACCOUNT_MIGRATION.md](docs/ACCOUNT_MIGRATION.md)** — ย้าย GitHub / Cloudflare / Supabase / Gemini account
- [CLAUDE.md](CLAUDE.md) — กติกาสำหรับ Claude Code
- [nutrition-tracker-blueprint.md](nutrition-tracker-blueprint.md) — แผนตั้งต้น (ประวัติ บางส่วนล้าสมัย)

## 🚀 รันในเครื่อง

```bash
npm install
cp .env.example .env    # เติม VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, KEY_ENCRYPTION_SECRET
npm run dev             # http://localhost:5173 — /api/* เสิร์ฟโดย dev middleware ใน vite.config.js
npm run build           # ตรวจก่อน push ทุกครั้ง
```

Database: รัน [`supabase/schema.sql`](supabase/schema.sql) ทั้งไฟล์ใน Supabase SQL Editor (รันซ้ำได้)

## 🌐 Deploy
push `main` → Cloudflare Pages build (`npm run build` → `dist`) + deploy `functions/api/*` อัตโนมัติ
env ที่ต้องตั้งใน Cloudflare: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `KEY_ENCRYPTION_SECRET` (Secret) — รายละเอียดใน docs

## 📱 ติดหน้าจอ iPhone
Safari เปิด URL → Share → **Add to Home Screen** · deploy แล้วไม่เห็นของใหม่ = cache ของ PWA → ปิดเปิดแอป / hard refresh

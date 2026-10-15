# คู่มือย้าย account

> อัปเดตล่าสุด: 2026-10-15
> แผนผังว่าอะไรผูกกับอะไร: [ARCHITECTURE.md §10](ARCHITECTURE.md#10-account-dependency-map--เปลี่ยนอะไรแล้วกระทบอะไร)

## หลักการ: **"โอน/เพิ่มสมาชิก" ดีกว่า "สร้างใหม่" เสมอ**

ถ้าโอนได้ → URL, key, ข้อมูล, user เดิมอยู่ครบ **ไม่ต้องแก้โค้ดเลย**
ถ้าสร้างใหม่ → ต้องตามแก้ env หลายที่ + เสี่ยงข้อมูล/ key ที่เข้ารหัสไว้ใช้ไม่ได้

| บริการ | ทางที่แนะนำ (ไม่ต้องแก้อะไร) | ทางสำรอง (สร้างใหม่) |
|---|---|---|
| GitHub | Transfer repo ไป account ใหม่ | clone + push เข้า repo ใหม่ |
| Supabase | เชิญ account ใหม่เป็น **Owner** ของ org เดิม (หรือ transfer project ไป org ของ account ใหม่) | project ใหม่ + ย้ายข้อมูล (ยากสุด — เลี่ยงถ้าทำได้) |
| Cloudflare | เพิ่ม account ใหม่เป็น member ของ Cloudflare account เดิม | สร้าง Pages project ใหม่ (URL เปลี่ยน) |
| Google (Gemini) | ไม่ต้องทำอะไร — key ผูกกับ Google account ไม่ใช่ app | สร้าง key ใหม่แล้ว add ใน Settings |
| Claude Code | ความรู้โปรเจคอยู่ใน repo แล้ว (`CLAUDE.md` + `docs/`) | — |

---

## ขั้น 0 — สำรองก่อนแตะอะไร (ทำทุกครั้ง)

1. **เก็บค่า `KEY_ENCRYPTION_SECRET`** จาก `.env` ในเครื่อง ไว้ใน password manager
   ค่านี้หายเมื่อไหร่ = Gemini key ที่เก็บไว้ทุกอันถอดรหัสไม่ได้ (ต้อง add ใหม่หมด)
2. Copy ไฟล์ `.env` ทั้งไฟล์เก็บไว้ (อยู่นอก git)
3. Export ข้อมูลแบบอ่านได้: แอป → Settings → 📤 Export data → เลือก Food + Weight + Measurements → ช่วงทั้งหมด
4. (ถ้าจะสร้าง Supabase ใหม่) dump ฐานข้อมูลเต็ม — เจ้าของรันเอง:
   Supabase Dashboard → **Connect** → copy connection string แล้ว
   ```bash
   pg_dump "<connection-string>" --schema=public --data-only -f nutrition-data.sql
   ```
   > ห้ามใช้/แปะ `service_role` key หรือรหัส DB ลงในไฟล์ใน repo

---

## ขั้น 1 — GitHub

**แนะนำ:** repo `polxvii/nutrition-tracker` → Settings → General → Danger Zone → **Transfer ownership** → account ใหม่
(GitHub redirect URL เก่าให้อัตโนมัติ)

หลังโอน:
- [ ] เครื่อง local: `git remote set-url origin https://github.com/<account-ใหม่>/nutrition-tracker.git`
- [ ] ตั้ง git identity ของ repo: `git config user.name "<ชื่อ>"` · `git config user.email "<id>+<user>@users.noreply.github.com"`
- [ ] Settings → Actions → General → Workflow permissions → **Read and write** (keepalive ต้อง push empty commit ได้)
- [ ] แท็บ Actions → ถ้า workflow "Supabase keepalive" ถูก disable ให้ Enable → กด **Run workflow** ดูว่าเขียว
- [ ] Cloudflare ต้องเห็น repo ใน account ใหม่ → ไปขั้น 2

## ขั้น 2 — Cloudflare Pages

### ทาง A (แนะนำ): เพิ่มสมาชิก
Cloudflare Dashboard (account เดิม) → Manage Account → **Members** → invite account ใหม่ (Super Administrator)
แล้วต่อ Git ใหม่ถ้า repo ถูกโอน: Pages project → Settings → Builds → Git repository → reconnect / ติดตั้ง Cloudflare GitHub App ให้ account ใหม่ แล้ว allow repo นี้
> ⚠️ ถ้าขึ้น "disconnected from Git": push ระหว่างหลุดจะ **ไม่ build** — ต่อใหม่แล้ว **push commit ใหม่** (ปุ่ม Retry แค่ build commit เก่า)

### ทาง B: สร้าง project ใหม่
1. Workers & Pages → Create → Pages → **Connect to Git** → เลือก repo
2. Build: preset None/Vite · command `npm run build` · output `dist` · root `/`
3. Environment variables (ตั้งทั้ง **Production และ Preview**):

   | ชื่อ | ค่า | ชนิด |
   |---|---|---|
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | plain |
   | `VITE_SUPABASE_ANON_KEY` | anon public key | plain |
   | `KEY_ENCRYPTION_SECRET` | **ค่าเดิม** จากขั้น 0 | **Secret (Encrypt)** |
   | `GEMINI_MODELS` | (ไม่ต้องตั้ง เว้นแต่จะ override ลำดับโมเดล) | plain |

   > ไม่ต้องตั้ง `GEMINI_API_KEY` แล้ว (BYOK) · ห้ามมี key ลับตัวไหนขึ้นต้น `VITE_`
   > ถ้า build ล้มเรื่อง Node version ให้เพิ่ม `NODE_VERSION` = `22`
4. Deploy → ได้ URL ใหม่ `https://<project>.pages.dev`
5. Supabase → Authentication → **URL Configuration** → Site URL + Redirect URLs = URL ใหม่ (ใช้ในลิงก์ยืนยันอีเมลตอนสมัคร)
6. มือถือ: ลบ PWA ตัวเก่า → เปิด URL ใหม่ใน Safari → Share → **Add to Home Screen** → login ใหม่
   (session/localStorage ผูกกับ origin — URL เปลี่ยน = ต้อง login ใหม่ ข้อมูลไม่หาย เพราะอยู่ใน Supabase)
7. ทุกอย่างเขียวแล้วค่อยลบ project เก่า

## ขั้น 3 — Supabase

### ทาง A (แนะนำมาก): เก็บ project เดิม
Supabase Dashboard → Organization settings → **Team** → invite account ใหม่เป็น **Owner**
(ถ้าอยากให้ project อยู่ใน org ของ account ใหม่: Project Settings → General → **Transfer project** ไป org ที่ account ใหม่เป็น owner)
→ URL, anon key, ข้อมูล, user ทั้งหมดเหมือนเดิม **ไม่ต้องแก้ env / โค้ด / keepalive**

### ทาง B: project ใหม่ (เลี่ยงถ้าทำได้)
1. สร้าง project → SQL Editor → รัน [`supabase/schema.sql`](../supabase/schema.sql) ทั้งไฟล์ (idempotent)
2. Authentication → Sign In / Providers → Email เปิดไว้ · ตั้ง "Confirm email" ตามต้องการ · ตั้ง Site URL (ขั้น 2.5)
3. ย้ายข้อมูล: **user id จะเปลี่ยน** ถ้าสมัครใหม่ → ต้อง remap `user_id` ใน dump ก่อน restore (หรือ restore schema `auth` ด้วย — ซับซ้อน ทำทีละขั้นกับ Claude แบบร่าง SQL ให้เจ้าของรันเอง)
4. ตั้ง admin (ถ้าจะใช้ Gemini key > 1 อัน) — เจ้าของรันเอง:
   ```sql
   update public.profiles set role = 'admin' where email = '<อีเมลเจ้าของ>';
   ```
5. แก้ทุกที่ที่อ้าง URL/anon key เดิม:
   - [ ] Cloudflare env `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` → **redeploy** (ค่าถูกฝังตอน build)
   - [ ] local `.env`
   - [ ] [`.github/workflows/keepalive.yml`](../.github/workflows/keepalive.yml) — `SUPABASE_URL` + `SUPABASE_ANON_KEY` **hard-code ไว้** (anon key เป็น public ใส่ได้ · ห้ามใส่ service_role)
   - [ ] `docs/PROJECT_OVERVIEW.md` §3 + `docs/ARCHITECTURE.md` §1 (project ref)
6. Gemini key ที่เก็บใน DB เก่าไม่ตามมา → ผู้ใช้ add key ใหม่ใน Settings

## ขั้น 4 — Google / Gemini key

- key เป็นของ Google account ของผู้ใช้ เก็บแบบเข้ารหัสใน `user_api_keys` → ถ้า Supabase + `KEY_ENCRYPTION_SECRET` เดิม = **ไม่ต้องทำอะไร**
- เปลี่ยน Google account: สร้าง key ที่ <https://aistudio.google.com/apikey> → แอป Settings → 🤖 AI — your Gemini key → Add (ลบ key เก่าได้)
- โควตา free tier คิด **ต่อ Google Cloud project** — key 2 อันใน project เดียวกันไม่ได้เพิ่มโควตา ต้องคนละ project/account
- ถ้าจำเป็นต้องสร้าง `KEY_ENCRYPTION_SECRET` ใหม่ (ทำเฉพาะเมื่อยอมให้ทุกคน add key ใหม่):
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
  ใส่ค่าเดียวกันทั้ง Cloudflare (Secret) และ `.env` แล้วลบแถวใน `user_api_keys` เก่าทิ้ง (ผู้ใช้ลบเองจาก Settings ได้)

## ขั้น 5 — Claude Code / Claude account

- ความรู้โปรเจคทั้งหมดอยู่ใน repo: [`CLAUDE.md`](../CLAUDE.md) (Claude Code โหลดอัตโนมัติทุก session ทุก account) + `docs/`
- memory ส่วนตัวของ Claude อยู่ในเครื่อง (`~/.claude/projects/<path>/memory/`) ไม่ได้ผูกกับ account — เครื่องเดิม/path เดิม = ยังอยู่ · เครื่องใหม่ = copy โฟลเดอร์นั้นตามไปได้ (ไม่จำเป็น เพราะ CLAUDE.md + docs ครอบคลุมแล้ว)
- นโยบาย Accenture เดิมยังใช้: แอป **ห้าม** ใช้ `ANTHROPIC_API_KEY` ตรง → AI ใช้ Gemini ส่วนตัว (BYOK)

---

## ขั้น 6 — ตรวจหลังย้าย (ต้องเขียวครบก่อนลบของเก่า)

- [ ] push commit เล็ก ๆ → Cloudflare build ผ่าน → เว็บเปิดได้
- [ ] login ด้วย account เดิมได้ · หน้า Log เห็นข้อมูลเก่า
- [ ] AI analyze ได้ (แปลว่าถอดรหัส key ผ่าน)
- [ ] ค้นหาอาหาร (Database) + สแกน barcode ได้ (`/api/food`)
- [ ] Actions → Supabase keepalive → Run workflow → เขียว
- [ ] PWA บนมือถือติดตั้งใหม่ (ถ้า URL เปลี่ยน)

## Troubleshooting — ข้อความ error → สาเหตุ

| อาการ / ข้อความ | สาเหตุ | แก้ |
|---|---|---|
| หน้า login ใช้ไม่ได้ · console: `[Supabase] Missing VITE_SUPABASE_URL` | build ไม่มี env `VITE_*` | ตั้งใน Cloudflare แล้ว **redeploy** |
| `Server is missing the Supabase config.` | Functions หา Supabase URL/key ไม่เจอ | ตั้ง `VITE_SUPABASE_*` (หรือ `SUPABASE_*`) ใน Cloudflare |
| `Server is missing KEY_ENCRYPTION_SECRET.` | ไม่มี secret | ตั้งใน Cloudflare (Secret) |
| `KEY_ENCRYPTION_SECRET must be base64 of exactly 32 bytes` | รูปแบบค่าผิด | ใช้ base64 ของ 32 bytes |
| `Your stored key could not be read. Please re-add your key.` | secret ไม่ตรงกับตอนที่เข้ารหัส | ใส่ค่าเดิมกลับ หรือ add key ใหม่ |
| `Add your own Gemini API key to use AI analysis.` | ไม่มี key (หรือ key เดียวเป็น `invalid`) | Settings → add key |
| `You already have the maximum number of keys` | trigger จำกัด user 1 key | ตั้ง `role='admin'` (SQL) |
| deploy แล้วไม่เห็นของใหม่ | PWA cache | hard refresh / ปิดเปิดแอป / unregister service worker |
| keepalive แดง | URL/key ใน yml เก่า หรือ project pause | แก้ yml / unpause ใน Supabase |

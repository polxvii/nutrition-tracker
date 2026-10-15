# Nutrition Tracker — ภาพรวมโปรเจคฉบับเต็ม

> อัปเดตล่าสุด: 2026-10-15 · commit ล่าสุดตอนเขียน: `6e606c6` (main)
> เอกสารชุดนี้เป็น **source of truth** สำหรับคนที่มารับต่อ (รวมถึงตอนย้าย account)
> ดู diagram ที่ [ARCHITECTURE.md](ARCHITECTURE.md) · ขั้นตอนย้าย account ที่ [ACCOUNT_MIGRATION.md](ACCOUNT_MIGRATION.md)

---

## 1. โปรเจคนี้คืออะไร

PWA บันทึกโภชนาการส่วนตัว สำหรับ body recomposition (เพิ่มกล้าม + ลดไขมัน) — ติดหน้าจอ iPhone ได้ sync ทุกเครื่องผ่าน Supabase

- **ผู้ใช้หลัก:** เจ้าของโปรเจคคนเดียว (มีระบบ multi-user + RLS รองรับคนอื่นได้)
- **UI ในแอปเป็นภาษาอังกฤษทั้งหมด** (เจ้าของคุยกับ Claude เป็นภาษาไทย)
- **จุดเด่น:** log อาหารไทยด้วย AI ถ่ายรูป (Gemini), วัด maintenance จริงจากน้ำหนัก + การกิน (adaptive TDEE), สีบอกผลแต่ละวันเทียบเป้าที่ใช้ *ในวันนั้น* (goal history)

## 2. Tech stack

| ชั้น | เทคโนโลยี |
|---|---|
| Frontend | React 18 · Vite 6 · Tailwind CSS v4 (`@tailwindcss/vite`) · react-router-dom 6 · Recharts 2 |
| PWA | vite-plugin-pwa (`generateSW`, `registerType: 'autoUpdate'`) |
| Barcode | `@zxing/browser` + `@zxing/library` (lazy-load เฉพาะตอนเปิดสแกน) |
| Backend (serverless) | Cloudflare Pages Functions (`functions/api/*`) — core logic อยู่ `server/*` ใช้ร่วมกับ Vite dev middleware |
| Database / Auth | Supabase (Postgres + RLS + email/password auth) |
| AI | Google Gemini (free tier) แบบ **BYOK** — ผู้ใช้แต่ละคนใส่ key ตัวเอง เก็บแบบเข้ารหัส AES-256-GCM |
| Food DB | Open Food Facts (Search-a-licious + v2 product API) ผ่าน proxy `/api/food` |
| CI | GitHub Actions `keepalive.yml` (กัน Supabase free tier pause) |
| Hosting | Cloudflare Pages — push `main` = auto deploy |

Node ที่ใช้ dev ล่าสุด: v24 · ไม่มี test suite — ตรวจด้วย `npm run build` ผ่าน

## 3. บริการภายนอก + account ที่ผูกอยู่ (inventory)

| บริการ | ใช้ทำอะไร | ตัวระบุ (ไม่ใช่ความลับ) | ความลับอยู่ที่ไหน |
|---|---|---|---|
| **GitHub** | repo + Actions | `polxvii/nutrition-tracker` · branch `main` (มี `redesign` เก่าค้าง ไม่ใช้แล้ว) · git identity `polxvii` / `polxvii@users.noreply.github.com` | — |
| **Cloudflare Pages** | host static + Functions | `https://nutrition-tracker-as3.pages.dev` · build `npm run build` · output `dist` | env vars ใน Pages → Settings → Variables |
| **Supabase** | Auth + Postgres | project ref `uqtzfwnqsjwwryehjlna` · URL `https://uqtzfwnqsjwwryehjlna.supabase.co` | anon key = public (อยู่ใน bundle + `keepalive.yml`) · **ห้ามใช้ service_role key** |
| **Google AI Studio** | Gemini key (BYOK) | key ของผู้ใช้แต่ละคน เก็บใน `user_api_keys` แบบเข้ารหัส | ตัว key จริงอยู่กับผู้ใช้ · master key = `KEY_ENCRYPTION_SECRET` |
| **Open Food Facts** | ค้นหาอาหาร / barcode | ไม่ต้องมี account (ส่ง User-Agent) | — |

### Environment variables

| ตัวแปร | ที่ไหน | ใช้ทำอะไร |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env` + Cloudflare (build) | client เชื่อม Supabase (ฝัง bundle — public) |
| `VITE_SUPABASE_ANON_KEY` | `.env` + Cloudflare (build) | anon key (public, ถูก RLS คุม) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | optional | ฝั่ง server — ถ้าไม่ตั้งจะ fallback ไปใช้ `VITE_*` |
| `KEY_ENCRYPTION_SECRET` | `.env` + Cloudflare (**secret**) | master key AES-256 (base64 ของ 32 bytes) — **ต้องตรงกันทั้ง local และ prod** เพราะใช้ DB เดียวกัน ถ้าหาย/เปลี่ยน key ที่เก็บไว้ทั้งหมดจะถอดรหัสไม่ได้ |
| `GEMINI_MODELS` | optional | override ลำดับโมเดล (comma-separated) |
| ~~`GEMINI_API_KEY` / `GEMINI_API_KEYS`~~ | — | **เลิกใช้แล้ว** ตั้งแต่ BYOK (2026-07-29) ลบออกจาก Cloudflare ได้ |

> กฎเหล็ก: key ฝั่ง server **ห้ามมี prefix `VITE_`** (ไม่งั้นหลุดเข้า bundle ฝั่ง browser)

## 4. โครงสร้างโฟลเดอร์

```
functions/api/       Cloudflare Pages Functions (entry บาง ๆ เรียก server/*)
  analyze.js           POST /api/analyze  → byok.analyzeForUser
  keys.js              POST /api/keys     → byok.addKeyForUser
  food.js              GET  /api/food     → foodSource (OFF search / barcode)
server/              logic ฝั่ง server (ใช้ทั้ง prod + Vite dev middleware)
  byok.js              verify JWT, rate limit, โหลด+ถอดรหัส key, เรียก analyzeFood, flip status key
  analyzeFood.js       Gemini cascade (model × key), timeout, cooldown, map error → ข้อความ
  crypto.js            AES-256-GCM encrypt/decrypt (Web Crypto)
  foodSource.js        Open Food Facts proxy + normalize per-100
src/
  App.jsx              routing: login → onboarding → app shell (+BottomNav)
  contexts/AuthContext session + profile
  pages/               Login, Onboarding, Today (/), Calendar, Weight (= Progress), Settings
  components/          AddFood, PhotoLogger, EntryEditor, FrequentEditor, MealEditor, ExportCard,
                       TargetsEditor, GoalHistoryCard, MealWindowsCard, ApiKeyManager, BodyMeasurements,
                       BarcodeScanner, SwipeRow, AlcoholField, ProgressRing, ui.jsx (Button/Card/Field/Input/Select/Collapsible)
  lib/                 supabase (remember-me storage), nutrition (BMR/TDEE/macros), tiers (สี),
                       goalHistory, mealWindows, macros (alcohol), foodSearch, image (ย่อรูป),
                       analyzeApi, dateHelpers, useSwipe, useLongPress
supabase/schema.sql  schema ทั้งหมด (idempotent — รันซ้ำได้)
.github/workflows/keepalive.yml   ping Supabase ทุกวัน 03:17 UTC
docs/                เอกสารชุดนี้
nutrition-tracker-blueprint.md    แผนตั้งต้น (ประวัติ — บางส่วนล้าสมัยแล้ว)
```

## 5. ฐานข้อมูล (Supabase / Postgres)

ทุกตาราง **RLS เปิด** — policy `auth.uid() = user_id` (profiles ใช้ `id`) · role `anon` ไม่มีสิทธิ์อะไรเลย · `authenticated` ได้ CRUD

| ตาราง | หน้าที่ | หมายเหตุสำคัญ |
|---|---|---|
| `profiles` | ข้อมูลร่างกาย + เป้า (1 แถว/user, pk = auth.users.id) | `role` (`user`/`admin` — ตั้งมือใน SQL เท่านั้น), `meal_windows` jsonb, `goal_weight_kg` |
| `food_logs` | ทุกรายการที่กิน + exercise | `source` = manual/frequent/ai/barcode/search/meal/**exercise** · `components` jsonb (dish breakdown) · `servings`, `serving_g`, `alcohol_g` |
| `frequent_foods` | Saved foods + **barcode cache** | unique(user_id, food_name) · แถวที่มี `barcode` = cache (ซ่อนจาก Saved list) |
| `saved_meals` | combo หลายรายการ | `items` jsonb |
| `weight_logs` | น้ำหนักรายวัน | unique(user_id, logged_date) |
| `body_measurements` | รอบวง (cm) | `measurements` jsonb {waist, chest, arms, thighs, hips} |
| `goal_history` | snapshot เป้าที่มีผลตั้งแต่วันที่ X | unique(user_id, effective_from) — ทำให้เปลี่ยนเป้าแล้วอดีตไม่เปลี่ยนสี |
| `user_api_keys` | Gemini key เข้ารหัส (BYOK) | `encrypted_key` = `base64(iv).base64(ct)` · `status` active/exhausted/invalid · trigger จำกัด user 1 / admin 10 key |

> **ห้ามแก้ข้อมูล production ตรง ๆ** — ร่าง SQL ให้เจ้าของรันเองใน SQL Editor เท่านั้น
> เพิ่มคอลัมน์ใหม่ = ต่อท้าย `schema.sql` แบบ `add column if not exists` (คง idempotent)

## 6. Feature ทั้งหมด (ตามหน้า)

### Log — `/` (`pages/Today.jsx`)
- เลื่อนวัน (ปุ่ม / swipe ซ้าย-ขวา / `?date=YYYY-MM-DD` จาก Calendar)
- สรุปวัน: วง kcal (เหลือกี่ kcal ในวง, สีตาม tier), Eaten / Goal / Burned, แถบ P/C/F (+ alcohol) — ใช้เป้าของ *วันนั้น* (goal history)
- รายการแยกมื้อ (breakfast/lunch/dinner/night/snack/other + exercise) พร้อม kcal + P/C/F รวมต่อมื้อ · "＋ meal" บันทึกทั้งมื้อเป็น saved meal
- แถว: swipe → Copy / Delete · แตะ → EntryEditor (แก้ทุกอย่าง, dish drill-down แก้ component, servings stepper, save เป็น saved food / saved meal, ABV ของเครื่องดื่ม)
- **กดค้าง → multi-select**: bulk เปลี่ยน Meal / ย้าย Date / Copy (เลือก date + meal) / Delete · Select all ↔ Clear

### Add food (full-screen, `components/AddFood.jsx`)
- เลือก meal (default ตามเวลา `mealWindows`) · ค้นหา: อาหารตัวเอง (saved + recent + ประวัติทั้งหมด + ชื่อใน dish component) + Open Food Facts
- ⭐ Saved foods (แตะชื่อ = เลือก servings/grams, ＋ = add ทันที) · 🍱 Saved meals (แตะชื่อ = confirm เลือก meal + ดู items, ＋ = add ทันที) · Recent (swipe = ⭐ save)
- 🤖 **AI** (`PhotoLogger`): สูงสุด 12 รูป, paste รูปในช่องข้อความได้, แตะรูปดูเต็มจอ, ย่อรูปฝั่ง client (900px JPEG), แก้ทุก item, servings คูณทั้งหมด, log เป็น dish เดียวหรือแยก item, แอลกอฮอล์คำนวณจาก ml × ABV · Gemini ล่ม (503) แสดงแถบเหลือง 🚧
- 📷 Barcode: สแกน → cache ส่วนตัวก่อน → OFF → ไม่เจอส่งต่อ AI อ่านฉลาก (แล้ว cache ให้)
- ✎ Manual (มี alcohol calculator)

### Calendar — `/calendar`
- heatmap รายเดือน: kcal/วัน สีเทียบเป้า + maintenance ของวันนั้น, P·C·F, 🔥 exercise, 🍷 alcohol · คอลัมน์ wk avg (≥2 วันที่ log) · swipe เปลี่ยนเดือน · แตะวันไปหน้า Log
- Month summary: วันที่ log, avg kcal/P/C/F เทียบเป้า, วันที่ ≤ เป้า, ประมาณน้ำหนักที่เปลี่ยน vs maintenance, toggle Include today, 🏃 จำนวนวัน workout, ⚖️ น้ำหนักต้น→ท้ายเดือน

### Progress — `/weight` (`pages/Weight.jsx`)
- ช่วง: 7d / 15d / 30d / 90d / Custom + Include today (ไม่รวมวันนี้ = เลื่อนหน้าต่างถอยไป 1 วัน จำนวนวันเท่าเดิม)
- Insight · Energy balance + ประมาณผลต่อน้ำหนัก · Adherence chart (แท่งสี tier, เส้น goal + maintenance, rolling 7 วัน, แกน Y cap กัน outlier — แท่งที่ทะลุเป็นแดงเข้ม + ▲) · Weekday vs weekend · Alcohol · Calories by meal (แท่ง stacked P/C/F ยาว = kcal)
- **Weekly check-in** (measured maintenance): หน้าต่าง 14/28/56/90 วัน, แสดง maintenance + ช่วง 95% เสมอ, toggle ตัด outlier (MAD), verdict ว่าเป้าขาด/เกินชัดหรือยังบอกไม่ได้, Review & apply ผ่าน TargetsEditor → บันทึก goal_history
- ⚖️ Weight: log/แก้, กราฟ daily + EWMA + เส้น goal, Low/High ของช่วง, goal projection, history เฉพาะในช่วงที่เลือก
- 📏 Body measurements

### Settings — `/settings`
Sign out · 🧍 Body info · 🎯 Targets (แก้ BMR/TDEE/macro ได้) · 🎯 Goal history (เพิ่ม/ย้อนหลัง/แก้/ลบช่วงเป้า) · 🕒 Meal times · 📤 Export CSV (food / weight / measurements เลือกหลายอย่างพร้อมกัน, preset รวม Yesterday, dish แตกเป็นแถว component) · 🤖 AI — your Gemini key (BYOK)

### Login / Onboarding
email + password (Supabase) · "Remember me" (localStorage vs sessionStorage) · Onboarding บังคับจนกว่าจะมี `goal_calories`

## 7. Logic สำคัญ (อย่าเปลี่ยนโดยไม่ตั้งใจ)

### 7.1 Calorie model = **gross**
`kcal` = สิ่งที่กินจริง · goal และ maintenance **รวมกิจกรรมแล้ว** → exercise เป็นข้อมูลประกอบเท่านั้น **ไม่ลบออก** จาก intake

### 7.2 เป้าเริ่มต้น (`lib/nutrition.js`)
- BMR: Katch-McArdle ถ้ามี body fat (`370 + 21.6×LBM`) ไม่งั้น Mifflin-St Jeor
- TDEE = BMR × activity (1.2 / 1.375 / 1.55 / 1.725 / 1.9)
- Goal: recomp −200 · cut −15/20/25% · bulk +5/10/15% · maintain = TDEE · ไม่ต่ำกว่า BMR
- Protein 2.2 (recomp/cut) · 1.8 (bulk) · 1.7 (maintain) g/kg · Fat `0.8 g/kg` แต่ ≥25% kcal · Carbs = ที่เหลือ

### 7.3 สี tier (`lib/tiers.js`) — ใช้ร่วมทุกหน้า
- kcal: เขียว ≤ goal+band · เหลือง > goal+band · แดง > maintenance+band
- band ต่อวัน (เฉพาะ daily, ค่าเฉลี่ยไม่มี band): `kcalBand = clamp(deficit×0.30, goal×2%, goal×5%)` · ไม่มี deficit = 5%
- protein: เขียวเมื่อ ≥ goal−band · แดงเมื่อ < 75% · carbs/fat: เหลืองเมื่อเกิน · แดงเมื่อ > 125%
- สี macro (กราฟ/แถบ): protein `#22c55e` · carbs `#3b82f6` · fat `#FEC6DF` · alcohol fuchsia

### 7.4 Goal history
แต่ละวันถูกตัดสินด้วยเป้าที่มีผลวันนั้น (`goalForDate`) · apply เป้าใหม่ = upsert แถว `effective_from = วันนี้`

### 7.5 Weekly check-in (adaptive TDEE)
- `maintenance = avgIntake − (slopeKgPerWeek / 7) × 7700`
- slope = OLS บนน้ำหนักดิบ + 95% CI (t-distribution, df = n−2)
- ช่วง 95% ของ maintenance = รวมแบบ quadrature: error จาก slope `(marginWk/7)×7700` ⊕ SE ของ intake `t(n−1)·sd/√n`
- outlier: MAD modified z-score `|0.6745(x−median)/MAD| > 3.5` (ตัดเฉพาะฝั่ง intake, MAD=0 ไม่ตัด) · วันที่ < `goal×0.5` ถือว่า log ไม่ครบ ข้าม
- หน้าต่าง: 14d (≥4 weigh-ins, span ≥8) · 28d (6/14) · 56d (8/30) · 90d (10/45)
- verdict: เป้าอยู่ใน range = "ยังบอกไม่ได้" (ไม่ให้ปรับ) · ต่ำกว่า/สูงกว่า range ชัด = แนะนำ + Review & apply
- กราฟ/projection ใช้ EWMA (τ ≈ 10 วัน, ถ่วงตามระยะวันจริง)

### 7.6 แอลกอฮอล์
7 kcal/g · `alcohol_g = ml × ABV% × 0.789` · AI drink → คำนวณเองแบบ deterministic ไม่เชื่อตัวเลขโมเดล

### 7.7 AI (Gemini BYOK) — `server/analyzeFood.js`
- ลำดับโมเดล: `gemini-flash-lite-latest` → `gemini-flash-latest` → `gemini-3-flash-preview` → `gemini-3.1-flash-lite` (ลอง **ทุก key ก่อน** แล้วค่อยลงโมเดลถัดไป)
- timeout 22s/ครั้ง · งบรวม 40s · 429 → cooldown 5 นาที (ต่อ key+model, ต่อ isolate) · rate limit 15 ครั้ง/นาที/user
- **ห้ามส่ง** `thinkingConfig: { thinkingBudget: 0 }` (alias ปัจจุบันตอบ 400)
- โควตา free tier คิด **ต่อ Google Cloud project ไม่ใช่ต่อ key** → key หลายอันในโปรเจคเดียวกันไม่ได้เพิ่มโควตา (ต้องคนละ project/account)
- error: 429 = เกินโควตารายวัน (reset เที่ยงคืน US Pacific ≈ บ่าย 2–3 โมงไทย) · 503 overload = capacity ของ Google ล่ม (ไม่ใช่โควตา — เพิ่ม key ไม่ช่วย, มักเกิดช่วงกลางวัน US = กลางคืนไทย) · 401/403 = key เสีย → status `invalid` (ต้อง add ใหม่)

## 8. Workflow การพัฒนา + deploy

```bash
npm install
cp .env.example .env      # เติมค่า (ดูหัวข้อ 3)
npm run dev               # http://localhost:5173 (หรือ .claude/launch.json = port 5174)
npm run build             # ตรวจก่อน push ทุกครั้ง
git push origin main      # Cloudflare build + deploy อัตโนมัติ
```

- Vite dev middleware (`vite.config.js`) เสิร์ฟ `/api/analyze`, `/api/keys`, `/api/food` ด้วยโค้ด `server/*` ชุดเดียวกับ prod
- SPA fallback: `public/_redirects` (`/* /index.html 200`) · PWA ไม่ cache `/api/*`
- Commit message แบบ conventional (`feat:` / `fix:` / `perf:` / `style:`) ภาษาอังกฤษ

## 9. Gotchas ที่เจอจริง

1. **PWA cache ค้าง** — deploy แล้ว "ไม่เห็นของใหม่" ให้สงสัยข้อนี้ก่อน: hard refresh / ปิดเปิดแอปใหม่ / DevTools → Application → Service Workers → Unregister
2. **Cloudflare หลุดจาก Git** — push ตอนหลุดจะไม่ build · ต่อใหม่ (GitHub App → allow repo) แล้ว push commit ใหม่ ("Retry" แค่ build commit เก่า)
3. **Supabase free tier pause หลัง 7 วันไม่มี activity** — keepalive workflow กันไว้ · GitHub ปิด scheduled workflow ถ้า repo เงียบ 60 วัน → workflow push empty commit ทุก ~50 วัน (ต้องเปิด Actions → Workflow permissions → Read and write)
4. **`KEY_ENCRYPTION_SECRET` ไม่ตรงกัน** ระหว่าง local/prod → key ที่เก็บไว้ถอดรหัสไม่ได้
5. `supabase.auth.onAuthStateChange` — ห้าม `await` supabase call ข้างใน (deadlock) ใช้ `setTimeout` แทน
6. Login-gated → Claude ตรวจ UI สดไม่ได้ ใช้ `npm run build` + ให้เจ้าของทดสอบบนมือถือ

## 10. Backlog / ไอเดียที่ค้าง

- per-day override "วันนี้ log ครบแล้ว" (กัน completeness floor ตัดวันกินน้อยจริงทิ้ง)
- ค่า 7700 kcal/kg ปรับได้
- เก็บรูปอาหารลง Supabase Storage (`photo_url` ยัง null)
- PWA prompt "มีเวอร์ชันใหม่ — reload" (ตอนนี้ autoUpdate เงียบ ๆ)
- ลบ branch `redesign` (ค้างตั้งแต่ 2026-08-04, merge แล้ว)

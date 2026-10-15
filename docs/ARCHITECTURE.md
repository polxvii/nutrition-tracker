# Nutrition Tracker — Architecture diagrams

> อัปเดตล่าสุด: 2026-10-15 · diagram เขียนด้วย Mermaid (GitHub render ให้อัตโนมัติ)
> ดูแบบไม่ต้องขึ้น GitHub: เปิด [architecture.html](architecture.html) ใน browser (สร้างจากไฟล์นี้ด้วย `node docs/build-diagrams.mjs`)
> **ไฟล์นี้คือต้นฉบับ** — แก้ที่นี่แล้วรันสคริปต์ใหม่ อย่าแก้ html ตรง ๆ

---

## 1. System context — ทุกอย่างคุยกับอะไร

```mermaid
flowchart LR
  user(["User — iPhone / browser PWA"])

  subgraph CF["Cloudflare Pages"]
    static["Static bundle<br/>React + Vite + service worker"]
    fn["Pages Functions<br/>/api/analyze · /api/keys · /api/food"]
  end

  subgraph SB["Supabase (ref uqtzfwnqsjwwryehjlna)"]
    auth["Auth<br/>email + password"]
    db[("Postgres<br/>RLS on every table")]
  end

  gemini["Google Gemini<br/>free tier · BYOK keys"]
  off["Open Food Facts<br/>search + barcode"]
  gh["GitHub<br/>polxvii/nutrition-tracker"]
  gha["GitHub Actions<br/>keepalive (daily 03:17 UTC)"]

  user -->|HTTPS| static
  user -->|"supabase-js: sign in, JWT"| auth
  user -->|"supabase-js: CRUD own rows"| db
  user -->|"fetch + Bearer JWT"| fn
  fn -->|"verify JWT, read own keys"| SB
  fn -->|generateContent| gemini
  fn -->|"search / product"| off
  gh -->|"push main = build + deploy"| CF
  gha -->|"REST ping + auth health"| SB
```

- Browser คุยกับ Supabase **ตรง** สำหรับข้อมูลทั่วไป (RLS คุมสิทธิ์) — ไม่ผ่าน Functions
- Functions ใช้เฉพาะงานที่ต้องมีความลับฝั่ง server (ถอดรหัส Gemini key) หรือเลี่ยง CORS (Open Food Facts)
- Functions เรียก Supabase ด้วย **JWT ของผู้ใช้เอง** (ไม่มี service_role) → RLS ยังคุมอยู่

## 2. Build + deploy pipeline

```mermaid
flowchart LR
  dev["Local dev<br/>npm run dev<br/>(Vite + dev API middleware)"]
  check["npm run build<br/>must pass"]
  push["git push origin main"]
  cfb["Cloudflare build<br/>npm run build → dist/<br/>functions/ auto-deployed"]
  live["nutrition-tracker-as3.pages.dev"]
  sw["Service worker<br/>registerType autoUpdate"]
  phone["Installed PWA<br/>(may serve old bundle until SW updates)"]

  dev --> check --> push --> cfb --> live --> sw --> phone
```

## 3. Frontend map — routes, pages, components

```mermaid
flowchart LR
  mainjsx["main.jsx<br/>BrowserRouter + AuthProvider"] --> app["App.jsx"]
  app -->|"no session"| login["Login<br/>sign in / sign up · remember me"]
  app -->|"profile has no goal_calories"| onb["Onboarding<br/>ProfileFields → computeTargets"]
  app -->|"signed in + onboarded"| shell["App shell + BottomNav"]

  shell --> today["/  — Today (Log)"]
  shell --> cal["/calendar — Calendar"]
  shell --> prog["/weight — Progress"]
  shell --> set["/settings — Settings"]

  today --> addfood["AddFood (full screen)"]
  addfood --> photo["PhotoLogger (AI)"]
  addfood --> scan["BarcodeScanner (lazy)"]
  addfood --> manual["AddFoodForm (manual)"]
  addfood --> savedv["Saved foods / Saved meals<br/>FrequentEditor · MealEditor"]
  today --> entry["EntryEditor<br/>dish components · servings · copy"]
  today --> exf["ExerciseForm"]
  today --> bulk["Multi-select bulk bar<br/>Meal · Date · Copy · Delete"]

  prog --> checkin["Weekly check-in<br/>→ TargetsEditor (review & apply)"]
  prog --> bm["BodyMeasurements"]

  set --> pf["ProfileFields + TargetsEditor"]
  set --> gh["GoalHistoryCard"]
  set --> mw["MealWindowsCard"]
  set --> ex["ExportCard (CSV)"]
  set --> keys["ApiKeyManager (BYOK)"]
```

Shared libs: `lib/tiers.js` (สี green/amber/red ทุกหน้า) · `lib/goalHistory.js` (เป้าตามวัน) · `lib/nutrition.js` (BMR/TDEE/macro) · `lib/macros.js` (alcohol) · `lib/mealWindows.js` (meal ตามเวลา) · `components/ui.jsx` (Button/Card/Field/Input/Select/Collapsible)

## 4. AI meal analysis — sequence (BYOK)

```mermaid
sequenceDiagram
  autonumber
  participant U as PhotoLogger (browser)
  participant F as /api/analyze (Pages Function)
  participant B as server/byok.js
  participant S as Supabase
  participant A as server/analyzeFood.js
  participant G as Gemini API

  U->>U: downscale photos (createImageBitmap, 900px JPEG q0.8)
  U->>F: POST images + note, Bearer JWT
  F->>B: analyzeForUser()
  B->>S: GET /auth/v1/user (verify JWT)
  B->>B: rate limit 15 req/min/user
  B->>S: GET user_api_keys (RLS, user JWT)
  B->>B: AES-256-GCM decrypt (KEY_ENCRYPTION_SECRET)
  B->>A: analyzeFood(keys, images, note)
  loop each model (outer) x each key (inner), skip pairs cooling down
    A->>G: generateContent (22s timeout, 40s total budget)
    G-->>A: 200 JSON, or 429 quota, or 503 overload, or 4xx
  end
  A-->>B: items, dish, confidence, model
  B->>S: PATCH key: last_used_at, status=active
  B-->>F: result
  F-->>U: JSON → editable estimate → log
  Note over B,S: on failure markStatus: 429 = exhausted, bad key = invalid
  Note over U: 503 overload shows amber "AI is down" notice
```

## 5. Adding a Gemini key — sequence

```mermaid
sequenceDiagram
  autonumber
  participant U as ApiKeyManager (browser)
  participant F as /api/keys (Pages Function)
  participant B as server/byok.js
  participant G as Gemini API
  participant S as Supabase

  U->>F: POST key + label, Bearer JWT
  F->>B: addKeyForUser()
  B->>S: verify JWT
  B->>G: tiny ping on 2 models
  G-->>B: 200 = active, 429 = exhausted (still valid), 400/401/403 = rejected
  B->>B: encrypt key (AES-256-GCM)
  B->>S: INSERT user_api_keys (DB trigger: user max 1, admin max 10)
  B-->>U: id, key_last4, status
  Note over U,S: list + delete keys go browser → Supabase directly (RLS)
```

## 6. Food search + barcode flow

```mermaid
flowchart TB
  q["User types in Add food search"] --> local["Local matches<br/>saved + recent + full history<br/>+ names inside dish components"]
  q --> api["GET /api/food?q=…"]
  api --> sal["OFF Search-a-licious"]
  sal -->|fails| legacy["OFF legacy cgi/search.pl"]

  b["Barcode scanned"] --> cache{"In personal cache?<br/>frequent_foods.barcode"}
  cache -->|yes| pick["Amount picker<br/>servings ⇄ grams"]
  cache -->|no| prod["GET /api/food?code=…<br/>OFF v2 product"]
  prod -->|found| pick
  prod -->|"not found"| ai["Open AI view<br/>read the label"]
  pick --> log["Insert food_logs<br/>(+ cache barcode row)"]
  ai --> log
```

## 7. Database — ER diagram

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "id = id"
  AUTH_USERS ||--o{ FOOD_LOGS : logs
  AUTH_USERS ||--o{ FREQUENT_FOODS : saves
  AUTH_USERS ||--o{ SAVED_MEALS : combos
  AUTH_USERS ||--o{ WEIGHT_LOGS : weighs
  AUTH_USERS ||--o{ BODY_MEASUREMENTS : measures
  AUTH_USERS ||--o{ GOAL_HISTORY : "goal periods"
  AUTH_USERS ||--o{ USER_API_KEYS : "BYOK keys"

  PROFILES {
    uuid id PK
    text email
    int age
    numeric weight_kg
    numeric height_cm
    text sex
    numeric body_fat_pct
    text activity_level
    text goal_type "recomp cut bulk maintain"
    text goal_rate "slow medium fast"
    int bmr
    int tdee
    int goal_calories
    int goal_protein_g
    int goal_carbs_g
    int goal_fat_g
    numeric goal_weight_kg
    text role "user or admin, set by SQL only"
    jsonb meal_windows
  }
  FOOD_LOGS {
    uuid id PK
    uuid user_id FK
    timestamptz logged_at
    text meal_type "breakfast lunch dinner night snack"
    text food_name
    text source "manual frequent ai barcode search meal exercise"
    numeric grams
    text unit "g or ml"
    numeric calories
    numeric protein_g
    numeric carbs_g
    numeric fat_g
    numeric alcohol_g
    jsonb components "dish breakdown"
    numeric servings
    numeric serving_g
    text ai_confidence
  }
  FREQUENT_FOODS {
    uuid id PK
    uuid user_id FK
    text food_name "unique per user"
    numeric default_grams
    text unit
    numeric calories
    numeric protein_g
    numeric carbs_g
    numeric fat_g
    numeric alcohol_g
    numeric serving_g
    text barcode "set = barcode cache row"
    int times_used
  }
  SAVED_MEALS {
    uuid id PK
    uuid user_id FK
    text name
    jsonb items
  }
  WEIGHT_LOGS {
    uuid id PK
    uuid user_id FK
    date logged_date "unique per user"
    numeric weight_kg
  }
  BODY_MEASUREMENTS {
    uuid id PK
    uuid user_id FK
    date logged_date "unique per user"
    jsonb measurements "waist chest arms thighs hips"
  }
  GOAL_HISTORY {
    uuid id PK
    uuid user_id FK
    date effective_from "unique per user"
    int goal_calories
    int goal_protein_g
    int goal_carbs_g
    int goal_fat_g
    int tdee
  }
  USER_API_KEYS {
    uuid id PK
    uuid user_id FK
    text provider "gemini"
    text encrypted_key "base64 iv . base64 ct"
    text key_last4
    text key_label
    text status "active exhausted invalid"
    timestamptz last_used_at
  }
```

ทุกตาราง: RLS `auth.uid() = user_id` · `anon` ไม่มีสิทธิ์ · `authenticated` CRUD

## 8. Weekly check-in — วิธีคำนวณ measured maintenance

```mermaid
flowchart TB
  w["weight_logs in window<br/>14 / 28 / 56 / 90 days"] --> gate{"enough weigh-ins<br/>and spread?"}
  gate -->|no| need["Not ready yet<br/>shows what's missing"]
  gate -->|yes| ols["OLS slope on raw weights<br/>+ 95% CI (t, df = n-2)"]

  f["food per day in window"] --> floor["skip days below goal x 0.5<br/>(under-logged)"]
  floor --> mad{"Exclude outliers?"}
  mad -->|yes| madf["drop MAD z-score > 3.5<br/>(listed on screen)"]
  mad -->|no| avg["avg intake"]
  madf --> avg

  ols --> maint["maintenance =<br/>avg intake - (slope per week / 7) x 7700"]
  avg --> maint
  maint --> range["95% range =<br/>slope error ⊕ intake SE"]
  range --> verdict{"current goal<br/>vs the range"}
  verdict -->|inside| unclear["Can't tell yet<br/>no change offered"]
  verdict -->|"clearly below / above"| apply["Suggest new goal<br/>Review & apply → profiles + goal_history"]
```

## 9. Calorie colour tiers (ใช้ร่วมทุกหน้า)

```mermaid
flowchart LR
  v["day kcal"] --> c1{"> maintenance + band?"}
  c1 -->|yes| red["red"]
  c1 -->|no| c2{"> goal + band?"}
  c2 -->|yes| amber["amber"]
  c2 -->|no| green["green"]
```

`band` (เฉพาะวันเดียว, ค่าเฉลี่ยไม่มี band) = `clamp(deficit x 0.30, goal x 2%, goal x 5%)` โดย deficit = maintenance − goal · protein: แดงเมื่อ < 75% ของเป้า · carbs/fat: แดงเมื่อ > 125%

## 10. Account dependency map — เปลี่ยนอะไรแล้วกระทบอะไร

```mermaid
flowchart LR
  ghacc["GitHub account / repo"] --> cfproj["Cloudflare Pages project<br/>(Git connection)"]
  cfproj --> url["Public URL *.pages.dev"]
  url --> pwa["Installed PWA on phone<br/>(origin-bound: reinstall + re-login)"]
  url --> sbauth["Supabase Auth Site URL"]

  sbproj["Supabase project<br/>(URL + anon key)"] --> envc["Cloudflare env<br/>VITE_SUPABASE_URL / ANON_KEY"]
  sbproj --> envl["local .env"]
  sbproj --> ka["keepalive.yml<br/>(URL + anon key hard-coded)"]
  sbproj --> data[("All user data<br/>+ auth users")]

  secret["KEY_ENCRYPTION_SECRET"] --> envc2["Cloudflare secret"]
  secret --> envl
  secret --> stored["Every stored Gemini key<br/>(undecryptable if secret changes)"]

  google["Google account(s)<br/>AI Studio keys"] --> stored
```

รายละเอียดขั้นตอนดูที่ [ACCOUNT_MIGRATION.md](ACCOUNT_MIGRATION.md)

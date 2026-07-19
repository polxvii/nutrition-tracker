# 🥗 Nutrition Tracker (Recomp) — โครงสร้างโปรเจคฉบับเต็ม

> **เป้าหมาย:** เพิ่มกล้าม + ลดไขมัน (Body Recomposition)
> **แพลตฟอร์ม:** PWA — ใช้บน iPhone ได้ + sync ทุก device ที่ login account เดียวกัน
> **ทำกับ:** Claude Code
> **เอกสารนี้ใช้ทำอะไร:** เปิดอ้างอิงตอนสั่ง Claude Code ให้ทำทีละ Stage

---

## 1. ภาพรวมสถาปัตยกรรม (Architecture)

```
┌─────────────────────────────────────────────────────────┐
│                    ทุก DEVICE ของคุณ                      │
│   iPhone (Safari→Add to Home Screen)  │  iPad  │  Mac/PC │
│                    ↓ login account เดียวกัน ↓             │
└───────────────────────────┬─────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │   FRONTEND (PWA)          │
              │   React + Vite            │
              │   Tailwind + Recharts     │
              │   + Service Worker        │  ← ทำให้เป็น PWA / offline
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │   BACKEND: Supabase       │
              │   • Postgres (ข้อมูล)     │  ← หัวใจของการ sync ทุก device
              │   • Auth (login)          │
              │   • Storage (รูปอาหาร)    │
              │   • Row-Level Security    │  ← ข้อมูลคุณเห็นแค่คุณ
              └─────────────┬─────────────┘
                            │
       ┌────────────────────┼────────────────────┐
       ▼                    ▼                     ▼
┌────────────┐    ┌──────────────────┐   ┌────────────────┐
│ Open Food  │    │ Serverless Func  │   │ USDA / INMU    │
│ Facts API  │    │ (Claude Vision)  │   │ (ฐานอาหาร)     │
│ (barcode)  │    │ วิเคราะห์รูป     │   │                │
└────────────┘    └──────────────────┘   └────────────────┘
```

**หัวใจสำคัญ:** ข้อมูลอยู่บน Supabase (cloud) → ทุก device ที่ login เข้า account เดียวกันเห็นข้อมูลเดียวกัน **sync อัตโนมัติ** ไม่ต้องส่งไฟล์หรือ export/import อะไรเลย นี่คือสิ่งที่คุณต้องการ

---

## 2. Tech Stack (สรุป)

| ชั้น | เทคโนโลยี | เหตุผล |
|---|---|---|
| Frontend | **React + Vite** | Claude Code ทำได้คล่อง เร็ว |
| Styling | **Tailwind CSS** | จัดหน้าตาเร็ว |
| กราฟ | **Recharts** | ทำ dashboard/เทรนด์สวย |
| PWA | **vite-plugin-pwa** | เปลี่ยนเว็บเป็นแอปติดหน้าจอ iPhone |
| Backend | **Supabase** | DB + Auth + Storage ครบ ฟรี tier ดี = ตัว sync |
| Barcode | **Open Food Facts API** | ฟรี ไม่ต้อง key สินค้า 4M+ รองรับไทย |
| อาหารทั่วไป | **USDA FoodData Central** | ฟรี ข้อมูลระดับแลบ |
| AI ถ่ายรูป | **Claude Sonnet Vision API** | วิเคราะห์รูปแม่นสุดในราคาคุ้ม (พระเอกอาหารไทย) |
| Barcode scan (กล้อง) | **@zxing/browser** | อ่าน barcode ผ่านกล้องใน browser |
| Deploy | **Vercel** | deploy ฟรี ปุ่มเดียว |

---

## 3. โครงสร้างโฟลเดอร์ (Project Structure)

```
nutrition-tracker/
├── public/
│   ├── manifest.json              # PWA manifest (ชื่อแอป, ไอคอน)
│   ├── icons/                     # ไอคอนแอป (192px, 512px)
│   └── robots.txt
│
├── src/
│   ├── main.jsx                   # entry point
│   ├── App.jsx                    # root + routing
│   │
│   ├── lib/
│   │   ├── supabase.js            # Supabase client + config
│   │   ├── auth.js                # login/logout/session
│   │   └── constants.js           # ค่าคงที่ (เป้า macro ฯลฯ)
│   │
│   ├── api/
│   │   ├── openFoodFacts.js       # ค้น barcode
│   │   ├── usda.js                # ค้นอาหารทั่วไป
│   │   └── visionAnalysis.js      # เรียก Claude Vision วิเคราะห์รูป (พระเอกอาหารไทย)
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── BottomNav.jsx      # แถบเมนูล่าง (มือถือ)
│   │   │   └── Header.jsx
│   │   ├── logging/
│   │   │   ├── FoodSearch.jsx     # ช่องค้นหาอาหาร
│   │   │   ├── BarcodeScanner.jsx # สแกน barcode ด้วยกล้อง
│   │   │   ├── PhotoLogger.jsx    # ถ่ายรูป→AI วิเคราะห์
│   │   │   ├── PhotoNoteInput.jsx # ช่องใส่โน้ตให้ AI แม่นขึ้น
│   │   │   ├── PortionEditor.jsx  # แก้ปริมาณ (สำคัญ! แก้จุดพลาดของ AI)
│   │   │   └── QuickAdd.jsx       # อาหารที่กินบ่อย / repeat เมื่อวาน
│   │   ├── profile/
│   │   │   ├── TDEECalculator.jsx # คำนวณ TDEE จากข้อมูลร่างกาย
│   │   │   ├── GoalSelector.jsx   # เลือกเป้า → ปรับ macro
│   │   │   └── MacroTargets.jsx   # แสดง/แก้เป้า macro
│   │   ├── dashboard/
│   │   │   ├── DailySummary.jsx   # สรุปวันนี้ (แคลอรี่/โปรตีน วง)
│   │   │   ├── MacroBar.jsx       # แถบ P/C/F
│   │   │   ├── WeightTrend.jsx    # กราฟน้ำหนัก smooth
│   │   │   ├── ProteinConsistency.jsx # ความสม่ำเสมอโปรตีน
│   │   │   ├── TDEEEstimate.jsx   # adaptive TDEE
│   │   │   └── RecompVerdict.jsx  # "on track ไหม?"
│   │   └── common/
│   │       ├── Card.jsx
│   │       └── Modal.jsx
│   │
│   ├── pages/
│   │   ├── Onboarding.jsx         # กรอกข้อมูลร่างกาย + เลือกเป้า (ครั้งแรก)
│   │   ├── Today.jsx              # หน้าหลัก log วันนี้
│   │   ├── Dashboard.jsx          # หน้า analytics
│   │   ├── Diary.jsx              # ประวัติย้อนหลัง
│   │   ├── Weight.jsx             # บันทึกน้ำหนัก
│   │   ├── Settings.jsx           # แก้ข้อมูลร่างกาย/เป้า, โปรไฟล์
│   │   └── Login.jsx
│   │
│   ├── hooks/
│   │   ├── useAuth.js
│   │   ├── useFoodLog.js          # ดึง/บันทึก log
│   │   ├── useWeightTrend.js      # คำนวณเทรนด์ smooth
│   │   └── useTDEE.js             # คำนวณ adaptive TDEE
│   │
│   └── utils/
│       ├── nutrition.js          # คำนวณ macro, เป้าหมาย
│       ├── trendMath.js          # EMA, moving average
│       └── dateHelpers.js
│
├── supabase/
│   └── schema.sql                 # โครงสร้างตาราง DB
│
├── .env.local                     # keys (ห้าม commit!)
├── vite.config.js                 # + PWA plugin
├── tailwind.config.js
└── package.json
```

---

## 4. โครงสร้างฐานข้อมูล (Database Schema)

```sql
-- โปรไฟล์ผู้ใช้ + เป้าหมาย (ใช้คำนวณ TDEE + macro อัตโนมัติ)
profiles
  id, email,
  -- ข้อมูลร่างกาย (ใช้คำนวณ TDEE)
  weight_kg, height_cm, age, sex,
  body_fat_pct,              -- ถ้ากรอก → ใช้สูตร Katch-McArdle แม่นกว่า
  activity_level,            -- sedentary/light/moderate/active/very_active
  -- เป้าหมาย (ให้เลือก → ปรับ calorie/macro ให้)
  goal_type,                 -- recomp/cut/bulk/maintain
  goal_rate,                 -- ช้า/กลาง/เร็ว (% น้ำหนัก/สัปดาห์)
  -- ค่าที่คำนวณได้ (เก็บไว้โชว์)
  bmr, tdee_formula,         -- BMR + TDEE จากสูตร (ค่าตั้งต้น)
  goal_calories, goal_protein_g, goal_carbs_g, goal_fat_g, goal_fiber_g,
  use_adaptive_tdee,         -- true = ใช้ค่าจากข้อมูลจริง (หลัง ~2 สัปดาห์)
  created_at, updated_at

-- รายการอาหารที่ล็อก
food_logs
  id, user_id, logged_at, meal_type (เช้า/กลางวัน/เย็น/ว่าง),
  food_name, source (barcode/usda/thai/photo/manual),
  grams, calories, protein_g, carbs_g, fat_g, fiber_g,
  photo_url,                 -- ถ้า log จากรูป
  user_note,                 -- โน้ตที่ผู้ใช้ระบุตอนถ่ายรูป (ช่วย AI แม่นขึ้น)
  ai_confidence,             -- ระดับความมั่นใจของ AI (low/medium/high)
  created_at

-- อาหารที่กินบ่อย (cache ให้ log เร็ว — รวมมื้อไทยที่ log จากรูปแล้ว)
frequent_foods
  id, user_id, food_name, default_grams, calories,
  protein_g, carbs_g, fat_g, times_used

-- บันทึกน้ำหนัก
weight_logs
  id, user_id, logged_date, weight_kg, created_at
```

> **Row-Level Security (RLS):** ทุกตารางเปิด RLS → user เห็นแค่ข้อมูลตัวเอง แม้อยู่ DB เดียวกัน

---

## 5. ภาพรวมทุก Feature (Feature Map)

### 📝 กลุ่ม Logging (บันทึกอาหาร)
| Feature | ทำอะไร | Stage |
|---|---|---|
| Manual entry | พิมพ์อาหาร + macro เอง | 1 |
| Frequent foods | อาหารกินบ่อย กดครั้งเดียว | 1 |
| Repeat yesterday | ก็อปมื้อเมื่อวาน | 1 |
| **AI Photo log** | **ถ่ายรูป→AI ประเมิน macro (พระเอกอาหารไทย/ตามสั่ง)** | 2 |
| **Photo note** | **ระบุโน้ตเพิ่ม (เช่น "ผัดน้ำมันเยอะ") ให้ AI แม่นขึ้น** | 2 |
| Portion editor | แก้ปริมาณ (แก้จุดพลาด AI) | 2 |
| Food search (USDA) | ค้นอาหารทั่วไป | 3 |
| Barcode scan | สแกนกล่องสินค้า (ของกินเล่นแพ็กเกจ) | 3 |

### 📊 กลุ่ม Dashboard & Analytics (หัวใจของโปรเจค)
| Feature | ทำอะไร | Stage |
|---|---|---|
| Daily summary | แคลอรี่/โปรตีนวันนี้ vs เป้า | 1 |
| Macro breakdown | สัดส่วน P/C/F | 1 |
| Weekly rolling average | ค่าเฉลี่ย 7 วัน | 4 |
| **Weight trend (smooth)** | **กราฟน้ำหนัก EMA ไม่ใช่ดิบ** | 4 |
| **Protein consistency** | **% วันที่ถึงเป้าโปรตีน** | 4 |
| **Adaptive TDEE** | **คำนวณเผาผลาญจริงจากข้อมูล** | 4 |
| **Recomp verdict** | **บอก "on track ไหม" อัตโนมัติ** | 4 |
| Intake↔weight correlation | ความสัมพันธ์กิน↔น้ำหนัก | 4 |
| Micronutrients (option) | วิตามิน/แร่ธาตุ | 5 |

### ⚙️ กลุ่ม Core / System
| Feature | ทำอะไร | Stage |
|---|---|---|
| Login/Auth | Supabase auth | 1 |
| Multi-device sync | ข้อมูล sync ทุกเครื่อง | 1 (มาฟรีกับ Supabase) |
| PWA install | ติดหน้าจอ iPhone | 1 |
| **TDEE calculator** | **คำนวณจากอายุ/น้ำหนัก/ส่วนสูง/เพศ/activity** | 1 |
| **Goal selector** | **เลือกเป้า (recomp/cut/bulk/maintain) → ปรับ macro** | 1 |
| **Auto macro targets** | **คำนวณโปรตีน/คาร์บ/ไขมันจากเป้า+ร่างกาย** | 1 |
| Offline support | ใช้ได้ตอนเน็ตหลุด | 5 |
| Weekly digest | สรุปรายสัปดาห์ | 5 |

---

## 6. แผนทำเป็น Stage (Roadmap)

### 🏗️ Stage 1 — MVP (สุดสัปดาห์แรก)
**เป้า:** log ได้ทุกวัน + sync ทุก device + ติดหน้าจอ iPhone
- Setup React + Vite + Tailwind + PWA plugin
- ต่อ Supabase (auth + ตาราง profiles, food_logs, weight_logs)
- หน้า Login
- **หน้า Onboarding: กรอกอายุ/น้ำหนัก/ส่วนสูง/เพศ/activity → คำนวณ TDEE + BMR ให้**
- **เลือก Goal (recomp/cut/bulk/maintain) + ความเร็ว → ระบบปรับ calorie & macro ให้อัตโนมัติ**
- หน้า Today: manual entry + frequent foods + repeat yesterday
- หน้า Settings: แก้ข้อมูลร่างกาย/เป้า แล้วคำนวณใหม่
- Daily summary (แคลอรี่/โปรตีน vs เป้า)
- Deploy Vercel + ทดสอบ Add to Home Screen บน iPhone

**✅ ผ่านเมื่อ:** กรอกข้อมูลแล้วได้เป้า macro อัตโนมัติ + log ได้ทุกวันบน iPhone + เปิด device อื่นเห็นข้อมูลเดียวกัน

### 📸 Stage 2 — AI ถ่ายรูป (พระเอกสำหรับอาหารไทย/ตามสั่ง)
**เป้า:** ถ่ายรูปแล้วได้ค่าประมาณในระยะ ~20% — รับหน้าที่อาหารไทยแทนตาราง manual
- Serverless function เรียก Claude Vision (key อยู่ server ห้ามอยู่ client!)
- Prompt แบบแยกส่วนอาหาร + ขอ gram ต่อชิ้น + ใช้ของอ้างอิงกะขนาด + เข้าใจอาหารไทย
- PhotoLogger UI: ถ่าย→อัปโหลด Supabase Storage→วิเคราะห์
- **ช่องใส่โน้ตก่อนวิเคราะห์** (เช่น "ข้าว 2 ทัพพี", "ผัดน้ำมันเยอะ", "ไก่ 200g") → ส่งเข้า prompt ให้ AI แม่นขึ้นมาก
- Portion editor: ให้แก้ปริมาณแล้วคำนวณใหม่
- แสดงระดับความมั่นใจของ AI (low/medium/high)
- log แล้วเก็บเข้า frequent_foods อัตโนมัติ → มื้อไทยที่กินบ่อยครั้งต่อไปกดครั้งเดียว

**✅ ผ่านเมื่อ:** ถ่ายกะเพรา/ก๋วยเตี๋ยว + ใส่โน้ต ได้ค่าใกล้เคียงหลังแก้ปริมาณ

### 🔍 Stage 3 — Search & Barcode (เสริม)
**เป้า:** เพิ่มช่องทาง log ของที่ไม่เหมาะถ่ายรูป (ของกินเล่นแพ็กเกจ, วัตถุดิบ)
- ต่อ Open Food Facts (barcode) — เหมาะกับของกินเล่น/สินค้ามีบาร์โค้ด
- Barcode scanner ด้วยกล้อง (@zxing/browser)
- ต่อ USDA search — อาหาร/วัตถุดิบทั่วไป
- Food search UI รวมทุกแหล่ง

**✅ ผ่านเมื่อ:** สแกน barcode ของกินเล่นได้ + ค้นวัตถุดิบได้ไว

> **หมายเหตุ:** ตัดตาราง Thai food แบบ manual ออกแล้ว เพราะค่าที่กรอกเองก็เป็นค่าประมาณ ไม่ได้แม่นกว่า AI ถ่ายรูป (Stage 2 รับหน้าที่นี้แทน) ถ้าอนาคตอยากได้ค่าแลบจริง ค่อยติดต่อ INMU ขอชุดข้อมูล Thai FCD มา seed ทีหลังได้

### 📈 Stage 4 — Analytics (หัวใจ! เหตุผลที่ทำโปรเจคนี้)
**เป้า:** dashboard วิเคราะห์ภาพรวมได้จริง
- Weight trend แบบ smooth (EMA 20 วัน)
- Rolling average 7 วัน (แคลอรี่ + โปรตีน)
- Protein consistency %
- **Adaptive TDEE:** `เผาผลาญ = แคลอรี่เฉลี่ย − (น้ำหนักเทรนด์เปลี่ยน × 7700 ÷ วัน)`
- Recomp verdict อัตโนมัติจาก slope เทรนด์
- Intake↔weight correlation

**✅ ผ่านเมื่อ:** ค่า TDEE นิ่ง + dashboard บอกได้ว่า on track ไหม

### 🎯 Stage 5 — ขัดเกลา + ตัดสินใจ
- Offline support (service worker cache)
- Weekly digest
- Micronutrients (ถ้าอยากได้ ใช้ USDA)
- **ตัดสินใจ:** ชอบดูแลต่อ = ไปต่อ / ขี้เกียจ = ใช้ MacroFactor เสริมเฉพาะ adaptive targeting

---

## 7. Logic การคำนวณ TDEE + Macro (พร้อมนำไปโค้ด)

### ขั้นที่ 1: คำนวณ BMR (อัตราเผาผลาญพื้นฐาน)
```
ถ้ามี body_fat_pct → ใช้ Katch-McArdle (แม่นกว่า):
  LBM = weight_kg × (1 − body_fat_pct/100)
  BMR = 370 + (21.6 × LBM)

ถ้าไม่มี → ใช้ Mifflin-St Jeor:
  ชาย:  BMR = (10 × weight_kg) + (6.25 × height_cm) − (5 × age) + 5
  หญิง: BMR = (10 × weight_kg) + (6.25 × height_cm) − (5 × age) − 161
```

### ขั้นที่ 2: คูณ Activity Factor → ได้ TDEE (maintenance)
```
sedentary    (นั่งทำงาน ไม่ออกกำลัง)      → BMR × 1.2
light        (ออกกำลัง 1–3 วัน/สัปดาห์)    → BMR × 1.375
moderate     (ออกกำลัง 3–5 วัน/สัปดาห์)    → BMR × 1.55
active       (ออกกำลัง 6–7 วัน/สัปดาห์)    → BMR × 1.725
very_active  (ออกหนักมาก/งานใช้แรง)        → BMR × 1.9
```

### ขั้นที่ 3: ปรับตาม Goal → ได้ calorie เป้าหมาย
```
maintain  → TDEE เท่าเดิม
recomp    → TDEE − 0 ถึง −300 (แนะนำ −200)   ← เป้าหลักของคุณ
cut       → TDEE − (15–25%)   [ช้า −15% / กลาง −20% / เร็ว −25%]
bulk      → TDEE + (5–15%)    [ช้า +5% / กลาง +10% / เร็ว +15%]

⚠️ กันไว้: อย่าให้ calorie เป้าต่ำกว่า BMR
```

### ขั้นที่ 4: แตกเป็น Macro
```
1. โปรตีนก่อน:
   recomp/cut → 2.0–2.2 g/kg น้ำหนักตัว (ดัน 2.2 ตอนคุมแคลอรี่)
   bulk       → 1.6–2.0 g/kg
   maintain   → 1.6–1.8 g/kg
   → protein_cal = protein_g × 4

2. ไขมันรอง:
   fat_g = weight_kg × 0.8  (≈0.35 g/lb) หรือ 25–30% ของ calorie
   อย่าต่ำกว่า 25% ของแคลอรี่ (ปกป้องฮอร์โมน)
   → fat_cal = fat_g × 9

3. คาร์บที่เหลือ:
   carbs_g = (goal_calories − protein_cal − fat_cal) / 4

4. ไฟเบอร์:
   fiber_g = goal_calories / 1000 × 14   (≈25–35g/วัน)
```

### ขั้นที่ 5: หลัง ~2 สัปดาห์ → สลับเป็น Adaptive TDEE
```
พอมีข้อมูลจริงพอ (Stage 4) เลิกใช้สูตร แล้วใช้ค่าจริง:
  adaptive_TDEE = แคลอรี่เฉลี่ยที่กิน − (น้ำหนักเทรนด์เปลี่ยน_kg × 7700 / จำนวนวัน)
→ แล้วคำนวณ macro ใหม่จากค่านี้ (แม่นกว่าสูตรมาก)
```

> **UX:** หน้า Onboarding พาทำ 5 ขั้นนี้ทีละ step (กรอกข้อมูล → เลือกเป้า → โชว์ผล macro ที่คำนวณให้ → ยืนยัน) ถ้าน้ำหนัก/เป้าเปลี่ยน ไปแก้ใน Settings แล้วคำนวณใหม่ได้

---

## 8. เรื่องสำคัญ / ข้อควรระวัง (อ่านก่อนเริ่ม)

🔴 **API key ต้องอยู่ server เท่านั้น** — Claude Vision key, ห้ามใส่ในโค้ด frontend เด็ดขาด (คนอื่นเห็นได้) → ใช้ Vercel serverless function หรือ Supabase Edge Function

🟡 **AI ถ่ายรูปไม่แม่น 100%** — พลาดได้ ~35% โดยเฉพาะการกะปริมาณ → ต้องมี portion editor + ช่องโน้ตให้แก้เสมอ อย่าใช้เป็นตัวเลขตายตัว (โน้ตช่วยได้เยอะ เช่นระบุปริมาณข้าว/น้ำมัน)

🟡 **Open Food Facts เป็น crowd-sourced** — ข้อมูลบางตัวอาจไม่ครบ/ผิด → cache ของที่ log แล้วไว้ใช้ซ้ำ

🟡 **ตาชั่งโกหกรายวัน** — น้ำหนักเด้ง 2–5 กก. จากน้ำ/อาหารในท้อง → dashboard ต้องโชว์เทรนด์ smooth ไม่ใช่ค่าดิบ ย้ำเรื่องนี้กับตัวเองด้วย

🟡 **TDEE จากสูตรเป็นแค่จุดเริ่มต้น** — พลาดได้ ±300 kcal ในหลายคน → อย่ายึดติด ให้ adaptive TDEE (Stage 4) ปรับตามข้อมูลจริง แล้วมันจะแม่นขึ้นเรื่อยๆ

🟢 **iPhone PWA ข้อจำกัด** — notification บน iOS ทำได้จำกัดกว่า native, barcode ผ่านกล้อง browser ใช้ได้แต่ไม่ลื่นเท่าแอป native — รับได้สำหรับ personal use

🟢 **INMU data** — ฟรีสำหรับใช้ส่วนตัว (non-commercial) แต่ต้องอ้างอิงแหล่ง ถ้าจะทำเชิงพาณิชย์ต้องขออนุญาต


---

## 9. คำสั่งเริ่มต้นสำหรับ Claude Code (Stage 1)

เอาไปพิมพ์บอก Claude Code ได้เลย:

```
สร้างโปรเจค PWA nutrition tracker ด้วย React + Vite + Tailwind
- ตั้งค่า vite-plugin-pwa ให้ติดหน้าจอ iPhone ได้
- ต่อ Supabase สำหรับ auth + database
- สร้างตาราง profiles, food_logs, weight_logs พร้อม Row-Level Security
  (profiles ต้องมี field: อายุ, น้ำหนัก, ส่วนสูง, เพศ, body_fat_pct, activity_level,
   goal_type, goal_rate, bmr, tdee, goal_calories/protein/carbs/fat/fiber)
- หน้า Login (Supabase auth)
- หน้า Onboarding: กรอกอายุ/น้ำหนัก/ส่วนสูง/เพศ/activity → คำนวณ BMR + TDEE
  (Mifflin-St Jeor หรือ Katch-McArdle ถ้ามี body fat) → เลือกเป้าหมาย
  (recomp/cut/bulk/maintain) + ความเร็ว → คำนวณ calorie & macro อัตโนมัติ → โชว์ผลให้ยืนยัน
- หน้า Today: บันทึกอาหารแบบ manual + รายการอาหารกินบ่อย + ปุ่ม repeat เมื่อวาน
- หน้า Settings: แก้ข้อมูลร่างกาย/เป้าหมาย แล้วคำนวณ macro ใหม่
- Daily summary แสดงแคลอรี่และโปรตีนวันนี้เทียบกับเป้า (วงกลม progress)
- Bottom navigation สำหรับมือถือ
ให้เริ่มจาก setup โปรเจค + Supabase schema + logic คำนวณ TDEE/macro ก่อน
(สูตรคำนวณดูจากส่วนที่ 7 ของ blueprint)
```

---

*เอกสารนี้เป็น blueprint — ทำทีละ Stage ไม่ต้องรีบทำครบทีเดียว เริ่ม Stage 1 ให้ใช้งานได้จริงก่อน แล้วค่อยต่อยอด*

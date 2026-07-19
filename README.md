# 🥗 Nutrition Tracker (Stage 1 — MVP)

PWA nutrition tracker สำหรับ body recomposition (เพิ่มกล้าม + ลดไขมัน)
ติดหน้าจอ iPhone ได้ และ sync ทุก device ผ่าน Supabase

**Stack:** React + Vite + Tailwind CSS v4 + vite-plugin-pwa + Supabase + Recharts

---

## ✅ สิ่งที่ทำใน Stage 1

- Setup React + Vite + Tailwind + PWA (Add to Home Screen บน iPhone)
- Supabase auth (email/password) + 4 ตาราง + Row-Level Security
- คำนวณ BMR / TDEE / เป้าแคลอรี่ / macro อัตโนมัติ
- หน้า Login, Onboarding, Today, Weight, Settings + bottom navigation

---

## 🚀 เริ่มใช้งาน (local)

### 1. ติดตั้ง dependencies

```bash
npm install
```

### 2. ตั้งค่า Supabase

1. สร้างโปรเจคที่ [supabase.com](https://supabase.com) (ฟรี)
2. เปิด **SQL Editor → New query** แล้ววาง/รันไฟล์ [`supabase/schema.sql`](supabase/schema.sql) ทั้งไฟล์
   → จะได้ตาราง `profiles`, `food_logs`, `frequent_foods`, `weight_logs` พร้อม RLS
3. ไปที่ **Project Settings → API** คัดลอก **Project URL** และ **anon public key**
4. คัดลอกไฟล์ env แล้วเติมค่า:

```bash
cp .env.example .env
```

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhb....
```

> **แนะนำ:** ตอนพัฒนา ให้ปิด email confirmation ก่อน
> Supabase → **Authentication → Sign In / Providers → Email** → ปิด "Confirm email"
> (จะได้สมัครแล้วเข้าใช้ได้เลยโดยไม่ต้องยืนยันอีเมล)

### 3. รัน dev server

```bash
npm run dev
```

เปิด http://localhost:5173 → สมัครสมาชิก → กรอก Onboarding → เริ่ม log ได้เลย

---

## 📱 ทดสอบ PWA / ติดหน้าจอ iPhone

Service worker จะทำงานเฉพาะตอน **build** (ปิดใน dev เพื่อไม่ให้ cache กวน):

```bash
npm run build
npm run preview
```

บน iPhone (Safari) เปิด URL → ปุ่ม **Share** → **Add to Home Screen**
> การติดหน้าจอจริงบน iPhone ต้องเสิร์ฟผ่าน **HTTPS** — ตอน deploy (Vercel ฯลฯ) จะได้ HTTPS อัตโนมัติ

---

## 🧮 สูตรคำนวณ (ดู `src/lib/nutrition.js`)

| ขั้น | สูตร |
|---|---|
| BMR (มี body fat) | Katch-McArdle: `LBM = w×(1−bf/100)`, `BMR = 370 + 21.6×LBM` |
| BMR (ไม่มี) | Mifflin-St Jeor |
| TDEE | `BMR × activity factor` (1.2 / 1.375 / 1.55 / 1.725 / 1.9) |
| เป้าแคลอรี่ | recomp `−200` · cut `−15/20/25%` · bulk `+5/10/15%` · maintain เท่าเดิม (ไม่ต่ำกว่า BMR) |
| โปรตีน | recomp/cut 2.2 · bulk 1.8 · maintain 1.7 g/kg |
| ไขมัน | `w×0.8 g` (ไม่ต่ำกว่า 25% ของแคลอรี่) |
| คาร์บ | ส่วนที่เหลือ |

---

## 📁 โครงสร้าง

```
src/
  lib/         supabase client, nutrition math, date helpers
  contexts/    AuthContext (session + profile)
  components/  ui, BottomNav, ProgressRing, MacroBar, ProfileFields, ...
  pages/       Login, Onboarding, Today, Weight, Settings
supabase/
  schema.sql   ← รันใน Supabase SQL Editor
```

## 🔜 ถัดไป (Stage 2+)
AI ถ่ายรูปวิเคราะห์อาหาร, barcode/USDA search, analytics dashboard (adaptive TDEE, weight trend)
ดูรายละเอียดใน `nutrition-tracker-blueprint.md`

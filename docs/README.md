# docs/ — เอกสารโปรเจค Nutrition Tracker

| ไฟล์ | เนื้อหา |
|---|---|
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | ทุกอย่างของโปรเจค: stack, บริการ/account, env vars, โครงสร้างไฟล์, DB, feature ทุกหน้า, logic คำนวณ, workflow, gotchas, backlog |
| [ARCHITECTURE.md](ARCHITECTURE.md) | diagram 10 แบบ (Mermaid): system, deploy, frontend map, AI sequence, add-key, food search, ER, check-in, colour tiers, account dependency |
| [architecture.html](architecture.html) | diagram ชุดเดียวกัน เปิดใน browser ได้เลย (สร้างอัตโนมัติ — อย่าแก้ตรง) |
| [ACCOUNT_MIGRATION.md](ACCOUNT_MIGRATION.md) | ขั้นตอนย้าย GitHub / Cloudflare / Supabase / Gemini / Claude account + checklist ตรวจ + troubleshooting |
| [build-diagrams.mjs](build-diagrams.mjs) | สคริปต์สร้าง `architecture.html` จาก `ARCHITECTURE.md` |

## วิธีดู diagram
- บน GitHub: เปิด `ARCHITECTURE.md` — render ให้เอง
- ในเครื่อง: ดับเบิลคลิก `architecture.html` (ต้องต่อเน็ต เพราะโหลด Mermaid จาก CDN)
- แก้/ลอง diagram: copy โค้ดไปวางที่ <https://mermaid.live>

## กติกาการ keep update (ทำทุกครั้งที่ ship feature / เปลี่ยนโครงสร้าง)

| เปลี่ยนอะไร | อัปเดตที่ |
|---|---|
| เพิ่ม/ลบ/เปลี่ยน feature ที่ผู้ใช้เห็น | `PROJECT_OVERVIEW.md` §6 |
| เปลี่ยนสูตร / threshold / logic คำนวณ | `PROJECT_OVERVIEW.md` §7 (+ diagram §8–9 ถ้าเกี่ยว) |
| ตาราง/คอลัมน์ใหม่ใน `schema.sql` | `PROJECT_OVERVIEW.md` §5 + ER diagram (`ARCHITECTURE.md` §7) |
| env var ใหม่ / บริการภายนอกใหม่ | `PROJECT_OVERVIEW.md` §3 + `.env.example` + `ACCOUNT_MIGRATION.md` + diagram §1, §10 |
| ไฟล์/โฟลเดอร์ใหม่ที่สำคัญ, route ใหม่ | `PROJECT_OVERVIEW.md` §4 + diagram §3 |
| เจอ gotcha ใหม่ | `PROJECT_OVERVIEW.md` §9 |
| แก้ `ARCHITECTURE.md` | รัน `node docs/build-diagrams.mjs` แล้ว commit html ด้วย |

แล้วแก้บรรทัด "อัปเดตล่าสุด" บนหัวไฟล์ที่แตะ

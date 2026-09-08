# Implementation Plan: Multiplexing SSE Multi-Session

> Berdasarkan mekanisme yang dijelaskan di `.docs/sse-multi-session-streaming.md`,
> disesuaikan dengan arsitektur aktual proyek ini (agent LangGraph + backend relay + frontend React).
>
> **Revisi audit (v2):** menambahkan fix untuk 12 temuan review — lihat
> [Amendemen Audit](#amendemen-audit) di akhir dokumen. Semua fix yang bersifat
> correctness sudah terintegrasi langsung di langkah fase di bawah.

## Arsitektur target

```
[LangGraph run A] ─┐
[LangGraph run B] ─┼─► StreamBus (global, in-memory) ──► GET /sessions/stream ──► 1 SSE per client
[LangGraph run C] ─┘        (envelope: sessionId + seq)        (firehose)
```

- Run = detached task yang mem-publish event ke bus.
- Koneksi = pasif relay. Run tidak peduli ada penonton atau tidak.
- Pindah session = operasi state lokal di frontend, bukan operasi jaringan.

## Kondisi saat ini (masalah)

| Lapisan | Sekarang | Masalah |
|---|---|---|
| `backend/.../sessions/service.ts` | `POST /sessions/:id/stream` → `runs.create` + relay `joinStream` | 1 koneksi = 1 run. `signal` abort → `runs.cancel()` → run mati saat koneksi putus |
| `backend/.../sessions/route.ts` | stream ditulis langsung ke response | Envelope tanpa `sessionId`/`seq` |
| `frontend/.../chat/index.tsx` | 1 `messages` state, `isStreaming` guard global | Pindah session saat streaming → stream lama tetap menulis ke state baru (campur aduk). Tidak bisa kirim paralel antar session |

## Kontrak API baru

| Endpoint | Method | Perubahan |
|---|---|---|
| `/api/sessions/:id/stream` | POST | **Berubah**: tidak lagi return SSE. Preflight + create run → return `202 { runId, status }` |
| `/api/sessions/stream?workspaceId=` | GET | **Baru**: SSE global firehose, relay semua event bus. Filter workspaceId opsional (cegah noise lintas-workspace) |
| `/api/sessions/:id/cancel` | POST | **Baru**: `runs.cancel` eksplisit (pengganti AbortController) |
| `/api/sessions/:id/messages` | GET | Tidak berubah (backfill history) |
| `/api/sessions/:id` | GET | Tidak berubah (reconnect sync status) |

Envelope untuk semua event:

```ts
type StreamEvent = {
  sessionId: string;   // identitas session asal
  runId: string;       // identitas run — dipakai bareng seq untuk dedup
  seq: number;         // nomor urut PER-RUN (reset ke 0 tiap run baru)
  type: string;        // "messages" | "updates" | "error" | "done" | "cancelled" | ...
  data: unknown;
  ts: number;          // timestamp untuk observability
};
```

> **Keputusan `seq` per-run (bukan per-session):** `assertThreadIdle` menjamin
> hanya satu run aktif per session, jadi seq per-session ≡ seq per-run. Seq
> in-memory yang reset saat restart backend (temuan audit #1) tidak lagi
> masalah karena overlap saat reconnect ditangani oleh **dedup berbasis konten
> pesan** (history dari checkpointer tidak punya seq, jadi seq tidak bisa jadi
> dasar dedup backfill-vs-live). Lihat Fase 2c.

---

## Fase 1 — Backend (independen)

### 1a. `backend/src/global/stream-bus.ts` — BARU

- `class StreamBus` (EventEmitter singleton, export `streamBus` instance).
- `publish(sessionId, runId, type, data)` → inject `seq` per-run (Map<runId, number>) + `ts`.
- `ConnectionMux`: `attach(controller)` / `detach()` — firehose awal, terima semua session.
- **Bounded queue per controller** (fix audit #5): antrian per-koneksi dengan cap
  (mis. 1000 event). Saat penuh → buang event tertua (drop-oldest). Cegah satu
  socket lambat menggembungkan memori dan memblokir publish ke koneksi lain.
- Cleanup listener saat koneksi abort.

### 1b. `backend/src/modules/sessions/service.ts` — REFACTOR

- **Hapus** `streamMessage` + `streamRun` (generator yang terikat koneksi + `onAbort → cancel`).
- **Mutex per-thread** (fix audit #3): Map<threadId, Promise> lock di sekitar
  `assertThreadIdle` + `runs.create` — hilangkan race check-then-act (TOCTOU).
  Lapisan kedua tetap `isThreadBusy` (422 dari LangGraph) sebagai jaring pengaman.
- **Baru** `startRun(id, message, configDir, opts)`:
  - Preflight: `getOrThrow` → `resolveAgentRuntimeConfig` → mutex lock →
    `assertThreadIdle` → `runs.create` + `setRunId`.
  - **Detach**: jalankan `consumeRunToBus(...)` dengan `.catch()` eksplisit
    (fix audit #2) — lihat di bawah — lalu return `{ runId }`.
- **Baru** `consumeRunToBus(childThreadId, runId, record)`:
  - `joinStream` dalam `try/catch` (fix audit #9):
    - Loop normal → tiap part `streamBus.publish(record.id, runId, part.event, part.data)`.
    - `error` event dari LangGraph → publish envelope `error` + `repo.setError`.
    - Throw karena `runs.cancel` (dari endpoint cancel) → publish envelope
      `cancelled` + `repo.setStatus("cancelled")` — **jangan** biarkan error
      mentah lolos ke unhandled rejection.
    - Throw lain → publish envelope `error` + `repo.setError`. **Selalu** ada
      envelope terminal — frontend tidak boleh menggantung di "streaming".
  - Selesai normal → `await repo.setResult(...)` **DULU, baru** publish `done`
    (fix audit #4: urutan await dipertegas — client tidak boleh lihat `done`
    sebelum result terpersist).
- **Baru** `cancelRun(id)`: `runs.cancel` + `setStatus("cancelled")`.
  Run loop di `consumeRunToBus` akan menangkap throw-nya dan publish `cancelled`.

### 1c. `backend/src/modules/sessions/route.ts` — REFACTOR

- `streamRouteDef`: return JSON `{ runId, status: "running" }` (202). Error mapping 404/409/400 tetap.
- **Baru** `GET /sessions/stream`: `ReadableStream` + mux attach/detach, relay `streamBus`.
  - **Heartbeat** (fix audit #6): kirim `: keepalive\n\n` tiap 15 detik —
    cegah idle-timeout reverse proxy (Caddy/nginx) memutus SSE.
  - Filter `?workspaceId=` — mux hanya relay event dengan `workspaceId` cocok
    (perlu workspaceId di envelope atau lookup session). Tanpa param = firehose semua.
- **Baru** `POST /sessions/:id/cancel`: route handler.

### 1d. `backend/src/modules/sessions/schema.ts` — minor

- Tambah schema untuk cancel bila perlu (sebagian besar cukup `SessionIdInput`).
- `GET /sessions/stream` → query param `workspaceId` opsional.

### Verifikasi Fase 1

- `bun test` backend tetap hijau (update test yang rusak).
- **Test integrasi firehose** (fix audit — ditambahkan di sequencing):
  2 koneksi SSE ke `/sessions/stream` + 2 POST stream → kedua koneksi menerima
  event dari kedua session; event ber-`seq` monotonik per run; `done` selalu
  muncul setelah result terpersist (cek DB).
- Test cancel: cancel di tengah run → koneksi terima envelope `cancelled`,
  status DB `cancelled`, tidak ada unhandled rejection.
- Manual: buka 2 tab, matikan satu tab di tengah streaming → run session itu
  tetap selesai di bus (koneksi lain tetap lihat `done`).
- `bun run openapi:dump` → regen frontend client.

---

## Fase 2 — Frontend (kontrak Fase 1 fixed)

### 2a. `frontend/src/lib/chat-types.ts` — minor

- Tambah tipe `StreamEvent` (envelope: `sessionId`, `runId`, `seq`, `type`, `data`, `ts`).
- **Catatan sinkronisasi** (fix audit #10): tipe ini hand-maintained di `src/lib/`
  (sesuai aturan AGENTS.md — SSE wire format tidak tertangkap OpenAPI).
  Simpan salinan konsisten dengan `stream-bus.ts`; verifikasi manual saat Fase 1 selesai.

### 2b. `frontend/src/lib/stream.ts` — REFACTOR

- `startRun(baseUrl, sessionId, body)` → POST stream → `{ runId }`.
- `cancelRun(baseUrl, sessionId)` → POST cancel.
- `connectStream(baseUrl, onEvent, signal)` → GET `/sessions/stream`, parse SSE →
  panggil `onEvent(StreamEvent)`.
- **Hapus** `streamChatMessage`.

### 2c. `frontend/src/store/chat-session-store.ts` — BARU

```ts
type SessionState = {
  messages: ChatMessage[];
  lastSeqByRun: Map<string, number>;  // dedup per runId
  status: "idle" | "streaming" | "error";
  activeRunId?: string;
};
// Map<sessionId, SessionState> + reducer
// applyEvent: dedup by (runId, seq) — event.seq <= lastSeqByRun.get(runId) → skip
```

- **Dedup backfill-vs-live** (fix audit #8): overlap antara history
  `fetchMessages` dan live event ditangani **dedup konten** — saat append pesan
  AI dari history, cek pesan terakhir store; jika konten sama / superset, skip
  atau merge. `seq` hanya untuk dedup dalam satu run (reconnect mid-run).
- `lastSeqByRun` per-session opsional di-persist `localStorage` — low priority,
  backfill + konten-dedup sudah menutupi mayoritas kasus.

### 2d. `frontend/src/components/stream-provider.tsx` — BARU, mount di `__root.tsx`

- Buka 1 koneksi global sekali per lifetime (bukan per route).
- `onEvent` → route ke store by `sessionId`.
- **Reconnect dengan exponential backoff** (fix audit #11):
  `1s → 2s → 4s → ... → cap 30s` + jitter acak ±20%. Hindari retry-storm ke backend.
- **Lazy connect** (fix audit #12): koneksi dibuka hanya saat session aktif
  dibutuhkan / workspace terpilih — backend saat ini tanpa auth (hanya CORS),
  jadi jangan buka firehose sebelum ada kebutuhan nyata.

### 2e. `frontend/src/routes/u/chat/index.tsx` — REFACTOR

- Ganti `messages` state tunggal → baca store per `sessionId`.
- Submit → `startRun` (bukan stream fetch).
- Stop → `cancelRun` (bukan AbortController).
- `isStreaming` jadi per-session (dari store), hapus guard global.
- Pindah session = ganti `sessionId` → baca store lokal, tanpa buka/tutup koneksi.

### Verifikasi Fase 2

- Manual E2E: 2 session paralel streaming, switch tengah jalan → keduanya jalan, tidak campur aduk.
- Reload/reconnect → backfill + resume tanpa duplikat.
- Stop di session A tidak mengganggu run session B.
- Simulasi idle >60s (atau kill koneksi manual) → heartbeat + reconnect backoff bekerja.

---

## Urutan kerja

1. **Fase 1** dulu (backend) — satu lane `@fixer` (4 file, satu module).
2. **Test integrasi firehose** (2 koneksi × 2 POST + cancel) SEBELUM Fase 2 mulai.
3. **openapi:dump + regen** setelah Fase 1 (orchestrator).
4. **Fase 2** — `@fixer` lane kedua (frontend, 5 file). Kontrak sudah fixed dari Fase 1.
5. Verifikasi lintas-layer (orchestrator + review `@oracle` bila perlu).

## Edge cases / catatan

- **Backend restart saat run aktif** → runId hilang dari memori, status tetap di DB.
  Reconnect frontend sync via `GET /sessions/:id` → tampilkan "running" atau backfill penuh.
  Overlap live-vs-history ditutup konten-dedup (2c), bukan seq.
- **Double submit cepat ke session yang sama** → mutex (1b) + `assertThreadIdle` 409.
- **Stop setelah run selesai** → `cancelRun` no-op, aman.
- **Bus in-memory** → cukup untuk single-process Bun. Multi-instance = scope out
  (butuh Redis pub/sub / Postgres LISTEN-NOTIFY).
- **Gerbang multi-tenant** (fix audit #7): backend saat ini TANPA auth (server.ts
  hanya CORS). Firehose mengirim semua session ke semua client. Ini konsisten
  dengan posture keamanan existing, tapi WAJIB ditambahkan auth + filter
  workspace sebelum merge ke production multi-user. Untuk MVP: asumsi
  single-user / single-workspace, eksplisit.

## Scope out (MVP)

- Filter user/workspace penuh di bus (hanya `?workspaceId=` opsional di firehose).
- Strategi subscribe/unsubscribe (§5.2 doc) — belum perlu.
- Heartbeat tuning lanjutan (sudah ada basic 15s di 1c).
- Replay buffer event (bus tidak menyimpan histori).
- Backpressure lanjutan (sudah ada bounded queue per controller di 1a).

---

## Amendemen Audit

Temuan review diintegrasikan langsung ke langkah fase di atas:

| # | Severity | Temuan | Fix | Lokasi |
|---|---|---|---|---|
| 1 | High | Seq in-memory reset saat restart → dedup rusak | Seq jadi **per-run**; overlap ditutup konten-dedup (2c) | 1a, 2c |
| 2 | High | `void consumeRunToBus` tanpa catch → unhandled rejection, frontend gantung | `.catch()` selalu publish envelope terminal (`error`/`cancelled`) + persist | 1b |
| 3 | Med | `assertThreadIdle` check-then-act → race double run | Mutex per-thread di sekitar check+create | 1b |
| 4 | Med | `done` bisa mendahului persist result | `await repo.setResult` DULU, baru publish `done` | 1b |
| 5 | Med | Fan-out EventEmitter tanpa backpressure → memori membengkak | Bounded queue per controller, drop-oldest | 1a |
| 6 | Med | Tanpa heartbeat → reverse proxy putuskan SSE idle | `: keepalive\n\n` tiap 15s | 1c |
| 7 | Med-MVP | Firehose bocor lintas user/workspace | Eksplisit: MVP single-user; auth + filter wajib sebelum multi-tenant | Catatan |
| 8 | Low | lastSeq frontend hilang saat reload | Opsional localStorage; konten-dedup menutupi | 2c |
| 9 | Low | Cancel race joinStream → throw mentah | try/catch, bedakan cancel vs error, publish `cancelled` | 1b |
| 10 | Low | Envelope tidak ada di OpenAPI → drift tipe | Tipe hand-shared di `src/lib/chat-types.ts`, verifikasi manual | 2a |
| 11 | Low | Reconnect backoff tidak diset | Exponential backoff 1s→30s + jitter | 2d |
| 12 | Low | Firehose terbuka tanpa gate | Lazy connect saat dibutuhkan; catatan auth | 2d |

**Sequencing & scope:** urutan Fase 1 → test integrasi firehose → regen → Fase 2
dipertahankan. Deferral MVP masuk akal; multi-tenant + subscribe-filter adalah
gate nyata sebelum production, bukan nice-to-have.
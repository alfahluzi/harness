# SSE Multi-Session Streaming

Status: Fase 1 + Fase 2 selesai (backend + frontend ter-merge di branch kerja); Follow-up post-merge belum dikerjakan.

## Tujuan

Satu koneksi SSE per client (firehose global), banyak session dimultiplex lewat envelope `sessionId + runId + seq`. Run backend berjalan detached dari koneksi — tidak mati saat tab ditutup / pindah session. Pindah session = operasi state lokal di frontend, bukan buka/tutup koneksi.

## Scope

**In:**

- Backend: `StreamBus` + `ConnectionMux`, firehose `GET /sessions/stream`, `POST /sessions/:id/stream` → `202 {runId}`, `POST /sessions/:id/cancel`.
- Frontend: store per-session (Zustand), provider 1 koneksi app-lifetime + reconnect backoff, chat route baca store per-session.

**Out (MVP single-user):**

- Auth multi-tenant + filter user/workspace penuh — firehose saat ini mengirim semua session ke semua client (posture existing tanpa auth).
- Replay buffer event (bus tidak menyimpan histori).
- Strategi subscribe/unsubscribe via side-channel (firehose dulu; upgrade hanya kalau terbukti perlu).
- Backpressure lanjutan (bounded queue drop-oldest per controller sudah cukup).

## Arsitektur

```
[LangGraph run A] ─┐
[LangGraph run B] ─┼─► StreamBus (in-memory) ──► GET /sessions/stream ──► 1 SSE per client
[LangGraph run C] ─┘        (envelope: sessionId + runId + seq)         (firehose)
```

- Run = detached task yang publish ke bus; tidak peduli ada penonton.
- Koneksi = relay pasif + heartbeat 15s (`: keepalive`).
- Frontend route event ke store per-`sessionId`; switch session hanya ganti pointer.
- Dedup: `seq` per-run untuk reconnect mid-run; konten-dedup untuk overlap backfill-vs-live.

## Phase Breakdown

### Fase 1 — Backend (independen)

- `stream-bus.ts`: `StreamBus` + `ConnectionMux` (seq per-run, bounded queue drop-oldest, heartbeat 15s, filter workspace).
- `service.ts`: `startRun` / `consumeRunToBus` / `cancelRun`, mutex per-thread, persist-before-done, envelope terminal selalu ada.
- `route.ts`: POST stream → 202 JSON, GET firehose, POST cancel.
- `schema.ts`: `CancelSessionInput` + query param `workspaceId`.
- Verifikasi: test integrasi firehose 2 koneksi × 2 POST + cancel, tsc, bun test, openapi regen.

**Gate:** test integrasi firehose hijau (2 koneksi terima event 2 session, `done` setelah result terpersist, cancel → envelope `cancelled`), `bunx tsc --noEmit` 0 error, `bun test` hijau (kecuali fail pre-existing yang terdokumentasi), `bun run openapi:dump` + regen client frontend.

### Fase 2 — Frontend (kontrak Fase 1 fixed)

- `chat-types.ts`: tipe `StreamEvent` (hand-shared, drift-check vs backend).
- `stream.ts`: `startRun` / `cancelRun` / `connectStream`; hapus `streamChatMessage`.
- `chat-session-store.ts`: state per-session + dedup `(runId, seq)` + konten-dedup backfill.
- `stream-provider.tsx`: 1 koneksi app-lifetime, backoff 1s→30s + jitter, lazy connect; mount di `__root.tsx`.
- `chat/index.tsx`: baca store per-session, submit → `startRun`, stop → `cancelRun`, hapus guard global.

**Gate:** manual E2E 2 session paralel + switch tengah run (tidak campur aduk), reload/reconnect tanpa duplikat, stop session A tidak mengganggu session B, idle >60s → heartbeat + backoff bekerja; `tsc` 0 error di file yang disentuh; lint tanpa warning baru.

### Follow-up (post-merge)

- E2E lane: 2-session parallel, switch-mid-run, reconnect idle>60s, cancel isolation.
- Auth + per-workspace filter (gate multi-tenant).
- Cleanup unused exports `frontend/src/routes/u/route.tsx`.
- Unit test store + provider (Zustand + `connectStream` mock).

**Gate:** E2E lane ada dan hijau; auth + filter workspace sebelum merge production multi-user (audit #7); `tsc` repo 0 error; unit test store + provider jalan di CI.

## Referensi

- [Mekanisme & desain: references/sse-multi-session-streaming.md](references/sse-multi-session-streaming.md)

## Status Tracking

`task.json` (di folder ini) adalah source of truth status phase/task — bukan chat history. Cara baca:

```bash
~/.config/opencode/skills/project-plan-manager/bin/plan-manager plan_status --plan sse-multi-session
~/.config/opencode/skills/project-plan-manager/bin/plan-manager phase_list  --plan sse-multi-session
~/.config/opencode/skills/project-plan-manager/bin/plan-manager task_list   --plan sse-multi-session --phase 1
```

Jalankan dari root project (cwd = repo root). Jangan edit `task.json` manual.

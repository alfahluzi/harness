# Multiplexing SSE untuk Multi-Session Chat Streaming

## Ringkasan

Artikel ini membahas satu masalah spesifik yang sering muncul saat membangun agent harness atau chat application dengan streaming: **bagaimana caranya user bisa berpindah-pindah antar sesi percakapan (session/room) tanpa memutus koneksi Server-Sent Events (SSE) yang sedang berjalan.**

Masalah ini relevan untuk arsitektur apa pun yang punya bentuk umum seperti berikut:

```
Sumber Event (LLM run / agent / worker) -> Session Manager -> Client (frontend)
```

Di mana sumber event bisa berupa apa saja yang menghasilkan output asinkron dan berkelanjutan — LLM streaming, job queue, agent multi-step, dsb.

---

## 1. Masalah

### 1.1 Model naif: 1 koneksi SSE = 1 session

Pendekatan paling intuitif ketika pertama kali mengimplementasikan streaming adalah:

```
GET /sessions/:id/stream
```

Setiap kali user membuka session, frontend membuka `EventSource` baru ke endpoint tersebut. Ini bekerja untuk kasus single-session, tapi mulai retak begitu ada kebutuhan:

- User punya banyak session yang berjalan **bersamaan** (agent sedang bekerja di background untuk session A, sementara user melihat session B).
- User berpindah antar session dengan cepat (switching room di sidebar).
- Ada kebutuhan untuk tetap menerima notifikasi dari session lain meski sedang tidak dilihat (mis. badge "task selesai").

Dengan model 1:1, setiap perpindahan session berarti:

1. Menutup `EventSource` lama.
2. Membuka `EventSource` baru ke session tujuan.
3. Berpotensi kehilangan event yang terjadi tepat di celah antara close dan open.
4. Run di session sebelumnya harus diberi tahu "tidak ada yang dengar lagi" — padahal proses backend-nya (mis. LLM masih generating) tidak seharusnya berhenti hanya karena tidak ada yang menonton.

### 1.2 Akar masalah

SSE adalah **transport**, bukan **unit kerja**. Kesalahan konseptual yang umum terjadi adalah menyamakan "satu koneksi jaringan" dengan "satu percakapan". Padahal:

- Koneksi jaringan = milik satu client (tab/browser).
- Session/room = milik domain data (percakapan, task, room).
- Run/proses (LLM generation, agent execution) = unit kerja yang independen dari keduanya.

Begitu tiga hal ini dianggap sama, setiap perubahan pada salah satunya (ganti session) memaksa perubahan pada yang lain (buka/tutup koneksi) — padahal seharusnya tidak perlu.

---

## 2. Prinsip Solusi

> **Satu koneksi SSE per client, dimultiplex oleh banyak session. Proses backend berjalan independen dari ada-tidaknya yang menonton.**

Tiga pemisahan konsep yang harus dijaga tetap independen:

| Konsep | Siklus hidup | Contoh |
|---|---|---|
| Koneksi transport (SSE) | Selama tab/browser terbuka | 1 per client |
| Session/room | Selama percakapan itu ada | Banyak per user |
| Run/task | Selama proses backend bekerja | Independen, bisa lanjut walau tidak ditonton |

Dengan pemisahan ini, "pindah session" menjadi **operasi state lokal di frontend**, bukan operasi jaringan.

```
                         ┌─────────────────────────┐
Run(session A) ────────► │                         │
Run(session B) ────────► │  Session Manager / Bus  │──── 1 SSE ────► Frontend
Run(session C) ────────► │                         │                (routing per sessionId)
                         └─────────────────────────┘
```

---

## 3. Desain Event Envelope

Karena satu koneksi membawa event dari banyak session, setiap event **wajib** membawa identitas asalnya. Ini adalah fondasi dari seluruh mekanisme.

```ts
type StreamEvent = {
  sessionId: string;   // wajib: identitas session asal
  seq: number;         // wajib: nomor urut per-session, untuk ordering & dedup
  type: "token" | "tool_call" | "status" | "error" | "done";
  data: unknown;
  ts: number;           // timestamp untuk debugging/observability
};
```

Poin penting:

- **`seq` per session**, bukan global. Ini krusial untuk reconnect (lihat bagian 6).
- `type` dan `data` tetap sama seperti event streaming biasa — envelope ini hanya menambah metadata routing, tidak mengubah payload asli.

---

## 4. Sisi Backend: Event Bus + Connection Multiplexer

### 4.1 Pemisahan Run dari Koneksi

Setiap run (LLM generation, agent execution, dsb) dijalankan sebagai task independen yang mem-publish event ke **bus internal**, bukan langsung menulis ke response stream:

```ts
const bus = new EventEmitter();

async function startRun(sessionId: string, input: unknown) {
  let seq = 0;
  for await (const chunk of llmOrAgent.stream(input)) {
    bus.emit("event", {
      sessionId,
      seq: seq++,
      type: chunk.type,
      data: chunk.data,
      ts: Date.now(),
    });
  }
}
```

Task ini **tidak peduli** apakah ada client yang sedang mendengarkan atau tidak. Ini menjawab langsung masalah di 1.1 poin 4 — run tidak digantung oleh status koneksi.

### 4.2 Multiplexer per koneksi

Setiap koneksi SSE punya satu instance multiplexer yang mem-filter event bus sesuai kebutuhan koneksi tersebut:

```ts
class ConnectionMux {
  private controller?: ReadableStreamDefaultController;
  private subscribed = new Set<string>(); // kosong = terima semua (firehose)

  attach(controller: ReadableStreamDefaultController) {
    this.controller = controller;
  }

  publish(event: StreamEvent) {
    if (this.subscribed.size > 0 && !this.subscribed.has(event.sessionId)) {
      return; // bukan session yang di-subscribe, skip
    }
    this.controller?.enqueue(`data: ${JSON.stringify(event)}\n\n`);
  }

  subscribe(sessionId: string) { this.subscribed.add(sessionId); }
  unsubscribe(sessionId: string) { this.subscribed.delete(sessionId); }
}
```

### 4.3 Endpoint SSE

```ts
app.get("/stream", (c) => {
  const mux = new ConnectionMux();
  const stream = new ReadableStream({
    start(controller) {
      mux.attach(controller);
      const handler = (e: StreamEvent) => mux.publish(e);
      bus.on("event", handler);
      c.req.raw.signal.addEventListener("abort", () => bus.off("event", handler));
    },
  });
  return streamSSE(c, stream);
});
```

---

## 5. Dua Strategi Routing: Firehose vs Subscribe

SSE bersifat satu arah (server → client). Untuk memberi tahu backend "sekarang saya sedang menonton session X", dibutuhkan mekanisme tambahan. Ada dua strategi, dengan trade-off berbeda:

### 5.1 Strategi A — Firehose (mulai dari sini)

Semua event dari semua session milik user diteruskan ke koneksi SSE, tanpa filter di backend. Frontend yang memilih mana yang dirender sebagai "aktif", sisanya cukup di-buffer di store (mis. untuk badge notifikasi).

**Kelebihan:**
- Sangat sederhana, tidak butuh side-channel komunikasi.
- Tidak ada race condition antara "switch session" dan "event masuk".
- Cocok untuk MVP atau jumlah session paralel yang kecil-menengah.

**Kekurangan:**
- Bandwidth terbuang untuk session yang tidak sedang dilihat.
- Tidak scalable kalau user bisa punya puluhan session aktif bersamaan.

### 5.2 Strategi B — Subscribe/Unsubscribe via side-channel

Tambahkan endpoint kecil untuk mengatur `subscribed` set pada multiplexer koneksi yang sedang aktif:

```ts
app.post("/sessions/:id/subscribe", (c) => {
  const mux = getMuxForConnection(c);
  mux.subscribe(c.req.param("id"));
  return c.json({ ok: true });
});

app.post("/sessions/:id/unsubscribe", (c) => {
  const mux = getMuxForConnection(c);
  mux.unsubscribe(c.req.param("id"));
  return c.json({ ok: true });
});
```

Frontend memanggil `subscribe` saat membuka session dan (opsional) `unsubscribe` saat pindah — atau tetap subscribe ke beberapa session sekaligus jika ingin tetap menerima notifikasi background.

**Kelebihan:**
- Hemat bandwidth, hanya event relevan yang dikirim.
- Bisa berkembang jadi granular (mis. "subscribe status saja, bukan token" untuk session non-aktif).

**Kekurangan:**
- Kompleksitas tambahan: perlu mapping koneksi ↔ mux, perlu handle race antara subscribe-request dan event yang sudah terlanjur di-emit.

**Rekomendasi pragmatis:** mulai dengan Firehose. Upgrade ke Subscribe/Unsubscribe hanya ketika sudah terbukti perlu (jumlah session paralel besar, biaya bandwidth jadi masalah nyata). Ini konsisten dengan prinsip *MVP-first, no over-engineering* — jangan bangun mekanisme subscribe granular sebelum firehose benar-benar terbukti tidak cukup.

---

## 6. Sisi Frontend: State per Session, Bukan per Koneksi

### 6.1 Struktur state

Gunakan satu koneksi SSE global untuk seluruh aplikasi, lalu route event ke state store yang di-index oleh `sessionId`:

```ts
type SessionState = {
  messages: Message[];
  lastSeq: number;
  status: "idle" | "streaming" | "error";
};

const sessionStore = new Map<string, SessionState>(); // atau Zustand/Redux map

function handleIncomingEvent(event: StreamEvent) {
  const state = sessionStore.get(event.sessionId) ?? initSessionState();

  if (event.seq <= state.lastSeq) return; // dedup, event lama/duplikat

  applyEventToState(state, event);
  state.lastSeq = event.seq;
  sessionStore.set(event.sessionId, state);
}
```

### 6.2 "Pindah session" = ganti pointer, bukan ganti koneksi

```ts
function switchToSession(sessionId: string) {
  activeSessionId.set(sessionId); // trigger re-render dari store yang sudah ada
  // TIDAK ADA: eventSource.close() / new EventSource()
}
```

Karena `sessionStore` sudah menyimpan riwayat semua session yang pernah menerima event (baik sedang dilihat atau tidak), berpindah session menjadi operasi baca state lokal — instan, tanpa network round-trip, tanpa risiko kehilangan event di celah waktu.

### 6.3 Koneksi tunggal, siklus hidup panjang

```ts
const es = new EventSource("/stream");
es.onmessage = (e) => handleIncomingEvent(JSON.parse(e.data));
es.onerror = () => scheduleReconnect();
```

Koneksi ini dibuka sekali per lifetime tab, bukan per session.

---

## 7. Reconnect dan Resume

Karena run backend berjalan independen dari koneksi SSE (lihat 4.1), reconnect menjadi jauh lebih sederhana: run tidak pernah "terganggu" oleh disconnect frontend.

Alur reconnect yang direkomendasikan:

1. **Backfill** — saat frontend reconnect atau membuka session, ambil histori dari sumber tepercaya (database / checkpointer):
   ```
   GET /sessions/:id/history
   ```
2. **Resume live stream** — buka kembali koneksi `/stream`, event baru akan mengalir dari titik saat ini.
3. **Dedup dengan `seq`** — karena ada kemungkinan overlap antara data histori dan event live yang sempat terlewat, gunakan `seq` per session untuk membuang duplikat (lihat `event.seq <= state.lastSeq` di 6.1).

```
[reconnect] ──► GET /sessions/:id/history (isi state sampai seq=N)
            └──► subscribe ke /stream (event baru mulai dari seq=N+1, duplikat dibuang)
```

---

## 8. Ringkasan Keputusan Desain

| Keputusan | Alasan |
|---|---|
| 1 koneksi SSE per client, bukan per session | Menghindari overhead open/close saat switch session |
| Run backend independen dari koneksi | Proses tidak boleh berhenti hanya karena tidak ditonton |
| Event envelope wajib bawa `sessionId` + `seq` | Basis untuk routing di frontend dan dedup saat reconnect |
| Mulai dari Firehose, upgrade ke Subscribe bila perlu | Hindari kompleksitas prematur; tambah granularitas hanya saat terbukti perlu |
| State di frontend di-index per session | "Pindah session" jadi operasi lokal, bukan operasi jaringan |
| Reconnect = backfill histori + resume stream + dedup by `seq` | Toleran terhadap disconnect tanpa kehilangan atau menduplikasi data |

---

## 9. Kapan Pola Ini *Tidak* Dibutuhkan

Untuk kejujuran teknis: jika aplikasi hanya pernah punya **satu session aktif per user pada satu waktu**, dan tidak ada kebutuhan proses background lanjut jalan saat session ditutup, model naif (1 SSE = 1 session) sudah cukup dan lebih sederhana untuk dirawat. Pola multiplexing di atas baru bernilai ketika salah satu dari kondisi berikut muncul:

- User bisa punya lebih dari satu run/proses berjalan bersamaan.
- Ada kebutuhan switch antar session tanpa jeda/reload.
- Ada kebutuhan notifikasi lintas-session (background task selesai, dsb).

Membangun ini sebelum kebutuhan itu nyata adalah bentuk over-engineering yang sebaiknya dihindari.
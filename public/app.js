"use strict";
/* Snap Study client. No framework, no build step, no network calls except to this server. */
(() => {
  // ───────────────────────── helpers ─────────────────────────
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const icon = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const view = $("#view");

  function toast(msg, ms = 2600) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), ms);
  }
  function confirmDialog(text, ok = "Delete") {
    const d = $("#confirm");
    $("#confirm-text").textContent = text;
    $("button[value=yes]", d).textContent = ok;
    return new Promise((res) => {
      d.returnValue = "no";
      d.addEventListener("close", () => res(d.returnValue === "yes"), { once: true });
      d.showModal();
    });
  }
  async function copy(text, msg = "Copied") {
    try { await navigator.clipboard.writeText(text); toast(msg); }
    catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast(msg); } catch (e2) { toast("Couldn't copy"); }
      ta.remove();
    }
  }
  const dayKey = (t = Date.now()) => { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  function relTime(ts) {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    if (dayKey(ts) === dayKey(Date.now() - 86400000)) return "Yesterday";
    return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  const sleep = (ms, signal) => new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); rej(new ApiError("aborted", "Stopped.", false)); }, { once: true });
  });

  const SUBJECTS = [
    { id: "math", name: "Mathematics", c: "#3b6fb6", starters: ["Explain fractions with an example", "How do I find the LCM of 12 and 18?", "What is the difference between area and perimeter?"] },
    { id: "science", name: "Science", c: "#2f8f5b", starters: ["How do plants make their food?", "Why do we have day and night?", "What is the difference between a mixture and a pure substance?"] },
    { id: "physics", name: "Physics", c: "#6a4cae", starters: ["What is Newton's first law?", "Explain refraction of light", "How does a magnifying glass work?"] },
    { id: "chemistry", name: "Chemistry", c: "#d97706", starters: ["What is an atom?", "Explain the difference between a compound and a mixture", "What is pH scale?"] },
    { id: "biology", name: "Biology", c: "#059669", starters: ["What is a cell?", "How does the human heart work?", "What is photosynthesis?"] },
    { id: "english", name: "English", c: "#b8741f", starters: ["What are nouns, pronouns and adjectives?", "Help me write a paragraph about my school", "When do I use 'a' and when 'an'?"] },
    { id: "history", name: "History", c: "#9a5a3c", starters: ["Who were the people of the Indus Valley?", "What was the Great Bath used for?", "How did early humans live?"] },
    { id: "geography", name: "Geography", c: "#2e8aa6", starters: ["What are latitudes and longitudes?", "Why is the Earth called the blue planet?", "What are the major landforms?"] },
    { id: "computer", name: "Computer Science", c: "#4a7a8c", starters: ["What is the difference between hardware and software?", "What does a CPU do?", "How does the internet work?"] },
    { id: "programming", name: "Programming", c: "#3b82f6", starters: ["What is a variable in Python?", "Explain how a for loop works", "What is a function?"] },
    { id: "gk", name: "General Knowledge", c: "#8a7a2e", starters: ["Tell me an interesting fact about India", "What are the seven continents?", "Who invented the telephone?"] },
  ];
  const subjectById = (id) => SUBJECTS.find((s) => s.id === id) || null;
  const dot = (s) => `<span class="sdot" style="--c:${s ? s.c : "var(--ink-3)"}"></span>`;

  // ───────────────────────── storage ─────────────────────────
  const KEY = "snapstudy.v2";
  const defaults = () => ({ profile: { name: "", board: "CBSE", grade: "Class 6", language: "English", model: "", theme: "auto" }, convos: [], notes: [], quizzes: [], activity: {} });
  function load() {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!j) return defaults();
      const d = defaults();
      return { ...d, ...j, profile: { ...d.profile, ...(j.profile || {}) } };
    } catch (e) { return defaults(); }
  }
  let S = load();
  let saveTimer;
  function saveNow() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast("Browser storage is full. Delete old chats in Library."); }
  }
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 200); };
  window.addEventListener("beforeunload", saveNow);
  const bump = () => { const k = dayKey(); S.activity[k] = (S.activity[k] || 0) + 1; };

  // Photos live in IndexedDB so chats stay small. A Map keeps them usable if IndexedDB is blocked.
  const dbp = new Promise((res) => {
    try {
      const r = indexedDB.open("snapstudy", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("meta", { keyPath: "id" }); r.result.createObjectStore("full", { keyPath: "id" }); };
      r.onsuccess = () => res(r.result);
      r.onerror = r.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
  const tx = (stores, mode, fn) => dbp.then((db) => !db ? null : new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    let out;
    try { out = fn(...[].concat(stores).map((s) => t.objectStore(s))); } catch (e) { rej(e); return; }
    t.oncomplete = () => res(out && "result" in out ? out.result : out);
    t.onerror = t.onabort = () => rej(t.error);
  }));
  const mem = new Map();
  async function imgSave(rec) {
    const meta = { id: rec.id, thumb: rec.thumb, name: rec.name, ts: rec.ts };
    mem.set(rec.id, { meta, full: rec.full });
    try { await tx(["meta", "full"], "readwrite", (m, f) => { m.put(meta); return f.put({ id: rec.id, data: rec.full }); }); } catch (e) {}
  }
  async function imgFull(id) {
    const c = mem.get(id);
    if (c?.full) return c.full;
    try { const r = await tx("full", "readonly", (s) => s.get(id)); return r?.data || null; } catch (e) { return null; }
  }
  async function imgMeta(id) {
    const c = mem.get(id);
    if (c?.meta) return c.meta;
    try { return (await tx("meta", "readonly", (s) => s.get(id))) || null; } catch (e) { return null; }
  }
  async function imgList() {
    let list = [];
    try { list = (await tx("meta", "readonly", (s) => s.getAll())) || []; } catch (e) {}
    const seen = new Set(list.map((m) => m.id));
    for (const { meta } of mem.values()) if (!seen.has(meta.id)) list.push(meta);
    return list.sort((a, b) => b.ts - a.ts);
  }
  async function imgRemove(id) {
    mem.delete(id);
    try { await tx(["meta", "full"], "readwrite", (m, f) => { m.delete(id); return f.delete(id); }); } catch (e) {}
  }
  async function imgClear() {
    mem.clear();
    try { await tx(["meta", "full"], "readwrite", (m, f) => { m.clear(); return f.clear(); }); } catch (e) {}
  }

  // Resize to at most 1280px and re-encode as JPEG. Phone photos are 4000px+ and many MB:
  // sending them raw is slow and makes local vision models worse, not better.
  async function processImage(file) {
    if (!file.type.startsWith("image/")) throw new Error(`"${file.name}" is not an image.`);
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (e) { throw new Error(`Couldn't read "${file.name || "that photo"}". Try a JPG or PNG.`); }
    const draw = (max, q) => {
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(bmp, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", q);
    };
    const rec = { id: uid(), full: draw(1280, 0.85), thumb: draw(240, 0.7), name: file.name || "photo", ts: Date.now() };
    bmp.close?.();
    await imgSave(rec);
    return rec;
  }

  // ───────────────────────── AI client ─────────────────────────
  class ApiError extends Error {
    constructor(code, message, retryable, detail) { super(message); this.code = code; this.retryable = !!retryable; this.detail = detail || ""; this.partial = ""; }
  }
  function friendly(code, detail, status) {
    const m = currentModel() || "the model";
    switch (code) {
      case "ollama_unreachable": return "Snap Study can't reach Ollama. Open the Ollama app (or run “ollama serve”), then tap Retry.";
      case "model_not_found": return `The model “${m}” isn't installed on this computer.`;
      case "model_no_vision": return `“${m}” can't read photos. Pick a photo-reading model in Profile, or remove the photo.`;
      case "out_of_memory": return "This computer doesn't have enough free memory for that model. Close other apps or pick a smaller model.";
      case "busy": return "The model is busy with another request. Give it a moment, then tap Retry.";
      case "bad_request": return detail || "The request could not be understood.";
      default: return `The model returned an error${status ? " (" + status + ")" : ""}.`;
    }
  }
  async function readError(res) {
    let j = {};
    try { j = await res.json(); } catch (e) {}
    const code = j.error || "http_" + res.status;
    return new ApiError(code, friendly(code, j.message, res.status), j.retryable ?? (res.status >= 500 || res.status === 429), j.message);
  }

  // One attempt. Returns the full text. Throws ApiError (with .partial if some text arrived).
  async function attempt({ model, messages, format, signal, onToken }) {
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal?.addEventListener("abort", onAbort);
    let timer, timedOut = false, full = "";
    const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctl.abort(); }, ms); };
    arm(240000); // first token can be slow while the model loads into memory
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, messages, format }), signal: ctl.signal });
      if (!res.ok) throw await readError(res);
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = "";
      const handle = (line) => {
        line = line.trim();
        if (!line) return;
        let j; try { j = JSON.parse(line); } catch (e) { return; }
        if (j.error) throw new ApiError("stream_error", "The model stopped in the middle of its answer.", true, String(j.error));
        const t = j.message?.content;
        if (t) { full += t; onToken?.(t, full); }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm(90000);
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
      }
      handle(buf);
      return full;
    } catch (e) {
      let err = e;
      if (signal?.aborted) err = new ApiError("aborted", "Stopped.", false);
      else if (timedOut) err = new ApiError("timeout", "The model took too long to respond.", true);
      else if (!(e instanceof ApiError)) err = new ApiError("network", "Lost the connection to the Snap Study server. Is “node server.js” still running?", true);
      err.partial = full;
      throw err;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
  }
  // Retries transient failures (Ollama starting, busy, dropped connection) with exponential backoff + jitter.
  // Never retries once text has started arriving, and never invents an answer.
  async function ask(opts) {
    const delays = [1500, 4000, 9000];
    for (let n = 0; ; n++) {
      try { return await attempt(opts); }
      catch (e) {
        if (!e.retryable || e.partial || n >= delays.length) throw e;
        opts.onStatus?.(`Having trouble reaching the model. Retrying (${n + 1} of ${delays.length})…`);
        await sleep(delays[n] * (0.8 + Math.random() * 0.4), opts.signal);
        opts.onStatus?.("");
      }
    }
  }

  // Model list
  const M = { status: "loading", models: [], maxImages: 4 };
  async function loadModels() {
    M.status = "loading";
    try {
      const r = await fetch("/api/models");
      const j = await r.json();
      if (!r.ok) throw new Error();
      M.models = j.models || []; M.maxImages = j.maxImages || 4; M.status = "ok";
    } catch (e) { M.models = []; M.status = "down"; }
    renderNav();
  }
  function currentModel() {
    if (!M.models.length) return "";
    const want = M.models.find((m) => m.name === S.profile.model);
    return (want || M.models.find((m) => m.vision) || M.models[0]).name;
  }
  const modelInfo = (name) => M.models.find((m) => m.name === name);
  const canSeePhotos = (name) => modelInfo(name)?.vision !== false;

  function setupNotice() {
    if (M.status === "loading") return "";
    if (M.status === "down") {
      return `<div class="callout bad" role="alert">${icon("alert")}<div class="grow"><b>Ollama isn't running</b>
        <p class="small">Snap Study needs Ollama to think. Open the Ollama app, then check again.</p>
        <div style="margin-top:10px"><button class="btn sm" data-action="setup-check">${icon("refresh")}Check again</button></div></div></div>`;
    }
    if (!M.models.length) {
      return `<div class="callout warn" role="alert">${icon("alert")}<div class="grow"><b>No AI model installed yet</b>
        <p class="small">Ollama is running but has nothing to answer with. Open a terminal and download one (about 3 GB, once):</p>
        <div class="cmdline"><code>ollama pull gemma3:4b</code><button class="btn sm" data-action="copy-cmd" data-text="ollama pull gemma3:4b">${icon("copy")}Copy</button></div>
        <div style="margin-top:10px"><button class="btn sm" data-action="setup-check">${icon("refresh")}I've installed it, check again</button></div></div></div>`;
    }
    return "";
  }
  const aiReady = () => M.status === "ok" && !!currentModel();

  // ───────────────────────── prompts ─────────────────────────
  function systemPrompt(subject, mode) {
    const p = S.profile;
    const lang = p.language;
    let s = `You are Snap Study, a patient, friendly tutor for a student in ${p.grade || "Class 6"} following the ${p.board} syllabus in India.${p.name ? ` The student's name is ${p.name}.` : ""}
Rules:
- Reply in ${lang}${lang !== "English" ? ", using simple words and keeping key technical terms in English in brackets" : ""}.
- Adjust your explanation level to be appropriate for a ${p.grade || "Class 6"} student.
- Use short sentences and simple words. Explain the idea first, then the steps.
- If a photo is attached, read it carefully and answer from what is actually in it. If it is blurry or cut off, say exactly what you cannot read and ask for a clearer photo. Never guess at text you cannot see. If no photo is attached, never pretend you can see one.
- If you are not sure of a fact, say so. Do not invent page numbers or exercises.
- Format with Markdown: short headings, bullet lists, **bold** key terms.`;
    s += `\nSubject: ${subject ? subject.name : "any school subject"}.`;

    if (mode === "homework") {
      s += `\nThis is homework help. Do not only give the final answer: show the working so the student learns. For maths use these headings: ### Given, ### Formula, ### Working, ### Answer. Finish with a section titled "## Notebook answer" containing the answer exactly as a student would neatly write it in a school notebook, one line per step.`;
    } else if (mode === "learn") {
      s += `\nLearn Mode: Provide a detailed, conceptual explanation. Break down complex ideas into smaller, manageable parts. Use analogies and everyday examples to make the concept intuitive.`;
    } else if (mode === "exam") {
      s += `\nExam Mode: Help the student prepare for exams. Focus on key definitions, important points that are frequently tested, and provide exam-style practice questions.`;
    } else if (mode === "quick") {
      s += `\nQuick Answer Mode: Provide a short, direct, and concise answer. Avoid long introductions or unnecessary details, but ensure the answer is accurate.`;
    } else if (mode === "revision") {
      s += `\nRevision Mode: Create a high-level summary. Focus on the most important takeaways, key formulas, and essential definitions. Organize the information for quick review.`;
    } else {
      s += `\nExplain concepts clearly with one small everyday example. End with one short question to check understanding.`;
    }
    return s;
  }

  // ───────────────────────── markdown ─────────────────────────
  function inline(t) {
    t = esc(t);
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
    return t;
  }
  function md(src) {
    const lines = String(src).replace(/\r/g, "").split("\n");
    const out = [];
    let i = 0;
    const isBlockStart = (l) => /^(#{1,4}\s|```|\s*[-*•]\s|\s*\d+[.)]\s|>\s?|\|)/.test(l) || /^---+\s*$/.test(l);
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      if (l.startsWith("```")) {
        const buf = []; i++;
        while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
        i++;
        out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      } else if (/^#{1,4}\s/.test(l)) {
        const lvl = Math.min(3, l.match(/^#+/)[0].length);
        out.push(`<h${lvl}>${inline(l.replace(/^#+\s*/, ""))}</h${lvl}>`); i++;
      } else if (/^---+\s*$/.test(l)) { out.push("<hr>"); i++; }
      else if (/^\s*[-*•]\s/.test(l)) {
        const items = [];
        while (i < lines.length && /^\s*[-*•]\s/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*[-*•]\s/, ""))}</li>`);
        out.push(`<ul>${items.join("")}</ul>`);
      } else if (/^\s*\d+[.)]\s/.test(l)) {
        const items = [];
        const start = parseInt(l, 10) || 1;
        while (i < lines.length && /^\s*\d+[.)]\s/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*\d+[.)]\s/, ""))}</li>`);
        out.push(`<ol start="${start}">${items.join("")}</ol>`);
      } else if (l.startsWith("|") && /^\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
        const row = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const head = row(l); i += 2;
        const body = [];
        while (i < lines.length && lines[i].startsWith("|")) body.push(row(lines[i++]));
        out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      } else if (/^>\s?/.test(l)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
        out.push(`<blockquote>${inline(buf.join("\n")).replace(/\n/g, "<br>")}</blockquote>`);
      } else {
        const buf = [l]; i++;
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) buf.push(lines[i++]);
        out.push(`<p>${inline(buf.join("\n")).replace(/\n/g, "<br>")}</p>`);
      }
    }
    return out.join("");
  }
  const NB_RE = /^#{1,4}\s*notebook answer.*$/im;
  function notebookOf(content) {
    const m = NB_RE.exec(content);
    return m ? content.slice(m.index + m[0].length).trim() : "";
  }
  function renderBody(content, id) {
    const m = NB_RE.exec(content);
    if (!m) return `<div class="prose">${md(content)}</div>`;
    const before = content.slice(0, m.index), nb = content.slice(m.index + m[0].length);
    return `<div class="prose">${md(before)}</div>
      <div class="notebook"><div class="notebook-head"><span>Notebook answer</span><button class="btn ghost sm" data-action="copy-notebook" data-id="${esc(id)}">${icon("copy")}Copy</button></div>
      <div class="notebook-body prose">${md(nb)}</div></div>`;
  }
  const plain = (s) => String(s).replace(/[*_#`>|]/g, "").replace(/\n{3,}/g, "\n\n");

  // ───────────────────────── attachments ─────────────────────────
  const newAttacher = () => ({ items: [] });
  const ATT = { chat: newAttacher(), notes: newAttacher(), quiz: newAttacher() };
  const attImgs = (key) => ATT[key].items.filter((x) => x.rec).map((x) => x.rec);
  function attachHtml(key) {
    return ATT[key].items.map((x) => x.rec
      ? `<div class="attach"><img src="${x.rec.thumb}" alt="Attached photo"><button type="button" data-action="remove-attach" data-key="${key}" data-id="${x.id}" aria-label="Remove photo">${icon("x")}</button></div>`
      : `<div class="attach loading skeleton"></div>`).join("");
  }
  function refreshAttach(key) {
    const row = $(`[data-attach-row="${key}"]`);
    if (row) row.innerHTML = attachHtml(key);
    if (key === "chat") syncSend();
  }
  async function addFiles(key, files) {
    const att = ATT[key];
    files = Array.from(files).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!files.length) return;
    const room = M.maxImages - att.items.length;
    if (room <= 0) return toast(`You can attach up to ${M.maxImages} photos.`);
    if (files.length > room) toast(`Only ${M.maxImages} photos fit in one message. Added the first ${room}.`);
    await Promise.all(files.slice(0, room).map(async (f) => {
      const slot = { id: uid(), rec: null };
      att.items.push(slot); refreshAttach(key);
      try { slot.rec = await processImage(f); slot.id = slot.rec.id; }
      catch (e) { att.items = att.items.filter((x) => x !== slot); toast(e.message, 4000); }
      refreshAttach(key);
    }));
  }
  async function hydrateImgs(root) {
    for (const img of $$("img[data-img]", root)) {
      const meta = await imgMeta(img.dataset.img);
      if (meta) img.src = meta.thumb; else img.closest("button")?.replaceWith(Object.assign(document.createElement("span"), { className: "faint small", textContent: "Photo removed" }));
    }
  }

  // ───────────────────────── nav & routing ─────────────────────────
  const NAV = [
    ["home", "/", "home", "Home"], ["tutor", "/tutor", "chat", "Tutor"], ["homework", "/homework", "pencil", "Homework"],
    ["notes", "/notes", "notes", "Notes"], ["quiz", "/quiz", "quiz", "Quiz"], ["library", "/library", "library", "Library"],
  ];
  let section = "home";
  function renderNav() {
    const p = S.profile, ini = (p.name || "S").trim()[0].toUpperCase();
    const mdl = currentModel();
    const st = M.status === "loading" ? ["", "Checking AI…"] : M.status === "down" ? ["bad", "Ollama not running"] : !mdl ? ["bad", "No model installed"] : ["ok", mdl];
    $("#nav").innerHTML = `
      <a class="brand" href="#/"><span class="brand-mark">${icon("notes")}</span><b>Snap Study</b></a>
      ${NAV.map(([id, href, ic, label]) => `<a class="nav-link" href="#${href}" ${section === id ? 'aria-current="page"' : ""}>${icon(ic)}<span>${label}</span></a>`).join("")}
      <div class="nav-spacer"></div>
      <div class="nav-foot">
        <div class="status" title="AI model"><span class="dot ${st[0]}"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(st[1])}</span></div>
        <a class="nav-link desk" href="#/profile" ${section === "profile" ? 'aria-current="page"' : ""}><span class="avatar">${esc(ini)}</span><span>${esc(p.name || "Profile")}</span></a>
      </div>`;
  }

  let chatCtx = null; // the chat currently shown (convo + draft state)
  function route() {
    const h = location.hash.slice(1) || "/";
    const [path, qs] = h.split("?");
    const q = new URLSearchParams(qs || "");
    const parts = path.split("/").filter(Boolean);
    const root = parts[0] || "home";
    chatCtx = null;
    quizCtx.active = false;
    section = root === "chat" ? (findConvo(parts[1])?.mode === "homework" ? "homework" : "tutor") : root;
    renderNav();
    view.scrollTop = 0;
    switch (root) {
      case "home": return renderHome();
      case "tutor": return renderChat(null, "tutor", q.get("subject"));
      case "homework": return renderChat(null, "homework", q.get("subject"));
      case "chat": { const c = findConvo(parts[1]); return c ? renderChat(c) : (location.hash = "#/tutor"); }
      case "notes": return parts[1] ? renderNote(parts[1]) : renderNotes();
      case "quiz": return renderQuiz();
      case "library": return renderLibrary(q.get("tab") || "chats");
      case "profile": return renderProfile();
      default: location.hash = "#/";
    }
  }
  const findConvo = (id) => S.convos.find((c) => c.id === id);
  window.addEventListener("hashchange", route);

  // ───────────────────────── home ─────────────────────────
  function streakInfo() {
    let n = 0, d = new Date();
    if (!S.activity[dayKey(d)]) d.setDate(d.getDate() - 1);
    while (S.activity[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function renderHome() {
    const p = S.profile, h = new Date().getHours();
    const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    const convos = [...S.convos].sort((a, b) => b.updated - a.updated);
    const last = convos[0];
    const weekAsked = convos.reduce((n, c) => n + c.messages.filter((m) => m.role === "user" && Date.now() - m.ts < 7 * 864e5).length, 0);
    const avg = S.quizzes.length ? Math.round(S.quizzes.reduce((n, q) => n + q.score / q.total, 0) / S.quizzes.length * 100) : null;
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return !!S.activity[dayKey(d)]; });
    const hero = last
      ? `<a class="hero" href="#/chat/${last.id}"><div class="grow"><div class="eyebrow" style="margin:0 0 6px">Continue learning</div><h2>${esc(last.title)}</h2>
          <p class="muted small" style="margin-top:4px">${dot(subjectById(last.subject))} ${esc(subjectById(last.subject)?.name || "Any subject")} · ${relTime(last.updated)}</p></div><span class="arrow">${icon("arrow")}</span></a>`
      : `<a class="hero" href="#/tutor"><div class="grow"><div class="eyebrow" style="margin:0 0 6px">Get started</div><h2>Ask your first question</h2>
          <p class="muted small" style="margin-top:4px">Type a question or add a photo of a textbook page.</p></div><span class="arrow">${icon("arrow")}</span></a>`;
    view.innerHTML = `<div class="page">
      <header class="page-head row between"><div><div class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</div>
        <h1>${greet}${p.name ? ", " + esc(p.name) : ""}</h1></div>
        <a class="icon-btn" href="#/profile" aria-label="Profile and settings">${icon("user")}</a></header>
      ${setupNotice() ? `<div style="margin-bottom:20px">${setupNotice()}</div>` : ""}
      ${hero}
      <div class="row wrap" style="margin-top:12px">
        <a class="btn primary" href="#/tutor">${icon("chat")}Ask the tutor</a>
        <a class="btn" href="#/homework">${icon("image")}Solve homework from a photo</a>
        <a class="btn" href="#/notes">${icon("notes")}Make notes</a>
        <a class="btn" href="#/quiz">${icon("quiz")}Take a quiz</a>
      </div>
      <section class="section"><div class="section-head"><h2>Subjects</h2></div>
        <div class="subjects">${SUBJECTS.map((s) => `<button class="subject" data-action="subject-start" data-subject="${s.id}">${dot(s)}${esc(s.name)}</button>`).join("")}</div></section>
      <section class="section"><div class="section-head"><h2>Your progress</h2></div>
        <div class="stats">
          <div class="stat"><b>${weekAsked}</b><span>Questions this week</span></div>
          <div class="stat"><b>${S.quizzes.length}</b><span>Quizzes taken</span></div>
          <div class="stat"><b>${avg === null ? "–" : avg + "%"}</b><span>Average quiz score</span></div>
          <div class="stat"><b>${streakInfo()}</b><span>Day streak</span></div>
        </div><div class="week" title="Last 7 days">${days.map((d) => `<i class="${d ? "on" : ""}"></i>`).join("")}</div></section>
      <section class="section"><div class="section-head"><h2>Recent conversations</h2><a class="link-btn" href="#/library">All ${icon("arrow")}</a></div>
        ${convos.length ? `<div class="list">${convos.slice(0, 5).map(convoItem).join("")}</div>`
          : `<div class="empty list"><div class="mark">${icon("chat")}</div><h3>No conversations yet</h3><p class="small">Your questions and answers will show up here.</p></div>`}</section>
      <section class="section"><div class="section-head"><h2>Recent study materials</h2><a class="link-btn" href="#/library?tab=photos">All ${icon("arrow")}</a></div>
        <div id="home-photos"><div class="thumbs">${'<div class="thumb skeleton"></div>'.repeat(4)}</div></div></section>
    </div>`;
    imgList().then((list) => {
      const box = $("#home-photos");
      if (!box) return;
      box.innerHTML = list.length
        ? `<div class="thumbs">${list.slice(0, 6).map((m) => `<button class="thumb" data-action="open-img" data-id="${m.id}" aria-label="Open photo"><img src="${m.thumb}" alt="${esc(m.name)}"></button>`).join("")}</div>`
        : `<div class="empty list"><div class="mark">${icon("image")}</div><h3>No photos yet</h3><p class="small">Photos you add to a question are kept here so you can ask about them again.</p></div>`;
    });
  }
  function convoItem(c) {
    const s = subjectById(c.subject);
    return `<a class="item" href="#/chat/${c.id}"><div class="grow"><div class="title">${esc(c.title)}</div>
      <div class="meta">${dot(s)} ${esc(s?.name || "Any subject")} · ${c.mode === "homework" ? "Homework" : "Tutor"} · ${relTime(c.updated)}</div></div>${icon("arrow")}</a>`;
  }

  // ───────────────────────── chat ─────────────────────────
  const gen = { busy: false, ctl: null, convoId: null, status: "" };
  const draft = { text: "" };

  function renderChat(convo, mode, subjectId) {
    if (!convo) {
      const sub = subjectById(subjectId)?.id || null;
      convo = { id: uid(), title: "", subject: sub, mode, messages: [], updated: Date.now(), isNew: true };
    }
    chatCtx = { convo };
    const s = subjectById(convo.subject);
    view.innerHTML = `<div class="chat" id="chat">
      <div class="chat-head">
        <div class="row grow" style="gap:12px">
          <h2 id="chat-title">${esc(convo.title || (convo.mode === "homework" ? "Homework help" : "Tutor"))}</h2>
          <div class="seg" style="padding:0; background:var(--sunken)">
            <button type="button" data-action="mode-set" data-mode="learn" aria-pressed="${convo.mode === 'learn'}">Learn</button>
            <button type="button" data-action="mode-set" data-mode="homework" aria-pressed="${convo.mode === 'homework'}">Homework</button>
            <button type="button" data-action="mode-set" data-mode="quick" aria-pressed="${convo.mode === 'quick'}">Quick</button>
            <button type="button" data-action="mode-set" data-mode="exam" aria-pressed="${convo.mode === 'exam'}">Exam</button>
            <button type="button" data-action="mode-set" data-mode="revision" aria-pressed="${convo.mode === 'revision'}">Revision</button>
          </div>
        </div>
        <select class="input" style="width:auto;min-height:32px;padding:4px 8px" id="chat-subject" aria-label="Subject">
          <option value="">Any subject</option>${SUBJECTS.map((x) => `<option value="${x.id}" ${x.id === convo.subject ? "selected" : ""}>${esc(x.name)}</option>`).join("")}
        </select>
        ${convo.isNew ? "" : `<button class="icon-btn" data-action="delete-convo" data-id="${convo.id}" aria-label="Delete this chat">${icon("trash")}</button>`}
        <a class="btn sm" href="#/${convo.mode === "homework" ? "homework" : "tutor"}" data-action="new-chat">${icon("plus")}New</a>
      </div>
      <div class="chat-scroll" id="scroll"><div class="chat-col" id="thread"></div></div>
      <div class="composer-wrap">
        <form class="composer" id="composer" autocomplete="off">
          <div class="attach-row" data-attach-row="chat">${attachHtml("chat")}</div>
          <textarea id="msg" rows="1" placeholder="${convo.mode === "homework" ? "Type the question, or add a photo of it" : `Ask anything${s ? " about " + esc(s.name) : ""}`}" aria-label="Your message">${esc(draft.text)}</textarea>
          <div class="row"><button type="button" class="icon-btn" data-action="attach" data-key="chat" aria-label="Add photos" title="Add photos">${icon("image")}</button>
            <input type="file" accept="image/*" multiple hidden data-change="files" data-key="chat"><span class="grow"></span>
            <button type="submit" class="send" id="send" aria-label="Send">${icon("send")}</button></div>
        </form>
        <div class="hint">Local AI can make mistakes. Check maths and facts against your textbook.</div>
      </div></div>`;
    renderThread();
    const ta = $("#msg");
    const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 180) + "px"; };
    ta.addEventListener("input", () => { draft.text = ta.value; grow(); syncSend(); });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#composer").requestSubmit(); } });
    $("#composer").addEventListener("submit", (e) => { e.preventDefault(); if (gen.busy) return; send(ta.value.trim()); });
    $("#chat-subject").addEventListener("change", (e) => { convo.subject = e.target.value || null; if (!convo.isNew) save(); renderThread(); });
    const chat = $("#chat");
    chat.addEventListener("dragover", (e) => { e.preventDefault(); chat.classList.add("dropzone-on"); });
    chat.addEventListener("dragleave", (e) => { if (e.target === chat) chat.classList.remove("dropzone-on"); });
    chat.addEventListener("drop", (e) => { e.preventDefault(); chat.classList.remove("dropzone-on"); addFiles("chat", e.dataTransfer.files); });
    ta.addEventListener("paste", (e) => { const f = Array.from(e.clipboardData?.files || []).filter((x) => x.type.startsWith("image/")); if (f.length) { e.preventDefault(); addFiles("chat", f); } });
    grow(); syncSend();
    if (!matchMedia("(max-width:760px)").matches) ta.focus();
    scrollDown(true);
    if (M.status !== "ok") loadModels().then(() => { if (chatCtx?.convo === convo) renderThread(); });
  }
  function syncSend() {
    const b = $("#send");
    if (!b) return;
    if (gen.busy && gen.convoId === chatCtx?.convo.id) {
      b.innerHTML = icon("stop"); b.setAttribute("aria-label", "Stop"); b.disabled = false; b.type = "button"; b.dataset.action = "stop";
    } else {
      b.innerHTML = icon("send"); b.setAttribute("aria-label", "Send"); b.type = "submit"; delete b.dataset.action;
      const loading = ATT.chat.items.some((x) => !x.rec);
      b.disabled = loading || !(draft.text.trim() || attImgs("chat").length);
    }
  }
  function scrollDown(force) {
    const sc = $("#scroll");
    if (sc && (force || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140)) sc.scrollTop = sc.scrollHeight;
  }
  function renderThread() {
    const th = $("#thread");
    if (!th || !chatCtx) return;
    const c = chatCtx.convo, s = subjectById(c.subject);
    if (!c.messages.length) {
      const hw = c.mode === "homework";
      const starters = hw ? ["Add a photo of a maths question", "Explain how to solve 3/4 + 1/6", "Check my answer: 25 × 12 = 300"] : (s ? s.starters : ["Explain fractions with an example", "Why do plants need sunlight?", "Help me understand the Indus Valley Civilisation"]);
      th.innerHTML = `<div class="chat-empty">
        <h1>${hw ? "Snap your homework" : "What are we learning?"}</h1>
        <p class="muted" style="margin-top:8px">${hw ? "Add a photo of the question or type it. You'll get the working step by step, plus a neat answer to copy into your notebook." : "Ask a question, or add a photo of a textbook page and ask about it."}</p>
        ${setupNotice() ? `<div style="margin-top:22px;text-align:left">${setupNotice()}</div>` : ""}
        <div class="starters">${starters.map((t) => `<button class="chip" data-action="starter" data-text="${esc(t)}">${esc(t)}</button>`).join("")}</div></div>`;
      return;
    }
    const msgs = c.messages;
    th.innerHTML = msgs.map((m, i) => messageHtml(m, i === msgs.length - 1)).join("") + unansweredHtml(c);
    hydrateImgs(th);
    scrollDown();
  }
  function unansweredHtml(c) {
    const last = c.messages[c.messages.length - 1];
    if (last?.role !== "user" || (gen.busy && gen.convoId === c.id)) return "";
    return `<div class="msg assistant"><div class="err" role="alert"><p>This question hasn't been answered yet.</p>
      <div class="row"><button class="btn sm" data-action="retry">${icon("refresh")}Get an answer</button></div></div></div>`;
  }
  function messageHtml(m, isLast) {
    if (m.role === "user") {
      return `<div class="msg user" id="m-${m.id}">${m.imgs?.length ? `<div class="msg-imgs">${m.imgs.map((id) => `<button data-action="open-img" data-id="${id}" aria-label="Open photo"><img data-img="${id}" alt="Photo you added"></button>`).join("")}</div>` : ""}
        ${m.content ? `<div class="bubble-user">${esc(m.content)}</div>` : ""}</div>`;
    }
    const busyHere = gen.busy && m.pending;
    let body = "";
    if (busyHere && !m.content) body = `<div class="thinking" role="status"><i></i><i></i><i></i><span data-status>${esc(gen.status || (m.imgs ? "Reading your photo…" : "Thinking…"))}</span></div>`;
    else body = `<div class="body ${busyHere ? "cursor" : ""}" data-body>${renderBody(m.content || "", m.id)}</div>`;
    let err = "";
    if (m.error) {
      const e = m.error;
      const others = M.models.filter((x) => x.name !== currentModel());
      err = `<div class="err" role="alert"><p><b>${m.content ? "The answer was cut off. " : ""}</b>${esc(e.message)}</p>
        ${e.detail ? `<p class="small" style="opacity:.8">${esc(e.detail)}</p>` : ""}
        <div class="row wrap"><button class="btn sm" data-action="retry" data-id="${m.id}">${icon("refresh")}Retry</button>
        ${e.code === "model_not_found" && others.length ? `<button class="btn sm" data-action="switch-model" data-model="${esc(others[0].name)}">Use ${esc(others[0].name)}</button>` : ""}
        ${["model_no_vision", "model_not_found", "out_of_memory"].includes(e.code) ? `<a class="btn sm" href="#/profile">Choose a model</a>` : ""}
        ${e.code === "model_not_found" ? `<button class="btn sm" data-action="copy-cmd" data-text="ollama pull ${esc(currentModel())}">${icon("copy")}Copy install command</button>` : ""}</div></div>`;
    }
    const acts = !m.pending && m.content ? `<div class="msg-actions">
      <button class="icon-btn" data-action="copy-msg" data-id="${m.id}" aria-label="Copy answer" title="Copy">${icon("copy")}</button>
      <button class="icon-btn" data-action="speak" data-id="${m.id}" aria-label="Read aloud" title="Read aloud">${icon("speaker")}</button>
      ${isLast && !m.error ? `<button class="icon-btn" data-action="regen" aria-label="Answer again" title="Answer again">${icon("refresh")}</button>` : ""}</div>` : "";
    const stopped = m.stopped ? `<p class="faint small">Stopped.</p>` : "";
    return `<div class="msg assistant" id="m-${m.id}"><div class="who">Snap Study${m.model ? `<span class="faint" style="font-weight:400">${esc(m.model)}</span>` : ""}</div>${body}${stopped}${err}${acts}</div>`;
  }

  async function send(text) {
    if (gen.busy) return toast("Wait for the current answer to finish, or tap Stop.");
    const c = chatCtx?.convo;
    if (!c) return;
    const imgs = attImgs("chat");
    if (!text && !imgs.length) return;
    if (!aiReady()) { toast(M.status === "down" ? "Ollama isn't running." : "Install a model first."); renderThread(); return; }
    if (imgs.length && !canSeePhotos(currentModel())) { toast(`“${currentModel()}” can't read photos. Choose another model in Profile.`, 4500); return; }
    const um = { id: uid(), role: "user", content: text || (c.mode === "homework" ? "Please solve this and show the working." : "Please explain what is in this photo."), imgs: imgs.map((i) => i.id), ts: Date.now() };
    c.messages.push(um);
    if (c.isNew) { c.title = (text || (imgs.length ? "Photo question" : "New chat")).replace(/\s+/g, " ").slice(0, 60); delete c.isNew; S.convos.unshift(c); S.convos = S.convos.slice(0, 200); }
    c.updated = Date.now(); bump(); saveNow();
    ATT.chat = newAttacher(); draft.text = "";
    const ta = $("#msg");
    if (ta) { ta.value = ""; ta.style.height = "auto"; }
    refreshAttach("chat");
    $("#chat-title").textContent = c.title;
    history.replaceState(null, "", "#/chat/" + c.id);
    generate(c);
  }

  // Build what the model sees: system prompt + recent turns. Failed/empty replies are never sent back.
  // Photos are attached only to the most recent photo message, so follow-ups still "see" the page without resending everything.
  async function buildMessages(c) {
    const hist = c.messages.filter((m) => m.role === "user" || (m.content && !m.error)).slice(-14);
    let lastImg = -1;
    hist.forEach((m, i) => { if (m.role === "user" && m.imgs?.length) lastImg = i; });
    const out = [{ role: "system", content: systemPrompt(subjectById(c.subject), c.mode) }];
    for (let i = 0; i < hist.length; i++) {
      const m = hist[i], o = { role: m.role, content: m.content };
      if (i === lastImg) {
        const data = (await Promise.all(m.imgs.map(imgFull))).filter(Boolean);
        if (data.length) o.images = data;
        else o.content += "\n(The photo is no longer available.)";
      }
      out.push(o);
    }
    return out;
  }

  async function generate(c) {
    if (gen.busy) return;
    const model = currentModel();
    const am = { id: uid(), role: "assistant", content: "", ts: Date.now(), pending: true, model, imgs: c.messages[c.messages.length - 1]?.imgs?.length || 0 };
    c.messages.push(am);
    gen.busy = true; gen.convoId = c.id; gen.status = ""; gen.ctl = new AbortController();
    const shown = () => chatCtx?.convo.id === c.id;
    if (shown()) { renderThread(); syncSend(); scrollDown(true); }
    let raf = 0;
    const paint = () => {
      raf = 0;
      const el = $(`#m-${am.id}`);
      if (!el) return;
      let b = $("[data-body]", el);
      if (!b) { renderThread(); b = $(`#m-${am.id} [data-body]`); }
      if (b) { b.innerHTML = renderBody(am.content, am.id); scrollDown(); }
    };
    try {
      const messages = await buildMessages(c);
      const text = await ask({
        model, messages, signal: gen.ctl.signal,
        onToken: (t, full) => { am.content = full; if (shown() && !raf) raf = requestAnimationFrame(paint); },
        onStatus: (s) => { gen.status = s; const n = $(`#m-${am.id} [data-status]`); if (n) n.textContent = s || "Thinking…"; },
      });
      am.content = text.trim();
      if (!am.content) am.error = { code: "empty", message: "The model sent back an empty answer.", retryable: true };
    } catch (e) {
      am.content = (e.partial || am.content || "").trim();
      if (e.code === "aborted") { if (am.content) am.stopped = true; else c.messages.splice(c.messages.indexOf(am), 1); }
      else am.error = { code: e.code || "unknown", message: e.message || "Something went wrong.", detail: e.detail, retryable: e.retryable };
    } finally {
      cancelAnimationFrame(raf);
      delete am.pending; gen.busy = false; gen.status = ""; gen.ctl = null;
      c.updated = Date.now(); saveNow();
      if (shown()) { renderThread(); syncSend(); scrollDown(true); }
    }
  }
  function dropLastAssistant(c) {
    const last = c.messages[c.messages.length - 1];
    if (last?.role === "assistant") c.messages.pop();
  }

  // ───────────────────────── notes ─────────────────────────
  const notesCtx = { busy: false, ctl: null, result: null, text: "", error: null, form: { subject: "science", topic: "", kind: "notes" } };
  function renderNotes() {
    const f = notesCtx.form;
    const saved = [...S.notes].sort((a, b) => b.ts - a.ts);
    view.innerHTML = `<div class="page narrow">
      <header class="page-head"><h1>Notes</h1><p>Turn a topic or a photo of a chapter into short revision notes or flashcards.</p></header>
      ${setupNotice()}
      <form id="notes-form" class="stack" autocomplete="off">
        <div class="field"><label for="n-sub">Subject</label><select class="input" id="n-sub">${SUBJECTS.map((s) => `<option value="${s.id}" ${s.id === f.subject ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="n-topic">Topic</label><input class="input" id="n-topic" placeholder="e.g. Photosynthesis, or Chapter 3: Fractions" value="${esc(f.topic)}"></div>
        <div class="field"><span class="label">Or add photos of the pages</span>
          <div class="attach-row" data-attach-row="notes">${attachHtml("notes")}</div>
          <div><button type="button" class="btn sm" data-action="attach" data-key="notes">${icon("image")}Add photos</button><input type="file" accept="image/*" multiple hidden data-change="files" data-key="notes"></div></div>
        <div class="row between wrap"><div class="seg" role="group" aria-label="Format">
          <button type="button" data-action="notes-kind" data-kind="notes" aria-pressed="${f.kind === "notes"}">Revision notes</button>
          <button type="button" data-action="notes-kind" data-kind="cards" aria-pressed="${f.kind === "cards"}">Flashcards</button></div>
          <button class="btn primary" type="submit" id="n-go" ${notesCtx.busy ? "disabled" : ""}>${notesCtx.busy ? "Writing…" : "Generate"}</button></div>
      </form>
      <div id="notes-out" class="section"></div>
      ${saved.length ? `<section class="section"><div class="section-head"><h2>Saved notes</h2></div><div class="list">${saved.slice(0, 6).map(noteItem).join("")}</div></section>` : ""}
    </div>`;
    $("#n-sub").addEventListener("change", (e) => (f.subject = e.target.value));
    $("#n-topic").addEventListener("input", (e) => (f.topic = e.target.value));
    $("#notes-form").addEventListener("submit", (e) => { e.preventDefault(); generateNotes(); });
    paintNotesOut();
  }
  const noteItem = (n) => `<a class="item" href="#/notes/${n.id}"><div class="grow"><div class="title">${esc(n.title)}</div><div class="meta">${dot(subjectById(n.subject))} ${esc(subjectById(n.subject)?.name || "")} · ${n.kind === "cards" ? "Flashcards" : "Notes"} · ${relTime(n.ts)}</div></div>${icon("arrow")}</a>`;
  function paintNotesOut() {
    const out = $("#notes-out");
    if (!out) return;
    if (notesCtx.busy && !notesCtx.text) out.innerHTML = `<div class="thinking"><i></i><i></i><i></i><span>${esc(notesCtx.status || "Writing your notes…")}</span><button type="button" class="btn sm ghost" data-action="notes-stop">Stop</button></div>`;
    else if (notesCtx.text) out.innerHTML = `<div class="prose ${notesCtx.busy ? "cursor" : ""}">${md(notesCtx.text)}</div>${notesCtx.busy ? "" : `<div class="row" style="margin-top:16px"><button class="btn sm" data-action="notes-copy">${icon("copy")}Copy</button>${notesCtx.saved ? '<span class="faint small">Saved to Library</span>' : ""}</div>`}`;
    else out.innerHTML = "";
    if (notesCtx.error && !notesCtx.busy) out.innerHTML += `<div style="margin-top:16px">${errBlock(notesCtx.error, "notes-retry")}</div>`;
  }
  function errBlock(e, retryAction) {
    return `<div class="err" role="alert"><p>${esc(e.message)}</p>${e.detail ? `<p class="small" style="opacity:.8">${esc(e.detail)}</p>` : ""}
      <div class="row wrap"><button class="btn sm" data-action="${retryAction}">${icon("refresh")}Retry</button>${["model_no_vision", "model_not_found", "out_of_memory"].includes(e.code) ? `<a class="btn sm" href="#/profile">Choose a model</a>` : ""}</div></div>`;
  }
  async function generateNotes() {
    if (notesCtx.busy) return;
    const f = notesCtx.form, imgs = attImgs("notes");
    if (!f.topic.trim() && !imgs.length) return toast("Type a topic or add a photo first.");
    if (!aiReady()) return toast(M.status === "down" ? "Ollama isn't running." : "Install a model first.");
    const model = currentModel();
    if (imgs.length && !canSeePhotos(model)) return toast(`“${model}” can't read photos. Choose another model in Profile.`, 4500);
    const sub = subjectById(f.subject);
    const task = f.kind === "cards"
      ? "Make 10 flashcards. For each, write **Q:** on one line, **A:** on the next line (one or two short sentences), and leave a blank line between cards."
      : "Write concise revision notes: a short intro, headings, bullet points, **bold** key terms with one-line definitions, a short \"Remember\" list of the most testable facts, and 3 practice questions at the end (no answers).";
    const user = { role: "user", content: `${task}\nSubject: ${sub.name}.${f.topic.trim() ? `\nTopic: ${f.topic.trim()}` : ""}${imgs.length ? "\nBase the content only on what is written in the attached photo(s)." : ""}` };
    if (imgs.length) user.images = (await Promise.all(imgs.map((i) => imgFull(i.id)))).filter(Boolean);
    Object.assign(notesCtx, { busy: true, text: "", error: null, saved: false, status: "", ctl: new AbortController() });
    renderNotes();
    try {
      const text = await ask({
        model, messages: [{ role: "system", content: systemPrompt(sub, "tutor") }, user], signal: notesCtx.ctl.signal,
        onToken: (t, full) => { notesCtx.text = full; if (section === "notes") paintNotesOut(); },
        onStatus: (s) => { notesCtx.status = s; if (section === "notes" && !notesCtx.text) paintNotesOut(); },
      });
      notesCtx.text = text.trim();
      if (!notesCtx.text) throw new ApiError("empty", "The model sent back empty notes.", true);
      const title = (f.topic.trim() || "Notes from photo").slice(0, 60);
      S.notes.unshift({ id: uid(), subject: f.subject, kind: f.kind, title, content: notesCtx.text, ts: Date.now() });
      notesCtx.saved = true; bump(); saveNow();
    } catch (e) {
      if (e.code === "aborted") notesCtx.text = (e.partial || "").trim();
      else notesCtx.error = { code: e.code, message: e.message, detail: e.detail, retryable: e.retryable };
    } finally {
      notesCtx.busy = false; notesCtx.ctl = null;
      if (section === "notes" && !location.hash.startsWith("#/notes/")) renderNotes();
    }
  }
  function renderNote(id) {
    const n = S.notes.find((x) => x.id === id);
    if (!n) { location.hash = "#/notes"; return; }
    section = "notes";
    view.innerHTML = `<div class="page narrow"><a class="link-btn" href="#/library?tab=notes">← Library</a>
      <header class="page-head" style="margin-top:14px"><div class="eyebrow">${dot(subjectById(n.subject))} ${esc(subjectById(n.subject)?.name || "")} · ${n.kind === "cards" ? "Flashcards" : "Revision notes"}</div><h1>${esc(n.title)}</h1></header>
      <div class="prose">${md(n.content)}</div>
      <div class="row" style="margin-top:24px"><button class="btn sm" data-action="copy-text" data-note="${n.id}">${icon("copy")}Copy</button><button class="btn sm danger" data-action="note-delete" data-id="${n.id}">${icon("trash")}Delete</button></div></div>`;
  }

  // ───────────────────────── quiz ─────────────────────────
  const quizCtx = { active: false, busy: false, ctl: null, form: { subject: "math", topic: "", n: 5 }, qs: null, i: 0, picked: null, score: 0, done: false, error: null };
  function renderQuiz() {
    quizCtx.active = true;
    const f = quizCtx.form, q = quizCtx;
    if (q.qs && !q.done) return renderQuestion();
    if (q.qs && q.done) return renderQuizDone();
    view.innerHTML = `<div class="page narrow">
      <header class="page-head"><h1>Quiz</h1><p>Practice with questions made from a topic or a photo of your textbook.</p></header>
      ${setupNotice()}
      <form id="quiz-form" class="stack" autocomplete="off">
        <div class="field"><label for="q-sub">Subject</label><select class="input" id="q-sub">${SUBJECTS.map((s) => `<option value="${s.id}" ${s.id === f.subject ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="q-topic">Topic</label><input class="input" id="q-topic" placeholder="e.g. Fractions, or The Indus Valley" value="${esc(f.topic)}"></div>
        <div class="field"><span class="label">Or add photos of the pages</span>
          <div class="attach-row" data-attach-row="quiz">${attachHtml("quiz")}</div>
          <div><button type="button" class="btn sm" data-action="attach" data-key="quiz">${icon("image")}Add photos</button><input type="file" accept="image/*" multiple hidden data-change="files" data-key="quiz"></div></div>
        <div class="row between wrap"><div class="seg" role="group" aria-label="Number of questions">
          ${[5, 10].map((n) => `<button type="button" data-action="quiz-n" data-n="${n}" aria-pressed="${f.n === n}">${n} questions</button>`).join("")}</div>
          <button class="btn primary" type="submit" ${q.busy ? "disabled" : ""}>${q.busy ? "Making your quiz…" : "Start quiz"}</button></div>
      </form>
      ${q.busy ? `<div class="stack section">${'<div class="skeleton" style="height:18px"></div>'.repeat(3)}<div><button class="btn sm ghost" data-action="quiz-stop">Cancel</button></div></div>` : ""}
      ${q.error ? `<div class="section">${errBlock(q.error, "quiz-retry")}</div>` : ""}
      ${S.quizzes.length ? `<section class="section"><div class="section-head"><h2>Past results</h2></div><div class="list">${[...S.quizzes].reverse().slice(0, 5).map(quizItem).join("")}</div></section>` : ""}
    </div>`;
    $("#q-sub").addEventListener("change", (e) => (f.subject = e.target.value));
    $("#q-topic").addEventListener("input", (e) => (f.topic = e.target.value));
    $("#quiz-form").addEventListener("submit", (e) => { e.preventDefault(); startQuiz(); });
  }
  const quizItem = (r) => `<div class="item"><div class="grow"><div class="title">${esc(r.title)}</div><div class="meta">${dot(subjectById(r.subject))} ${esc(subjectById(r.subject)?.name || "")} · ${relTime(r.ts)}</div></div><b>${r.score}/${r.total}</b></div>`;

  function parseQuiz(text) {
    let j;
    try { j = JSON.parse(text); }
    catch (e) { const a = text.indexOf("{"), b = text.lastIndexOf("}"); if (a < 0 || b <= a) return []; try { j = JSON.parse(text.slice(a, b + 1)); } catch (e2) { return []; } }
    const arr = Array.isArray(j) ? j : j.questions;
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => {
      const opts = Array.isArray(x?.options) ? x.options.map((o) => String(o).replace(/^\s*[A-Da-d][.)]\s+/, "").trim()).filter(Boolean) : [];
      let a = x?.answer;
      if (typeof a === "string") a = /^[A-Da-d]$/.test(a.trim()) ? a.trim().toUpperCase().charCodeAt(0) - 65 : opts.indexOf(a.trim());
      return { q: String(x?.q || x?.question || "").trim(), options: opts.slice(0, 4), answer: Number.isInteger(a) ? a : -1, explanation: String(x?.explanation || "").trim() };
    }).filter((x) => x.q && x.options.length === 4 && x.answer >= 0 && x.answer < 4);
  }
  async function startQuiz() {
    const q = quizCtx;
    if (q.busy) return;
    const f = q.form, imgs = attImgs("quiz");
    if (!f.topic.trim() && !imgs.length) return toast("Type a topic or add a photo first.");
    if (!aiReady()) return toast(M.status === "down" ? "Ollama isn't running." : "Install a model first.");
    const model = currentModel();
    if (imgs.length && !canSeePhotos(model)) return toast(`“${model}” can't read photos. Choose another model in Profile.`, 4500);
    const sub = subjectById(f.subject);
    const user = { role: "user", content: `Write ${f.n} multiple-choice questions for a Class 6 student.\nSubject: ${sub.name}.${f.topic.trim() ? `\nTopic: ${f.topic.trim()}` : ""}${imgs.length ? "\nBase every question only on what is written in the attached photo(s)." : ""}
Reply with ONLY JSON in exactly this shape:
{"questions":[{"q":"question text","options":["first","second","third","fourth"],"answer":0,"explanation":"one short sentence"}]}
Each question has exactly 4 options without letter prefixes. "answer" is the index (0 to 3) of the correct option. Only one option may be correct.` };
    if (imgs.length) user.images = (await Promise.all(imgs.map((i) => imgFull(i.id)))).filter(Boolean);
    Object.assign(q, { busy: true, error: null, ctl: new AbortController() });
    renderQuiz();
    try {
      let list = [];
      for (let tries = 0; tries < 2 && list.length < Math.min(3, f.n); tries++) {
        const text = await ask({ model, messages: [{ role: "system", content: systemPrompt(sub, "tutor") }, user], format: "json", signal: q.ctl.signal });
        list = parseQuiz(text);
      }
      if (list.length < Math.min(3, f.n)) throw new ApiError("bad_quiz", "The model didn't write a usable quiz. Try again, or try a bigger model in Profile.", true);
      Object.assign(q, { qs: list.slice(0, f.n), i: 0, picked: null, score: 0, done: false, title: (f.topic.trim() || "Photo quiz").slice(0, 60), subject: f.subject });
      ATT.quiz = newAttacher();
    } catch (e) {
      if (e.code !== "aborted") q.error = { code: e.code, message: e.message, detail: e.detail, retryable: e.retryable };
    } finally {
      q.busy = false; q.ctl = null;
      if (q.active) renderQuiz();
    }
  }
  function renderQuestion() {
    const q = quizCtx, cur = q.qs[q.i], L = ["A", "B", "C", "D"];
    view.innerHTML = `<div class="page narrow">
      <div class="row between"><span class="faint small">Question ${q.i + 1} of ${q.qs.length}</span><button class="link-btn" data-action="quiz-new">Quit</button></div>
      <div class="progress" style="margin:10px 0 28px"><i style="width:${(q.i / q.qs.length) * 100}%"></i></div>
      <h2 style="margin-bottom:20px">${esc(cur.q)}</h2>
      <div class="stack" style="gap:8px">${cur.options.map((o, i) => {
        const cls = q.picked === null ? "" : i === cur.answer ? "right" : i === q.picked ? "wrong" : "";
        return `<button class="q-opt ${cls}" data-action="quiz-pick" data-i="${i}" ${q.picked !== null ? "disabled" : ""}><span class="k">${q.picked !== null && cls === "right" ? icon("check") : L[i]}</span><span>${esc(o)}</span></button>`;
      }).join("")}</div>
      ${q.picked !== null ? `<div class="explain" style="margin-top:16px" role="status"><b>${q.picked === cur.answer ? "Correct." : "Not quite."}</b> ${q.picked !== cur.answer ? `The answer is ${L[cur.answer]}. ` : ""}${esc(cur.explanation)}</div>
        <div class="row end" style="margin-top:16px"><button class="btn primary" data-action="quiz-next">${q.i + 1 === q.qs.length ? "See results" : "Next question"}</button></div>` : ""}
    </div>`;
  }
  function renderQuizDone() {
    const q = quizCtx, pct = Math.round((q.score / q.qs.length) * 100);
    view.innerHTML = `<div class="page narrow" style="text-align:center;padding-top:72px">
      <div class="eyebrow">Quiz complete</div><div class="score">${q.score}<span class="faint">/${q.qs.length}</span></div>
      <p class="muted" style="margin:12px 0 28px">${pct >= 80 ? "Great work. You know this topic well." : pct >= 50 ? "Good effort. Review the ones you missed and try again." : "This one is tricky. Ask the tutor to explain it, then try again."}</p>
      <div class="row" style="justify-content:center"><button class="btn primary" data-action="quiz-again">Try the same topic again</button><button class="btn" data-action="quiz-new">New quiz</button>
        <a class="btn" href="#/tutor?subject=${esc(q.subject)}">Ask the tutor</a></div></div>`;
  }

  // ───────────────────────── library ─────────────────────────
  async function renderLibrary(tab) {
    const tabs = [["chats", "Chats"], ["notes", "Notes"], ["quizzes", "Quizzes"], ["photos", "Photos"]];
    view.innerHTML = `<div class="page"><header class="page-head"><h1>Library</h1><p>Everything you've asked, written and uploaded. Stored only in this browser.</p></header>
      <div class="seg" style="margin-bottom:20px" role="tablist">${tabs.map(([id, l]) => `<button role="tab" data-action="lib-tab" data-tab="${id}" aria-pressed="${id === tab}">${l}</button>`).join("")}</div><div id="lib-body"></div></div>`;
    const body = $("#lib-body");
    const empty = (ic, t, d, href, label) => `<div class="empty list"><div class="mark">${icon(ic)}</div><h3>${t}</h3><p class="small">${d}</p>${href ? `<a class="btn" href="${href}">${label}</a>` : ""}</div>`;
    if (tab === "chats") {
      const cs = [...S.convos].sort((a, b) => b.updated - a.updated);
      body.innerHTML = cs.length ? `<div class="list">${cs.map((c) => `<div class="item" style="padding:0"><a class="item grow" href="#/chat/${c.id}" style="min-width:0"><div class="grow" style="min-width:0"><div class="title">${esc(c.title)}</div><div class="meta">${dot(subjectById(c.subject))} ${esc(subjectById(c.subject)?.name || "Any subject")} · ${c.mode === "homework" ? "Homework" : "Tutor"} · ${relTime(c.updated)}</div></div></a>
        <button class="icon-btn actions" style="margin-right:10px" data-action="delete-convo" data-id="${c.id}" aria-label="Delete chat">${icon("trash")}</button></div>`).join("")}</div>`
        : empty("chat", "No conversations yet", "Ask the tutor something and it will be saved here.", "#/tutor", "Ask the tutor");
    } else if (tab === "notes") {
      const ns = [...S.notes].sort((a, b) => b.ts - a.ts);
      body.innerHTML = ns.length ? `<div class="list">${ns.map(noteItem).join("")}</div>` : empty("notes", "No notes yet", "Generated notes and flashcards are saved here.", "#/notes", "Make notes");
    } else if (tab === "quizzes") {
      body.innerHTML = S.quizzes.length ? `<div class="list">${[...S.quizzes].reverse().map(quizItem).join("")}</div>` : empty("quiz", "No quizzes taken", "Your scores will appear here.", "#/quiz", "Take a quiz");
    } else {
      body.innerHTML = `<div class="thumbs">${'<div class="thumb skeleton"></div>'.repeat(4)}</div>`;
      const list = await imgList();
      if ($("#lib-body") !== body) return;
      body.innerHTML = list.length ? `<div class="thumbs">${list.map((m) => `<div class="thumb"><button style="all:unset;cursor:pointer;display:block;width:100%;height:100%" data-action="open-img" data-id="${m.id}" aria-label="Open ${esc(m.name)}"><img src="${m.thumb}" alt="${esc(m.name)}"></button>
        <button class="icon-btn del" data-action="photo-delete" data-id="${m.id}" aria-label="Delete photo">${icon("trash")}</button></div>`).join("")}</div><p class="faint small" style="margin-top:12px">Open a photo, then choose “Ask about this photo”.</p>`
        : empty("image", "No photos yet", "Photos you add to questions are kept here.", "#/homework", "Add a photo");
    }
  }

  // ───────────────────────── profile ─────────────────────────
  function renderProfile() {
    const p = S.profile, cur = currentModel();
    const seg = (key, vals) => `<div class="seg" role="group">${vals.map((v) => `<button type="button" data-action="set" data-key="${key}" data-val="${v}" aria-pressed="${p[key] === v}">${v === "auto" ? "Auto" : v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>`;
    view.innerHTML = `<div class="page narrow"><header class="page-head"><h1>Profile</h1><p>These settings shape how the tutor talks to you.</p></header>
      <div class="stack" style="gap:24px">
        <div class="field"><label for="p-name">Your name</label><input class="input" id="p-name" maxlength="30" value="${esc(p.name)}" placeholder="Optional"></div>
        <div class="field"><label for="p-grade">Your grade/class</label><input class="input" id="p-grade" value="${esc(p.grade)}" placeholder="e.g. Class 6"></div>
        <div class="field"><span class="label">Board</span>${seg("board", ["CBSE", "ICSE", "State"])}</div>
        <div class="field"><span class="label">Explanation language</span>${seg("language", ["English", "Hindi", "Marathi"])}</div>
        <div class="field"><span class="label">Appearance</span>${seg("theme", ["auto", "light", "dark"])}</div>
        <div class="field"><label for="p-model">AI model</label>
          ${M.models.length ? `<select class="input" id="p-model" data-change="model">${M.models.map((m) => `<option value="${esc(m.name)}" ${m.name === cur ? "selected" : ""}>${esc(m.name)} — ${m.vision === true ? "reads photos" : m.vision === false ? "text only" : "photo support unknown"}</option>`).join("")}</select>`
            : setupNotice() || `<div class="skeleton" style="height:38px"></div>`}
          <div class="row"><button class="btn sm" data-action="setup-check">${icon("refresh")}Refresh list</button>
          <span class="faint small">Photo questions need a model marked “reads photos”.</span></div></div>
        <div class="field" style="border-top:1px solid var(--line);padding-top:24px"><span class="label">Your data</span>
          <p class="muted small">Chats, notes, quiz scores and photos are saved only in this browser. Nothing is sent anywhere except to Ollama on this computer.</p>
          <div><button class="btn sm danger" data-action="clear-data">${icon("trash")}Delete all my data</button></div></div>
      </div></div>`;
    $("#p-name").addEventListener("input", (e) => { S.profile.name = e.target.value.trim(); save(); renderNav(); });
    $("#p-grade").addEventListener("input", (e) => { S.profile.grade = e.target.value.trim(); save(); });
  }

  // ───────────────────────── events ─────────────────────────
  let speakingId = null;
  const actions = {
    "setup-check": async () => { await loadModels(); route(); },
    "copy-cmd": (el) => copy(el.dataset.text, "Command copied"),
    "subject-start": (el) => (location.hash = "#/tutor?subject=" + el.dataset.subject),
    "new-chat": (el, e) => {
      // Same hash as the current page when starting from a blank chat: force a fresh render.
      if (chatCtx?.convo.isNew || location.hash === el.getAttribute("href")) { e.preventDefault(); ATT.chat = newAttacher(); draft.text = ""; const m = chatCtx?.convo.mode || "tutor"; renderChat(null, m); }
      else ATT.chat = newAttacher();
    },
    attach: (el) => $(`input[data-key="${el.dataset.key}"]`, el.parentElement)?.click(),
    "mode-set": (el) => {
      const m = el.dataset.mode;
      const c = chatCtx?.convo;
      if (!c) return;
      c.mode = m;
      save();
      renderChat(c);
    },
    stop: () => gen.ctl?.abort(),
    starter: (el) => { if (gen.busy) return; send(el.dataset.text); },
    retry: () => {
      if (gen.busy) return;
      const c = chatCtx?.convo;
      if (!c) return;
      dropLastAssistant(c); generate(c);
    },
    regen: () => { if (gen.busy) return; const c = chatCtx?.convo; if (c) { dropLastAssistant(c); generate(c); } },
    "copy-msg": (el) => { const m = chatCtx?.convo.messages.find((x) => x.id === el.dataset.id); if (m) copy(m.content, "Answer copied"); },
    "copy-notebook": (el) => { const m = chatCtx?.convo.messages.find((x) => x.id === el.dataset.id); if (m) copy(plain(notebookOf(m.content)), "Notebook answer copied"); },
    speak: (el) => {
      const m = chatCtx?.convo.messages.find((x) => x.id === el.dataset.id);
      if (!m || !("speechSynthesis" in window)) return toast("Reading aloud isn't supported in this browser.");
      const was = speakingId === m.id;
      speechSynthesis.cancel(); speakingId = null;
      if (was) return;
      const u = new SpeechSynthesisUtterance(plain(m.content));
      u.lang = { Hindi: "hi-IN", Marathi: "mr-IN" }[S.profile.language] || "en-IN";
      u.onend = u.onerror = () => { speakingId = null; };
      speakingId = m.id; speechSynthesis.speak(u);
    },
    "switch-model": (el) => { S.profile.model = el.dataset.model; saveNow(); renderNav(); toast("Switched to " + el.dataset.model); const c = chatCtx?.convo; if (c && !gen.busy) { dropLastAssistant(c); generate(c); } },
    "open-img": async (el) => {
      const d = $("#lightbox"), full = await imgFull(el.dataset.id);
      if (!full) return toast("This photo is no longer stored.");
      $("img", d).src = full; d.dataset.id = el.dataset.id; d.showModal();
    },
    "close-lightbox": () => $("#lightbox").close(),
    "photo-ask": async () => {
      const d = $("#lightbox"), id = d.dataset.id, meta = await imgMeta(id);
      d.close();
      if (!meta) return toast("This photo is no longer stored.");
      if (!ATT.chat.items.some((x) => x.id === id) && ATT.chat.items.length < M.maxImages) ATT.chat.items.push({ id, rec: { id, thumb: meta.thumb, name: meta.name } });
      location.hash = "#/homework";
    },
    "delete-convo": async (el) => {
      if (!(await confirmDialog("Delete this chat? This can't be undone."))) return;
      if (gen.busy && gen.convoId === el.dataset.id) gen.ctl?.abort();
      S.convos = S.convos.filter((c) => c.id !== el.dataset.id); saveNow();
      if (location.hash.startsWith("#/chat/")) location.hash = "#/library"; else route();
    },
    "notes-kind": (el) => { notesCtx.form.kind = el.dataset.kind; $$('[data-action="notes-kind"]').forEach((b) => b.setAttribute("aria-pressed", String(b === el))); },
    "notes-stop": () => notesCtx.ctl?.abort(),
    "notes-retry": () => generateNotes(),
    "notes-copy": () => copy(notesCtx.text, "Notes copied"),
    "copy-text": (el) => { const n = S.notes.find((x) => x.id === el.dataset.note); if (n) copy(n.content, "Notes copied"); },
    "note-delete": async (el) => { if (!(await confirmDialog("Delete these notes?"))) return; S.notes = S.notes.filter((n) => n.id !== el.dataset.id); saveNow(); location.hash = "#/library?tab=notes"; },
    "quiz-n": (el) => { quizCtx.form.n = Number(el.dataset.n); $$('[data-action="quiz-n"]').forEach((b) => b.setAttribute("aria-pressed", String(b === el))); },
    "quiz-stop": () => quizCtx.ctl?.abort(),
    "quiz-retry": () => startQuiz(),
    "quiz-pick": (el) => { const q = quizCtx; if (q.picked !== null) return; q.picked = Number(el.dataset.i); if (q.picked === q.qs[q.i].answer) q.score++; renderQuestion(); },
    "quiz-next": () => {
      const q = quizCtx;
      if (q.i + 1 < q.qs.length) { q.i++; q.picked = null; return renderQuestion(); }
      q.done = true;
      S.quizzes.push({ id: uid(), subject: q.subject, title: q.title, score: q.score, total: q.qs.length, ts: Date.now() }); bump(); saveNow();
      renderQuizDone();
    },
    "quiz-again": () => { const q = quizCtx; q.qs = null; q.done = false; startQuiz(); },
    "quiz-new": () => { Object.assign(quizCtx, { qs: null, done: false, error: null }); renderQuiz(); },
    "lib-tab": (el) => { history.replaceState(null, "", "#/library?tab=" + el.dataset.tab); renderLibrary(el.dataset.tab); },
    "photo-delete": async (el) => { if (!(await confirmDialog("Delete this photo?"))) return; await imgRemove(el.dataset.id); renderLibrary("photos"); },
    set: (el) => { S.profile[el.dataset.key] = el.dataset.val; saveNow(); if (el.dataset.key === "theme") applyTheme(); $$(`[data-action="set"][data-key="${el.dataset.key}"]`).forEach((b) => b.setAttribute("aria-pressed", String(b === el))); },
    "clear-data": async () => {
      if (!(await confirmDialog("Delete all chats, notes, quiz scores, photos and settings from this browser?", "Delete everything"))) return;
      gen.ctl?.abort(); localStorage.removeItem(KEY); await imgClear(); S = defaults(); ATT.chat = newAttacher(); applyTheme(); toast("All data deleted"); location.hash = "#/"; route();
    },
  };
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (fn) fn(el, e);
  });
  // Photo "ask about" button lives in the lightbox
  $("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") e.target.close(); });
  document.addEventListener("change", async (e) => {
    const el = e.target;
    if (el.dataset.change === "files") { await addFiles(el.dataset.key, el.files); el.value = ""; }
    else if (el.dataset.change === "model") { S.profile.model = el.value; saveNow(); renderNav(); toast("Model changed"); }
  });
  function applyTheme() { const t = S.profile.theme; if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }

  // ───────────────────────── boot ─────────────────────────
  applyTheme();
  renderNav();
  route();
  loadModels().then(() => { if (!gen.busy && ["home", "profile", "tutor", "homework"].includes(section) && !ATT.chat.items.length && !draft.text) route(); });
})();

const SHEET_ID = "1T3YmKwIfk_dQlfOoin5o0GP-H_yoWtfLCmte5y7520M";
const SHEET_GID = "1557122712";
const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx7A8wpONCyIVZgn7hyw4BBhYb5gdmgTERja5J0RkWeenDJJ5HuvBQyiZaDjp_eaSRR/exec";
const REFRESH_MS = 30000;
const PHOTO_ROTATE_MS = 7000;

const deck = document.getElementById("deck");
const statusEl = document.getElementById("status");
const counter = document.getElementById("counter");
const dotsEl = document.getElementById("dots");
const prevBtn = document.querySelector(".prev");
const nextBtn = document.querySelector(".next");
const photoLeft = document.getElementById("photoLeft");
const photoRight = document.getElementById("photoRight");

let cards = [];
let currentIndex = 0;
let lastFingerprint = "";
let activeLoader = null;
let photoIds = [];
let photoIndex = 0;
let photoRotationBusy = false;

const photoCache = new Map();

function parseSignature(raw) {
  let text = String(raw || "").trim();
  if (!text) return { message: "", name: "" };
  const lines = text.split(/\r?\n/);
  const lastLine = lines[lines.length - 1].trim();
  const m = lastLine.match(/^[\-–—]\s*(.{1,80})$/);
  if (m) {
    lines.pop();
    return { message: lines.join("\n").trim(), name: m[1].trim() };
  }
  const inline = text.match(/([\s\S]*?)(?:\s+[\-–—])\s*([^\n\-–—]{1,80})$/);
  return inline && inline[1].trim().length > 8
    ? { message: inline[1].trim(), name: inline[2].trim() }
    : { message: text, name: "Anonymous" };
}

function formatDate(v) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function escapeHTML(v) {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function gvizTableToRows(t) {
  const h = (t.cols || []).map(c => (c.label || "").trim());
  const r = [h];
  for (const row of t.rows || []) r.push((row.c || []).map(c => c ? (c.f ?? c.v ?? "") : ""));
  return r;
}

function driveFileIds(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  const ids = [];
  const patterns = [
    /\/d\/([-\w]{20,})/g,
    /[?&]id=([-\w]{20,})/g,
    /\/file\/d\/([-\w]{20,})/g,
    /open\?id=([-\w]{20,})/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(s)) !== null) ids.push(match[1]);
  }
  if (!ids.length && /^[-\w]{20,}$/.test(s)) ids.push(s);
  return [...new Set(ids)];
}

function rowsToData(rows) {
  if (rows.length < 2) return { memories: [], photos: [] };
  const h = rows[0].map(x => String(x).trim().toLowerCase());
  const ti = h.findIndex(x => x.includes("timestamp"));
  let mi = h.findIndex(x => x.includes("write your message") || x.includes("write here") || x.includes("message"));
  if (mi < 0) mi = h.findIndex((_, i) => i !== ti);
  const pi = h.findIndex(x => x.includes("upload") && (x.includes("image") || x.includes("photo") || x.includes("picture")));
  const memories = [];
  const photos = [];

  rows.slice(1).forEach((row, i) => {
    const p = parseSignature(row[mi] || "");
    if (p.message) {
      memories.push({ id: i + 1, message: p.message, name: p.name, date: ti >= 0 ? formatDate(row[ti]) : "" });
    }
    if (pi >= 0) photos.push(...driveFileIds(row[pi]));
  });

  return { memories, photos: [...new Set(photos)] };
}

function render(memories) {
  const fp = JSON.stringify(memories);
  if (fp === lastFingerprint) return;
  lastFingerprint = fp;
  deck.innerHTML = "";
  dotsEl.innerHTML = "";

  if (!memories.length) {
    cards = [];
    statusEl.textContent = "No messages yet — the first one gets the first card.";
    counter.textContent = "0 / 0";
    updateButtons();
    return;
  }

  const old = Math.min(currentIndex, memories.length - 1);
  memories.forEach((item, index) => {
    const a = document.createElement("article");
    a.className = "letter-card";
    a.innerHTML = `<span class="card-number">LETTER ${String(index + 1).padStart(2, "0")}</span><p class="message">${escapeHTML(item.message)}</p><div class="signature">— ${escapeHTML(item.name)}</div>${item.date ? `<span class="date">${escapeHTML(item.date)}</span>` : ""}`;
    deck.appendChild(a);
    const d = document.createElement("span");
    d.className = "dot";
    dotsEl.appendChild(d);
  });

  cards = [...deck.querySelectorAll(".letter-card")];
  statusEl.textContent = "";
  statusEl.classList.remove("error");
  currentIndex = old;
  requestAnimationFrame(() => {
    cards[currentIndex]?.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
    updateActive();
  });
}

function detectMime(bytes) {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  const brand = String.fromCharCode(...bytes.slice(8, 12));
  if (["heic", "heix", "hevc", "hevx", "mif1"].includes(brand)) return "image/heic";
  return "application/octet-stream";
}

async function fetchPhotoUrl(id) {
  if (photoCache.has(id)) return photoCache.get(id);
  const promise = (async () => {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${APP_SCRIPT_URL}?id=${encodeURIComponent(id)}`, { cache: "default", redirect: "follow" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const base64 = (await res.text()).trim();
        if (!base64 || base64.startsWith("ERROR:") || base64.startsWith("Missing")) throw new Error(base64 || "Empty image");
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: detectMime(bytes) });
        return URL.createObjectURL(blob);
      } catch (err) {
        lastError = err;
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 400 * attempt));
      }
    }
    throw lastError || new Error("Photo failed to load");
  })();

  photoCache.set(id, promise);
  try {
    return await promise;
  } catch (err) {
    photoCache.delete(id);
    throw err;
  }
}

function waitForImage(img, url) {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.onload = () => resolve(url);
    probe.onerror = () => reject(new Error("Browser could not decode image"));
    probe.src = url;
  });
}

async function setPhotoWhenReady(img, id) {
  const rail = img.closest(".photo-rail");
  rail?.classList.add("has-photo");
  try {
    const url = await fetchPhotoUrl(id);
    await waitForImage(img, url);
    img.src = url;
    rail?.classList.add("ready");
    return true;
  } catch (err) {
    console.error("Image load failed", id, err);
    if (!img.src) rail?.classList.remove("ready");
    return false;
  }
}

async function updatePhotos() {
  if (photoRotationBusy) return;
  if (!photoIds.length) {
    document.querySelectorAll(".photo-rail").forEach(x => x.classList.remove("ready", "has-photo"));
    return;
  }

  photoRotationBusy = true;
  try {
    const n = photoIds.length;

    // Right side moves forward from the first photo: 1, 2, 3, 4...
    const rightIndex = photoIndex % n;

    // Left side starts from the end and moves backward: n, n-1, n-2...
    const leftIndex = (n - 1 - (photoIndex % n) + n) % n;

    await Promise.all([
      setPhotoWhenReady(photoLeft, photoIds[leftIndex]),
      setPhotoWhenReady(photoRight, photoIds[rightIndex])
    ]);

    photoIndex = (photoIndex + 1) % n;
  } finally {
    photoRotationBusy = false;
  }
}

function updateActive() {
  if (!cards.length) return;
  const center = deck.scrollLeft + deck.clientWidth / 2;
  let nearest = 0;
  let dist = Infinity;
  cards.forEach((c, i) => {
    const x = Math.abs(c.offsetLeft + c.offsetWidth / 2 - center);
    if (x < dist) {
      dist = x;
      nearest = i;
    }
  });
  currentIndex = nearest;
  counter.textContent = `${currentIndex + 1} / ${cards.length}`;
  [...dotsEl.children].forEach((d, i) => d.classList.toggle("active", i === currentIndex));
  updateButtons();
}

function updateButtons() {
  prevBtn.disabled = !cards.length || currentIndex <= 0;
  nextBtn.disabled = !cards.length || currentIndex >= cards.length - 1;
}

function goTo(i) {
  if (!cards.length) return;
  currentIndex = Math.max(0, Math.min(i, cards.length - 1));
  cards[currentIndex].scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
}

prevBtn.addEventListener("click", () => goTo(currentIndex - 1));
nextBtn.addEventListener("click", () => goTo(currentIndex + 1));

let scrollTimer;
deck.addEventListener("scroll", () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(updateActive, 70);
}, { passive: true });

deck.addEventListener("keydown", e => {
  if (e.key === "ArrowRight") {
    e.preventDefault();
    goTo(currentIndex + 1);
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    goTo(currentIndex - 1);
  }
});

window.miloniSheetCallback = function(response) {
  try {
    if (!response || response.status !== "ok" || !response.table) throw new Error("Unreadable sheet");
    const data = rowsToData(gvizTableToRows(response.table));
    render(data.memories);
    const changed = JSON.stringify(data.photos) !== JSON.stringify(photoIds);
    photoIds = data.photos;
    if (changed) {
      photoIndex = 0;
      updatePhotos();
    }
  } catch (e) {
    console.error(e);
    statusEl.classList.add("error");
    statusEl.textContent = "The letters couldn't load. Double-check that the Sheet is shared as Anyone with the link → Viewer.";
  } finally {
    if (activeLoader) {
      activeLoader.remove();
      activeLoader = null;
    }
  }
};

function loadMemories() {
  if (activeLoader) {
    activeLoader.remove();
    activeLoader = null;
  }
  const s = document.createElement("script");
  const q = encodeURIComponent("select *");
  s.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${SHEET_GID}&tqx=responseHandler:miloniSheetCallback&tq=${q}&headers=1&cacheBust=${Date.now()}`;
  s.onerror = () => {
    statusEl.classList.add("error");
    statusEl.textContent = "The letters couldn't load from Google Sheets.";
    s.remove();
    activeLoader = null;
  };
  activeLoader = s;
  document.body.appendChild(s);
}

loadMemories();
setInterval(loadMemories, REFRESH_MS);
setInterval(updatePhotos, PHOTO_ROTATE_MS);

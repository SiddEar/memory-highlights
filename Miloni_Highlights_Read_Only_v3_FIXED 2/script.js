
const SHEET_ID = "1T3YmKwIfk_dQlfOoin5o0GP-H_yoWtfLCmte5y7520M";
const SHEET_GID = "1557122712";
const REFRESH_MS = 30000;

const deck = document.getElementById("deck");
const statusEl = document.getElementById("status");
const counter = document.getElementById("counter");
const dotsEl = document.getElementById("dots");
const prevBtn = document.querySelector(".prev");
const nextBtn = document.querySelector(".next");

let cards = [];
let currentIndex = 0;
let lastFingerprint = "";
let activeLoader = null;

function parseSignature(raw) {
  let text = String(raw || "").trim();
  if (!text) return { message: "", name: "" };

  const lines = text.split(/\r?\n/);
  const lastLine = lines[lines.length - 1].trim();

  // Best format: final line is "-Name" or "— Name"
  const signatureMatch = lastLine.match(/^[\-–—]\s*(.{1,80})$/);

  if (signatureMatch) {
    lines.pop();
    return {
      message: lines.join("\n").trim(),
      name: signatureMatch[1].trim()
    };
  }

  // Fallback: catches "message text -Name" if they forget the line break.
  const inlineMatch = text.match(/([\s\S]*?)(?:\s+[\-–—])\s*([^\n\-–—]{1,80})$/);
  if (inlineMatch && inlineMatch[1].trim().length > 8) {
    return {
      message: inlineMatch[1].trim(),
      name: inlineMatch[2].trim()
    };
  }

  return { message: text, name: "Anonymous" };
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function gvizTableToRows(table) {
  const headers = (table.cols || []).map(col => (col.label || "").trim());
  const rows = [headers];

  for (const row of table.rows || []) {
    rows.push((row.c || []).map(cell => {
      if (!cell) return "";
      return cell.f ?? cell.v ?? "";
    }));
  }
  return rows;
}

function rowsToMemories(rows) {
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  let timestampIndex = headers.findIndex(h => h.includes("timestamp"));

  let messageIndex = headers.findIndex(h =>
    h.includes("write your message") ||
    h.includes("write here") ||
    h.includes("message")
  );

  if (messageIndex < 0) {
    messageIndex = headers.findIndex((_, i) => i !== timestampIndex);
  }

  return rows.slice(1).map((row, i) => {
    const raw = row[messageIndex] || "";
    const parsed = parseSignature(raw);

    return {
      id: i + 1,
      message: parsed.message,
      name: parsed.name,
      date: timestampIndex >= 0 ? formatDate(row[timestampIndex]) : ""
    };
  }).filter(item => item.message);
}

function render(memories) {
  const fingerprint = JSON.stringify(memories);
  if (fingerprint === lastFingerprint) return;
  lastFingerprint = fingerprint;

  deck.innerHTML = "";
  dotsEl.innerHTML = "";

  if (!memories.length) {
    cards = [];
    statusEl.textContent = "No messages yet — the first one gets the first card.";
    statusEl.classList.remove("error");
    counter.textContent = "0 / 0";
    updateButtons();
    return;
  }

  const previousIndex = Math.min(currentIndex, memories.length - 1);

  memories.forEach((item, index) => {
    const article = document.createElement("article");
    article.className = "letter-card";
    article.innerHTML = `
      <span class="card-number">LETTER ${String(index + 1).padStart(2, "0")}</span>
      <p class="message">${escapeHTML(item.message)}</p>
      <div class="signature">— ${escapeHTML(item.name)}</div>
      ${item.date ? `<span class="date">${escapeHTML(item.date)}</span>` : ""}
    `;
    deck.appendChild(article);

    const dot = document.createElement("span");
    dot.className = "dot";
    dotsEl.appendChild(dot);
  });

  cards = Array.from(deck.querySelectorAll(".letter-card"));
  statusEl.textContent = "";
  statusEl.classList.remove("error");
  currentIndex = previousIndex;

  requestAnimationFrame(() => {
    cards[currentIndex]?.scrollIntoView({
      behavior: "auto",
      inline: "center",
      block: "nearest"
    });
    updateActive();
  });
}

function updateActive() {
  if (!cards.length) return;

  const deckCenter = deck.scrollLeft + deck.clientWidth / 2;
  let nearest = 0;
  let nearestDistance = Infinity;

  cards.forEach((card, i) => {
    const cardCenter = card.offsetLeft + card.offsetWidth / 2;
    const distance = Math.abs(cardCenter - deckCenter);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = i;
    }
  });

  currentIndex = nearest;
  counter.textContent = `${currentIndex + 1} / ${cards.length}`;

  Array.from(dotsEl.children).forEach((dot, i) => {
    dot.classList.toggle("active", i === currentIndex);
  });

  updateButtons();
}

function updateButtons() {
  prevBtn.disabled = !cards.length || currentIndex <= 0;
  nextBtn.disabled = !cards.length || currentIndex >= cards.length - 1;
}

function goTo(index) {
  if (!cards.length) return;
  currentIndex = Math.max(0, Math.min(index, cards.length - 1));
  cards[currentIndex].scrollIntoView({
    behavior: "smooth",
    inline: "center",
    block: "nearest"
  });
}

prevBtn.addEventListener("click", () => goTo(currentIndex - 1));
nextBtn.addEventListener("click", () => goTo(currentIndex + 1));

let scrollTimer;
deck.addEventListener("scroll", () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(updateActive, 70);
}, { passive: true });

deck.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight") {
    event.preventDefault();
    goTo(currentIndex + 1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    goTo(currentIndex - 1);
  }
});

// Google Visualization JSONP callback.
// This avoids the browser CORS issue that blocked the earlier version.
window.miloniSheetCallback = function(response) {
  try {
    if (!response || response.status !== "ok" || !response.table) {
      throw new Error("Google Sheets did not return a readable table.");
    }

    const rows = gvizTableToRows(response.table);
    const memories = rowsToMemories(rows);
    render(memories);
  } catch (error) {
    console.error(error);
    statusEl.classList.add("error");
    statusEl.textContent =
      "The letters still couldn't load. Double-check that the Sheet is shared as Anyone with the link → Viewer.";
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

  const script = document.createElement("script");
  const query = encodeURIComponent("select *");
  script.src =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${SHEET_GID}` +
    `&tqx=responseHandler:miloniSheetCallback` +
    `&tq=${query}` +
    `&headers=1` +
    `&cacheBust=${Date.now()}`;

  script.onerror = () => {
    statusEl.classList.add("error");
    statusEl.textContent =
      "The letters couldn't load from Google Sheets. Make sure the Sheet is shared as Anyone with the link → Viewer, then refresh.";
    script.remove();
    activeLoader = null;
  };

  activeLoader = script;
  document.body.appendChild(script);
}

loadMemories();
setInterval(loadMemories, REFRESH_MS);

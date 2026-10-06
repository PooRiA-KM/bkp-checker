const LABEL = { ok: "سالم", warning: "هشدار", error: "مشکل" };
let data = null;
let filter = "all";

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const fa = (n) => Number(n).toLocaleString("fa-IR");
const fmtDate = (t) => new Date(t * 1000).toLocaleString("fa-IR-u-ca-persian", { dateStyle: "short", timeStyle: "short" });
function fmtSize(b) {
  if (b == null) return "—";
  const u = ["بایت", "کیلوبایت", "مگابایت", "گیگابایت", "ترابایت"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return fa(b.toFixed(i > 1 ? 1 : 0)) + " " + u[i];
}
function fmtAge(h) {
  if (h == null) return "";
  if (h < 1) return "کمتر از یک ساعت پیش";
  if (h < 48) return fa(Math.floor(h)) + " ساعت پیش";
  return fa(Math.floor(h / 24)) + " روز پیش";
}

function backupCell(label, b, extra) {
  const c = el("div", "cell");
  c.dataset.label = label;
  if (!b) { c.append(el("span", "muted", "غیرفعال")); return c; }
  if (b.t == null) { c.append(el("span", "bad", b.msg)); return c; }
  c.append(el("span", null, fmtDate(b.t)));
  c.append(el("small", null, `${fmtAge(b.age_h)} · ${fmtSize(b.size)}${extra || ""}`));
  if (b.msg) c.append(el("span", b.status === "warning" ? "warn" : "bad", b.msg));
  return c;
}

function dbRow(db) {
  const d = el("details", "db");
  const s = el("summary", "row");
  s.append(el("div", "dbname", db.name));
  s.append(backupCell("Full", db.full));
  s.append(backupCell("Diff", db.diff, db.diff && db.diff.count_24h != null ? ` · ${fa(db.diff.count_24h)} فایل در ۲۴ ساعت` : ""));
  s.append(el("span", "chip " + db.status, LABEL[db.status]));
  d.append(s);

  const h = el("div", "hist");
  const t = el("table");
  const head = el("tr");
  ["تاریخ Full", "حجم"].forEach((x) => head.append(el("th", null, x)));
  t.append(head);
  db.history.forEach((x) => {
    const r = el("tr");
    r.append(el("td", null, fmtDate(x.t)), el("td", null, fmtSize(x.size)));
    t.append(r);
  });
  h.append(t);
  d.append(h);
  return d;
}

function render() {
  if (!data) return;
  const dbs = data.servers.flatMap((s) => s.dbs);
  const count = { all: dbs.length, ok: 0, warning: 0, error: 0 };
  dbs.forEach((d) => count[d.status]++);
  data.servers.filter((s) => !s.dbs.length && s.status === "error").forEach(() => count.error++);

  $("scanInfo").textContent = data.scanned_at
    ? `آخرین اسکن: ${fmtDate(data.scanned_at)} (${fa(data.duration)} ثانیه)`
    : "هنوز اسکنی انجام نشده است";

  const f = $("filters");
  f.replaceChildren();
  [["all", "همه"], ["error", "مشکل‌دار"], ["warning", "هشدار"], ["ok", "سالم"]].forEach(([k, name]) => {
    const b = el("button", null, name);
    b.type = "button";
    b.setAttribute("aria-pressed", String(filter === k));
    b.append(el("b", null, fa(count[k])));
    b.onclick = () => { filter = k; render(); };
    f.append(b);
  });

  const main = $("content");
  main.replaceChildren();
  const order = { error: 0, warning: 1, ok: 2 };
  const servers = [...data.servers].sort((a, b) => order[a.status] - order[b.status]);

  servers.forEach((s) => {
    const rows = s.dbs.filter((d) => filter === "all" || d.status === filter);
    const show = s.dbs.length ? rows.length : (filter === "all" || filter === s.status);
    if (!show) return;

    const box = el("section", "server " + s.status);
    const head = el("header");
    const left = el("div");
    left.append(el("h2", null, s.name), el("div", "path", s.path));
    head.append(left, el("span", "chip " + s.status, LABEL[s.status]));
    box.append(head);

    if (!s.dbs.length) {
      box.append(el("div", "srv-msg", s.msg));
    } else {
      const cols = el("div", "cols");
      ["دیتابیس", "آخرین Full", "آخرین Diff", "وضعیت"].forEach((x) => cols.append(el("div", null, x)));
      box.append(cols);
      rows.forEach((d) => box.append(dbRow(d)));
    }
    main.append(box);
  });

  if (!main.children.length) main.append(el("div", "empty", "موردی برای نمایش وجود ندارد."));
}

async function load(refresh) {
  const btn = $("refreshBtn");
  if (refresh) { btn.disabled = true; btn.textContent = "در حال اسکن…"; }
  try {
    const r = await (refresh ? fetch("/api/refresh", { method: "POST" }) : fetch("/api/status"));
    data = await r.json();
    render();
  } catch (e) {
    $("scanInfo").textContent = "ارتباط با سرور برقرار نشد";
  } finally {
    btn.disabled = false; btn.textContent = "اسکن دوباره";
  }
}

$("refreshBtn").onclick = () => load(true);
load(false);
setInterval(() => load(false), 60000);

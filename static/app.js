const LABEL = { ok: "سالم", warning: "هشدار", error: "مشکل" };
const SEG = [["all", "همه"], ["error", "مشکل"], ["warning", "هشدار"], ["ok", "سالم"]];

let data = null;
let filter = "all";
let query = "";
let forceOpen = false;
const openServers = new Set();
const openDbs = new Set();

function backupCell(label, b, extra) {
  const c = el("div", "cell");
  c.dataset.label = label;
  if (!b) { c.append(el("span", "muted", "ندارد")); return c; }
  if (b.t == null) { c.append(el("span", "bad", b.msg)); return c; }
  c.append(el("span", null, fmtDate(b.t)));
  c.append(el("small", null, `${fmtAge(b.age_h)} • ${fmtSize(b.size)}${extra || ""}`));
  if (b.msg) c.append(el("span", b.status === "warning" ? "warn" : "bad", b.msg));
  return c;
}

function track(details, set, key) {
  if (forceOpen || set.has(key)) details.open = true;
  details.addEventListener("toggle", () => {
    if (forceOpen) return;
    details.open ? set.add(key) : set.delete(key);
  });
}

function dbRow(server, db) {
  const d = el("details", "db");
  track(d, openDbs, server.name + "/" + db.name);

  const s = el("summary", "row");
  s.append(el("div", "dbname", db.name));
  s.append(backupCell("Full", db.full));
  const cnt = db.diff && db.diff.count_24h != null ? ` • ${fa(db.diff.count_24h)} فایل در ۲۴ ساعت` : "";
  s.append(backupCell("Diff", db.diff, cnt));
  s.append(el("span", "chip " + db.status, LABEL[db.status]));
  d.append(s);

  const body = el("div", "db-body");
  if (db.history.length) {
    const snip = el("div", "snip");
    const sizes = [...db.history].reverse(); // قدیمی -> جدید
    const max = Math.max(...sizes.map((x) => x.size), 1);
    const spark = el("div", "spark");
    spark.title = "روند حجم ۱۴ بکاپ Full آخر";
    sizes.forEach((x) => {
      const i = el("i");
      i.style.height = Math.max(8, (x.size / max) * 100) + "%";
      i.title = `${fmtDate(x.t)} • ${fmtSize(x.size)}`;
      spark.append(i);
    });
    snip.append(spark);
    const t = el("table");
    const head = el("tr");
    ["تاریخ بکاپ Full", "حجم"].forEach((x) => head.append(el("th", null, x)));
    t.append(head);
    db.history.forEach((x) => {
      const r = el("tr");
      r.append(el("td", null, fmtDate(x.t)), el("td", null, fmtSize(x.size)));
      t.append(r);
    });
    snip.append(t);
    body.append(snip);
  } else {
    body.append(el("p", "muted", "بکاپ Full ثبت‌شده‌ای وجود ندارد."));
  }
  if (db.folder) {
    const b = el("button", "link", "نادیده گرفتن این پوشه در پایش");
    b.type = "button";
    b.onclick = async () => {
      if (!confirm(`پوشه «${db.name}» از پایش سرور «${server.name}» حذف شود؟\nاز صفحه‌ی تنظیمات می‌توانید برگردانید.`)) return;
      b.disabled = true;
      try { data = await api("/api/exclude", "POST", { server: server.name, name: db.name }); render(); toast("پوشه نادیده گرفته شد"); }
      catch (e) { toast(e.message, "err"); b.disabled = false; }
    };
    body.append(b);
  }
  d.append(body);
  return d;
}

function serverBox(s, rows) {
  const d = el("details", "server " + s.status);
  d.dataset.server = s.name;
  track(d, openServers, s.name);

  const sum = el("summary", "srv-sum");
  const id = el("div", "srv-id");
  id.append(el("strong", null, s.name), el("span", "path", s.path));

  const info = el("div", "srv-info");
  const bar = el("div", "bar");
  if (s.dbs.length) {
    const c = { ok: 0, warning: 0, error: 0 };
    s.dbs.forEach((x) => c[x.status]++);
    const pills = el("div", "pills");
    pills.append(el("span", "pill total", `${fa(s.dbs.length)} دیتابیس`));
    ["error", "warning", "ok"].forEach((k) => {
      if (c[k]) pills.append(el("span", "pill " + k, `${fa(c[k])} ${LABEL[k]}`));
    });
    info.append(pills);
    const bad = s.dbs.filter((x) => x.status !== "ok").map((x) => x.name);
    if (bad.length) {
      const shown = bad.slice(0, 3).join("، ");
      info.append(el("div", "names", bad.length > 3 ? `${shown} و ${fa(bad.length - 3)} مورد دیگر` : shown));
    }
    ["error", "warning", "ok"].forEach((k) => {
      if (!c[k]) return;
      const seg = el("span", k);
      seg.style.width = (c[k] / s.dbs.length) * 100 + "%";
      bar.append(seg);
    });
    bar.title = `${c.ok} سالم، ${c.warning} هشدار، ${c.error} مشکل`;
  } else {
    info.append(el("span", "pill error", s.msg));
  }
  sum.append(el("span", "chev"), id, info, bar, el("span", "chip " + s.status, LABEL[s.status]));
  d.append(sum);

  if (!s.dbs.length) {
    d.append(el("div", "srv-msg", s.msg));
    return d;
  }
  const cols = el("div", "cols");
  ["دیتابیس", "آخرین Full", "آخرین Diff", "وضعیت"].forEach((x) => cols.append(el("div", null, x)));
  d.append(cols);
  rows.forEach((db) => d.append(dbRow(s, db)));
  if (s.excluded && s.excluded.length) {
    d.append(el("div", "srv-foot", `${fa(s.excluded.length)} پوشه نادیده گرفته شد: ${s.excluded.join("، ")}`));
  }
  return d;
}

function renderWall() {
  const box = $("wallBox"), wall = $("wall");
  wall.replaceChildren();
  const order = { error: 0, warning: 1, ok: 2 };
  const list = [...data.servers].sort((a, b) => order[a.status] - order[b.status]);
  box.hidden = !list.length;
  list.forEach((s) => {
    const grp = el("div", "grp");
    const items = s.dbs.length ? s.dbs : [{ name: s.msg || s.name, status: s.status }];
    items.forEach((x) => {
      const led = el("button", "led " + x.status);
      led.type = "button";
      led.title = `${s.name}${s.dbs.length ? " / " + x.name : ""} — ${LABEL[x.status]}`;
      led.setAttribute("aria-label", led.title);
      led.onclick = () => {
        filter = "all"; query = ""; $("search").value = "";
        openServers.add(s.name);
        render();
        const target = [...document.querySelectorAll(".server")].find((e) => e.dataset.server === s.name);
        if (target) target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      };
      grp.append(led);
    });
    wall.append(grp);
  });
}

function render() {
  if (!data) return;
  forceOpen = filter !== "all" || query !== "";

  const items = data.servers.flatMap((s) => (s.dbs.length ? s.dbs : [{ status: s.status }]));
  const count = { all: items.length, ok: 0, warning: 0, error: 0 };
  items.forEach((i) => count[i.status]++);

  // خلاصه‌ی وضعیت
  const v = $("verdict");
  if (!data.servers.length) {
    v.className = "hero";
    $("vBadge").textContent = "بدون سرور";
    $("vText").textContent = "هنوز سروری تعریف نشده است";
    $("vSub").replaceChildren(el("a", null, "از صفحه‌ی تنظیمات یک سرور اضافه کنید", { href: "/settings" }));
  } else {
    v.className = "hero " + (count.error ? "error" : count.warning ? "warning" : "ok");
    $("vText").textContent = count.error
      ? `${fa(count.error)} مورد نیاز به بررسی دارد`
      : count.warning ? `بکاپ‌ها ثبت شده‌اند، ${fa(count.warning)} هشدار وجود دارد`
      : `همه‌ی ${fa(count.all)} بکاپ سالم است`;
    $("vBadge").textContent = data.scanned_at ? `آخرین اسکن ${fmtDate(data.scanned_at)}` : "منتظر اولین اسکن";
    $("vSub").textContent = `${fa(data.servers.length)} سرور • ${fa(count.all)} بکاپ تحت پایش` + (data.duration != null ? ` • مدت اسکن ${fa(data.duration)} ثانیه` : "");
  }

  const f = $("filters");
  f.replaceChildren();
  SEG.forEach(([k, name]) => {
    const b = el("button", "tile " + k);
    b.type = "button";
    b.setAttribute("aria-pressed", String(filter === k));
    b.append(el("span", "tile-label", name), el("b", "tile-num" + (count[k] ? " has" : ""), fa(count[k])));
    b.firstChild.prepend(el("i"));
    b.onclick = () => { filter = k; render(); };
    f.append(b);
  });

  renderWall();

  const main = $("content");
  main.replaceChildren();
  const order = { error: 0, warning: 1, ok: 2 };
  const q = query.trim().toLowerCase();

  [...data.servers].sort((a, b) => order[a.status] - order[b.status]).forEach((s) => {
    const nameHit = !q || s.name.toLowerCase().includes(q);
    const rows = s.dbs.filter((d) => (filter === "all" || d.status === filter) && (nameHit || d.name.toLowerCase().includes(q)));
    const show = s.dbs.length
      ? rows.length > 0
      : (filter === "all" || filter === s.status) && nameHit;
    if (show) main.append(serverBox(s, rows));
  });
  if (!main.children.length && data.servers.length) main.append(el("div", "empty", "موردی برای نمایش وجود ندارد."));
}

async function load(refresh) {
  const btn = $("refreshBtn");
  if (refresh) { btn.disabled = true; btn.textContent = "در حال اسکن…"; }
  try {
    const next = await api(refresh ? "/api/refresh" : "/api/status", refresh ? "POST" : "GET");
    // اگر اسکن جدیدی نیامده، صفحه را دوباره نمی‌سازیم تا حالت باز/بسته‌ی کشوها حفظ شود
    if (refresh || !data || next.scanned_at !== data.scanned_at) { data = next; render(); }
  } catch (e) {
    $("vSub").textContent = "ارتباط با سرور برقرار نشد";
  } finally {
    btn.disabled = false; btn.textContent = "اسکن دوباره";
  }
}

$("refreshBtn").onclick = () => load(true);
$("search").oninput = (e) => { query = e.target.value; render(); };
$("expandAll").onclick = () => { data.servers.forEach((s) => openServers.add(s.name)); render(); };
$("collapseAll").onclick = () => { openServers.clear(); openDbs.clear(); filter = "all"; $("search").value = ""; query = ""; render(); };
load(false);
setInterval(() => load(false), 60000);
let cfg = null;
let dirty = false;
const openCards = new WeakSet();

const lines = (v) => v.split("\n").map((s) => s.trim()).filter(Boolean);

function markDirty() {
  dirty = true;
  $("saveState").textContent = "تغییرات ذخیره نشده";
  document.querySelector(".savebar").classList.add("dirty");
}

function input(type, value, onChange, attrs) {
  const i = el("input", null, null, attrs);
  i.type = type;
  i.value = value ?? "";
  i.oninput = () => { onChange(i.value); markDirty(); };
  return i;
}

function area(value, onChange, rows) {
  const t = el("textarea", "ltr", null, { rows: rows || 3 });
  t.value = value;
  t.oninput = () => { onChange(t.value); markDirty(); };
  return t;
}

function field(label, control, hint, wide) {
  const w = el("label", "field" + (wide ? " wide" : ""));
  w.append(el("span", "lbl", label), control);
  if (hint) w.append(el("small", "hint", hint));
  return w;
}

// عدد: مقدار خالی برای فیلد اختیاری یعنی «پیش‌فرض»
function setNum(obj, key, v, optional) {
  if (v === "") { if (optional) delete obj[key]; else obj[key] = ""; }
  else obj[key] = Number(v);
}

function renderGeneral() {
  const d = cfg.defaults;
  $("general").replaceChildren(
    field("فاصله‌ی اسکن خودکار (دقیقه)", input("number", cfg.scan_interval_minutes, (v) => setNum(cfg, "scan_interval_minutes", v), { min: 1 })),
    field("نام پوشه‌ی Full", input("text", d.full_dir, (v) => (d.full_dir = v), { dir: "ltr" })),
    field("نام پوشه‌ی Diff", input("text", d.diff_dir || "", (v) => (d.diff_dir = v), { dir: "ltr" }), "خالی = به‌طور پیش‌فرض Diff بررسی نشود"),
    field("پسوند فایل‌های بکاپ", input("text", (d.extensions || []).join(", "), (v) => (d.extensions = v.split(/[,\s]+/).filter(Boolean)), { dir: "ltr" }), "با کاما جدا کنید؛ مثلاً .bak, .trn"),
    field("حداکثر عمر بکاپ Full (ساعت)", input("number", d.full_max_age_hours, (v) => setNum(d, "full_max_age_hours", v), { min: 1 }), "قدیمی‌تر از این مقدار = مشکل"),
    field("حداکثر عمر بکاپ Diff (ساعت)", input("number", d.diff_max_age_hours, (v) => setNum(d, "diff_max_age_hours", v), { min: 1 })),
    field("هشدار کاهش حجم (درصد)", input("number", d.size_drop_warning_percent, (v) => setNum(d, "size_drop_warning_percent", v), { min: 0, max: 99 }), "اگر حجم Full جدید این‌قدر از قبلی کمتر باشد هشدار می‌دهد؛ ۰ = غیرفعال"),
    field("پوشه‌های نادیده‌گرفته‌شده در همه‌ی سرورها", area((d.exclude_dirs || []).join("\n"), (v) => (d.exclude_dirs = lines(v))), "هر خط یک نام پوشه؛ علامت * پشتیبانی می‌شود (مثلاً old_*)", true)
  );
  $("advanced").replaceChildren(
    field("آدرس شنود (host)", input("text", cfg.host, (v) => (cfg.host = v), { dir: "ltr" }), "۱۲۷.۰.۰.۱ فقط همین سیستم؛ 0.0.0.0 همه‌ی شبکه"),
    field("پورت", input("number", cfg.port, (v) => setNum(cfg, "port", v), { min: 1, max: 65535 }))
  );
}

function renderFolders(box, res, s, ta) {
  box.replaceChildren();
  if (!res.ok) { box.append(el("p", "bad", res.error)); return; }
  box.append(el("p", null, "✓ مسیر در دسترس است."));
  if (res.missing.length) box.append(el("p", "warn", "پوشه پیدا نشد: " + res.missing.join("، ")));
  if (!res.folders.length) {
    box.append(el("p", "muted", "زیرپوشه‌ای پیدا نشد (سرور تک‌دیتابیسه است یا پوشه‌ها خالی‌اند)."));
    return;
  }
  box.append(el("p", "muted", "تیک‌خورده‌ها نادیده گرفته می‌شوند:"));
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  res.folders.forEach((f) => {
    const row = el("label", "frow");
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = (s.exclude_dirs || []).some((x) => same(x, f.name));
    cb.onchange = () => {
      const list = (s.exclude_dirs || []).filter((x) => !same(x, f.name));
      if (cb.checked) list.push(f.name);
      s.exclude_dirs = list;
      ta.value = list.join("\n");
      markDirty();
    };
    const parts = [];
    if (f.full != null) parts.push(`Full: ${fa(f.full)} فایل`);
    if (f.diff != null) parts.push(`Diff: ${fa(f.diff)} فایل`);
    const empty = (f.full || 0) + (f.diff || 0) === 0;
    row.append(cb, el("span", "fname", f.name), el("small", empty ? "bad" : "muted", parts.join(" • ") + (empty ? " — خالی" : "")));
    box.append(row);
  });
}

function serverCard(s) {
  const card = el("details", "srv-card");
  if (openCards.has(s)) card.open = true;
  card.addEventListener("toggle", () => (card.open ? openCards.add(s) : openCards.delete(s)));

  const title = el("strong", null, s.name || "سرور جدید");
  const path = el("span", "path", s.path || "");
  card.append(Object.assign(el("summary"), {}));
  card.firstChild.append(el("span", "chev"), title, path);

  const body = el("div", "card-body");
  const d = cfg.defaults;
  const diffInput = input("text", s.diff_dir || "", (v) => { if (v.trim()) s.diff_dir = v; else delete s.diff_dir; }, { dir: "ltr", placeholder: (d.diff_dir || "—") + " (پیش‌فرض)" });
  diffInput.disabled = s.diff_dir === null;

  const noDiff = el("label", "check");
  const cb = el("input");
  cb.type = "checkbox";
  cb.checked = s.diff_dir === null;
  cb.onchange = () => {
    if (cb.checked) { s.diff_dir = null; diffInput.value = ""; } else delete s.diff_dir;
    diffInput.disabled = cb.checked;
    markDirty();
  };
  noDiff.append(cb, el("span", null, "این سرور بکاپ Diff ندارد"));

  const grid = el("div", "grid");
  grid.append(
    field("نام سرور", input("text", s.name, (v) => { s.name = v; title.textContent = v || "سرور جدید"; })),
    field("مسیر share بکاپ‌ها", input("text", s.path, (v) => { s.path = v; path.textContent = v; }, { dir: "ltr", placeholder: "\\\\server\\backup" }), "پوشه‌ای که داخلش FULLBK و DIFFBK قرار دارد"),
    field("پوشه‌ی Full (اختیاری)", input("text", s.full_dir || "", (v) => { if (v.trim()) s.full_dir = v; else delete s.full_dir; }, { dir: "ltr", placeholder: d.full_dir + " (پیش‌فرض)" })),
    field("پوشه‌ی Diff (اختیاری)", diffInput),
    field("حداکثر عمر Full (ساعت)", input("number", s.full_max_age_hours ?? "", (v) => setNum(s, "full_max_age_hours", v, true), { min: 1, placeholder: "پیش‌فرض: " + d.full_max_age_hours })),
    field("حداکثر عمر Diff (ساعت)", input("number", s.diff_max_age_hours ?? "", (v) => setNum(s, "diff_max_age_hours", v, true), { min: 1, placeholder: "پیش‌فرض: " + d.diff_max_age_hours }))
  );
  body.append(grid, el("div", "grid"));
  body.lastChild.append(noDiff);

  // exclude پوشه‌ها
  const ta = area((s.exclude_dirs || []).join("\n"), (v) => (s.exclude_dirs = lines(v)), 3);
  const box = el("div", "folders");
  box.hidden = true;
  const detect = el("button", "ghost", "تشخیص پوشه‌ها و تست مسیر");
  detect.type = "button";
  detect.onclick = async () => {
    detect.disabled = true;
    try {
      const res = await api("/api/folders", "POST", {
        path: s.path,
        full_dir: s.full_dir || d.full_dir,
        diff_dir: s.diff_dir === null ? "" : s.diff_dir || d.diff_dir || "",
        extensions: d.extensions,
      });
      box.hidden = false;
      renderFolders(box, res, s, ta);
    } catch (e) { toast(e.message, "err"); }
    detect.disabled = false;
  };
  const exWrap = el("div", "grid");
  exWrap.append(field("پوشه‌های نادیده‌گرفته‌شده در این سرور", ta, "هر خط یک نام پوشه (مثلاً پوشه‌های خالی یا قدیمی)؛ علامت * پشتیبانی می‌شود", true));
  body.append(exWrap, el("div", "card-actions"));
  const actions = body.lastChild;
  actions.append(detect);
  const del = el("button", "danger", "حذف این سرور");
  del.type = "button";
  del.onclick = () => {
    if (!confirm(`سرور «${s.name || "بدون نام"}» حذف شود؟`)) return;
    cfg.servers.splice(cfg.servers.indexOf(s), 1);
    markDirty();
    renderServers();
  };
  actions.append(del);
  body.insertBefore(box, actions);
  card.append(body);
  return card;
}

function renderServers() {
  const wrap = $("servers");
  wrap.replaceChildren();
  if (!cfg.servers.length) wrap.append(el("div", "empty", "هنوز سروری اضافه نشده است."));
  cfg.servers.forEach((s) => wrap.append(serverCard(s)));
}

$("addServer").onclick = () => {
  const s = { name: "", path: "", exclude_dirs: [] };
  cfg.servers.push(s);
  openCards.add(s);
  markDirty();
  renderServers();
};

$("saveBtn").onclick = async () => {
  const btn = $("saveBtn"), err = $("errors");
  btn.disabled = true;
  err.hidden = true;
  try {
    const r = await api("/api/config", "PUT", cfg);
    dirty = false;
    $("saveState").textContent = "ذخیره شد";
    document.querySelector(".savebar").classList.remove("dirty");
    toast(r.restart_needed ? "ذخیره شد؛ تغییر آدرس/پورت بعد از راه‌اندازی مجدد اعمال می‌شود" : "ذخیره شد؛ اسکن جدید شروع شد");
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
  btn.disabled = false;
};

window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

(async () => {
  try {
    cfg = await api("/api/config");
    renderGeneral();
    renderServers();
  } catch (e) { toast(e.message, "err"); }
})();

// دکمه‌ی کپی نمونه‌ی auth (با fallback برای HTTP غیرلوکال)
$("copyAuth").onclick = async () => {
  const text = $("authSnippet").textContent;
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const t = el("textarea"); t.value = text; document.body.append(t); t.select();
      document.execCommand("copy"); t.remove();
    }
    toast("کپی شد");
  } catch (e) { toast("کپی نشد؛ متن را دستی انتخاب کنید", "err"); }
};
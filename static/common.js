const $ = (id) => document.getElementById(id);

function el(tag, cls, text, attrs) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (attrs) Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}

const fa = (n) => Number(n).toLocaleString("fa-IR");
const fmtDate = (t) =>
  new Date(t * 1000).toLocaleString("fa-IR-u-ca-persian", { dateStyle: "short", timeStyle: "short" });

function fmtSize(b) {
  if (b == null) return "—";
  const u = ["بایت", "کیلوبایت", "مگابایت", "گیگابایت", "ترابایت"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return fa(Number(b.toFixed(i > 1 ? 1 : 0))) + " " + u[i];
}

function fmtAge(h) {
  if (h == null) return "";
  if (h < 1) return "کمتر از یک ساعت پیش";
  if (h < 48) return fa(Math.floor(h)) + " ساعت پیش";
  return fa(Math.floor(h / 24)) + " روز پیش";
}

async function api(url, method, body) {
  const r = await fetch(url, {
    method: method || "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch (e) { /* پاسخ بدون JSON */ }
  if (!r.ok) throw new Error(data && data.errors ? data.errors.join("\n") : "خطا در ارتباط با سرور");
  return data;
}

let toastTimer;
function toast(msg, kind) {
  let t = $("toast");
  if (!t) { t = el("div", "toast"); t.id = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.textContent = msg;
  t.className = "toast show " + (kind || "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 3500);
}

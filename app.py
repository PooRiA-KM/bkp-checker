"""
Backup Monitor - بک‌اند
فقط فایل‌های بکاپ روی share را بررسی می‌کند (تاریخ تغییر + حجم)؛ هیچ اتصالی به دیتابیس ندارد.
همه‌ی تنظیمات از صفحه‌ی /settings قابل تغییر است و در config.json ذخیره می‌شود.

ساختار مورد انتظار هر سرور:
  <path>/FULLBK/<db>/xxx.bak     -> سرورهای چند دیتابیسه (یک پوشه برای هر دیتابیس)
  <path>/FULLBK/xxx.bak          -> سرورهای تک دیتابیسه (همه فایل‌ها در یک پوشه)
  <path>/DIFFBK/...              -> همین منطق برای diff
"""
import fnmatch
import hmac
import json
import os
import re
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from flask import Flask, Response, jsonify, request, send_from_directory

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE, "config.json")
app = Flask(__name__, static_folder=os.path.join(BASE, "static"), static_url_path="/static")

DEFAULTS = {
    "full_dir": "FULLBK",
    "diff_dir": "DIFFBK",
    "extensions": [".bak"],
    "full_max_age_hours": 26,
    "diff_max_age_hours": 26,
    "size_drop_warning_percent": 50,
    "exclude_dirs": [],
}
HISTORY_LIMIT = 6  # تعداد آخرین بکاپ‌هایی که در جدول هر دیتابیس نشان داده می‌شود
RANK = {"ok": 0, "warning": 1, "error": 2}
state = {"servers": [], "scanned_at": None, "duration": None}
state_lock = threading.Lock()
scan_lock = threading.Lock()
cfg_lock = threading.Lock()
wake = threading.Event()  # بیدار کردن حلقه‌ی اسکن بعد از ذخیره‌ی تنظیمات


# ---------- تنظیمات ----------
def to_list(v, sep=r"\n"):
    if isinstance(v, str):
        v = re.split(sep, v)
    return [x.strip() for x in (v or []) if isinstance(x, str) and x.strip()]


def load_config():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            c = json.load(f)
    except FileNotFoundError:
        c = {}
    c.setdefault("host", "127.0.0.1")
    c.setdefault("port", 8080)
    c.setdefault("scan_interval_minutes", 15)
    c["defaults"] = {**DEFAULTS, **c.get("defaults", {})}
    c.setdefault("servers", [])
    for s in c["servers"]:  # سازگاری با نسخه‌ی قبل: ignore_dbs -> exclude_dirs
        if "ignore_dbs" in s:
            s["exclude_dirs"] = to_list(s.get("exclude_dirs")) + to_list(s.pop("ignore_dbs"))
    return c


def save_config(c):
    fd, tmp = tempfile.mkstemp(dir=BASE, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(c, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CONFIG_PATH)


def clean_config(raw, old):
    errs = []

    def num(v, label, lo, hi=None, optional=False):
        if v in (None, ""):
            if not optional:
                errs.append(f"«{label}» الزامی است")
            return None
        try:
            n = float(v)
        except (TypeError, ValueError):
            errs.append(f"«{label}» باید عدد باشد")
            return None
        if n < lo or (hi is not None and n > hi):
            errs.append(f"«{label}» باید بین {lo} و {hi} باشد" if hi else f"«{label}» باید حداقل {lo} باشد")
            return None
        return int(n) if n == int(n) else n

    d = raw.get("defaults") or {}
    exts = [("." + x.lstrip(".")).lower() for x in to_list(d.get("extensions"), r"[,\s]+")]
    defaults = {
        "full_dir": str(d.get("full_dir") or "").strip(),
        "diff_dir": str(d.get("diff_dir") or "").strip() or None,
        "extensions": exts,
        "full_max_age_hours": num(d.get("full_max_age_hours"), "حداکثر عمر بکاپ Full", 1),
        "diff_max_age_hours": num(d.get("diff_max_age_hours"), "حداکثر عمر بکاپ Diff", 1),
        "size_drop_warning_percent": num(d.get("size_drop_warning_percent"), "آستانه‌ی کاهش حجم", 0, 99),
        "exclude_dirs": to_list(d.get("exclude_dirs")),
    }
    if not defaults["full_dir"]:
        errs.append("«نام پوشه‌ی Full» الزامی است")
    if not exts:
        errs.append("حداقل یک پسوند فایل لازم است")

    servers, seen = [], set()
    for i, s in enumerate(raw.get("servers") or [], 1):
        name, path = str(s.get("name") or "").strip(), str(s.get("path") or "").strip()
        if not name or not path:
            errs.append(f"سرور شماره {i}: نام و مسیر الزامی است")
            continue
        if name.lower() in seen:
            errs.append(f"نام سرور «{name}» تکراری است")
        seen.add(name.lower())
        out = {"name": name, "path": path, "exclude_dirs": to_list(s.get("exclude_dirs"))}
        if str(s.get("full_dir") or "").strip():
            out["full_dir"] = s["full_dir"].strip()
        if "diff_dir" in s:
            if s["diff_dir"] is None:
                out["diff_dir"] = None
            elif str(s["diff_dir"]).strip():
                out["diff_dir"] = str(s["diff_dir"]).strip()
        for k, label in (("full_max_age_hours", "حداکثر عمر Full"), ("diff_max_age_hours", "حداکثر عمر Diff")):
            v = num(s.get(k), f"{name}: {label}", 1, optional=True)
            if v is not None:
                out[k] = v
        servers.append(out)

    interval = num(raw.get("scan_interval_minutes"), "فاصله‌ی اسکن (دقیقه)", 1)
    port = num(raw.get("port"), "پورت", 1, 65535)
    out = {
        "host": str(raw.get("host") or "").strip() or "127.0.0.1",
        "port": port or old["port"],
        "scan_interval_minutes": interval or old["scan_interval_minutes"],
        "defaults": defaults,
        "servers": servers,
    }
    if old.get("auth"):
        out["auth"] = old["auth"]  # رمز عبور فقط از روی فایل تنظیم می‌شود
    return out, errs


# ---------- خواندن فایل‌ها ----------
def is_excluded(name, patterns):
    n = name.lower()
    return any(fnmatch.fnmatch(n, p.lower()) for p in patterns)


def list_files(path, exts):
    out = []
    try:
        with os.scandir(path) as it:
            for e in it:
                if e.is_file() and e.name.lower().endswith(exts):
                    st = e.stat()
                    out.append({"name": e.name, "t": st.st_mtime, "size": st.st_size})
    except OSError:
        pass
    out.sort(key=lambda f: f["t"], reverse=True)
    return out


def count_files(path, exts):
    try:
        with os.scandir(path) as it:
            return sum(1 for e in it if e.is_file() and e.name.lower().endswith(exts))
    except OSError:
        return 0


def scan_dir(path, exts, single_name, exclude):
    """خروجی: (دیتابیس‌ها، پوشه‌های exclude‌شده، نام پوشه‌ها) یا None اگر پوشه وجود نداشته باشد."""
    if not os.path.isdir(path):
        return None
    result, skipped, folders = {}, [], set()
    direct = list_files(path, exts)  # فایل‌های مستقیم = سرور تک دیتابیسه
    if direct:
        result[single_name] = direct
    with os.scandir(path) as it:
        for e in it:
            if not e.is_dir():
                continue
            if is_excluded(e.name, exclude):
                skipped.append(e.name)
                continue
            folders.add(e.name)
            result[e.name] = list_files(e.path, exts)
    return result, skipped, folders


# ---------- ارزیابی ----------
def worst(statuses):
    return max(statuses, key=lambda s: RANK[s]) if statuses else "ok"


def check(files, max_age_h, now, label, drop_pct=None):
    if not files:
        return {"status": "error", "msg": f"هیچ بکاپ {label}ی پیدا نشد", "t": None, "size": None, "age_h": None}
    last = files[0]
    age_h = (now - last["t"]) / 3600
    res = {"status": "ok", "msg": "", "t": last["t"], "size": last["size"], "age_h": round(age_h, 1)}
    if last["size"] == 0:
        res.update(status="error", msg="فایل بکاپ خالی است")
    elif age_h > max_age_h:
        res.update(status="error", msg=f"آخرین بکاپ {label} {int(age_h)} ساعت پیش بوده")
    elif drop_pct and len(files) > 1 and files[1]["size"] > 0 \
            and last["size"] < files[1]["size"] * (1 - drop_pct / 100):
        res.update(status="warning", msg=f"حجم نسبت به بکاپ قبلی بیش از {drop_pct}٪ کم شده")
    return res


def scan_server(srv, defaults, now):
    cfg = {**defaults, **srv}
    name, root = cfg["name"], cfg["path"]
    exts = tuple(e.lower() for e in cfg["extensions"])
    exclude = list(defaults.get("exclude_dirs", [])) + list(srv.get("exclude_dirs", []))
    out = {"name": name, "path": root, "status": "ok", "msg": "", "dbs": [], "excluded": []}

    if not os.path.isdir(root):
        out.update(status="error", msg="مسیر share در دسترس نیست")
        return out

    fr = scan_dir(os.path.join(root, cfg["full_dir"]), exts, name, exclude)
    if fr is None:
        out.update(status="error", msg=f"پوشه {cfg['full_dir']} پیدا نشد")
        return out
    full, skipped, folders = fr

    use_diff = bool(cfg.get("diff_dir"))
    diff, diff_missing = {}, False
    if use_diff:
        dr = scan_dir(os.path.join(root, cfg["diff_dir"]), exts, name, exclude)
        if dr is None:
            diff_missing = True
        else:
            diff, sk, fo = dr
            skipped += sk
            folders |= fo

    out["excluded"] = sorted(set(skipped), key=str.lower)
    names = sorted((n for n in set(full) | set(diff) if not is_excluded(n, exclude)), key=str.lower)

    for db in names:
        f_files = full.get(db, [])
        f = check(f_files, cfg["full_max_age_hours"], now, "Full", cfg["size_drop_warning_percent"])
        d, d_files = None, []
        if use_diff:
            if diff_missing:
                d = {"status": "error", "msg": f"پوشه {cfg['diff_dir']} پیدا نشد", "t": None, "size": None, "age_h": None}
            else:
                d_files = diff.get(db, [])
                d = check(d_files, cfg["diff_max_age_hours"], now, "Diff")
                d["count_24h"] = sum(1 for x in d_files if x["t"] > now - 86400)
        out["dbs"].append({
            "name": db,
            "folder": db in folders,  # فقط پوشه‌ها قابل exclude شدن هستند
            "status": worst([f["status"]] + ([d["status"]] if d else [])),
            "full": f,
            "diff": d,
            "history": [{"t": x["t"], "size": x["size"]} for x in f_files[:HISTORY_LIMIT]],
            "diff_history": [{"t": x["t"], "size": x["size"]} for x in d_files[:HISTORY_LIMIT]],
        })

    if not out["dbs"]:
        out.update(status="error", msg="هیچ دیتابیسی/بکاپی پیدا نشد")
    else:
        out["status"] = worst([x["status"] for x in out["dbs"]])
    return out


def scan_all():
    with scan_lock:
        cfg = load_config()
        now = started = time.time()

        def safe(srv):
            try:
                return scan_server(srv, cfg["defaults"], now)
            except Exception as ex:  # یک سرور خراب نباید بقیه را از کار بیندازد
                return {"name": srv.get("name", "?"), "path": srv.get("path", ""), "status": "error",
                        "msg": f"خطا در اسکن: {ex}", "dbs": [], "excluded": []}

        with ThreadPoolExecutor(max_workers=8) as pool:
            servers = list(pool.map(safe, cfg["servers"]))
        with state_lock:
            state.update(servers=servers, scanned_at=now, duration=round(time.time() - started, 1))


def background_loop():
    while True:
        wake.clear()
        try:
            scan_all()
            interval = load_config()["scan_interval_minutes"]
        except Exception as ex:
            print("scan error:", ex)
            interval = 5
        wake.wait(max(1, interval) * 60)


# ---------- احراز هویت اختیاری (auth در config.json) ----------
@app.before_request
def guard():
    a = load_config().get("auth") or {}
    if not a.get("username"):
        return None
    c = request.authorization
    if c and hmac.compare_digest(c.username or "", a["username"]) \
            and hmac.compare_digest(c.password or "", str(a.get("password", ""))):
        return None
    return Response("Login required", 401, {"WWW-Authenticate": 'Basic realm="Backup Monitor"'})


# ---------- صفحه‌ها و API ----------
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/settings")
def settings_page():
    return send_from_directory(app.static_folder, "settings.html")


@app.route("/api/status")
def api_status():
    with state_lock:
        return jsonify(state)


@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    scan_all()
    with state_lock:
        return jsonify(state)


@app.route("/api/config", methods=["GET", "PUT"])
def api_config():
    if request.method == "GET":
        c = load_config()
        c.pop("auth", None)
        return jsonify(c)
    raw = request.get_json(silent=True)
    if not isinstance(raw, dict):
        return jsonify(errors=["درخواست نامعتبر است"]), 400
    with cfg_lock:
        old = load_config()
        new, errs = clean_config(raw, old)
        if errs:
            return jsonify(errors=errs), 400
        save_config(new)
    wake.set()  # اسکن فوری با تنظیمات جدید
    return jsonify(ok=True, restart_needed=(new["host"], new["port"]) != (old["host"], old["port"]))


@app.route("/api/folders", methods=["POST"])
def api_folders():
    """پوشه‌های داخل مسیر Full/Diff را (برای انتخاب exclude) و تست دسترسی به share برمی‌گرداند."""
    b = request.get_json(silent=True) or {}
    path = str(b.get("path") or "").strip()
    if not path:
        return jsonify(ok=False, error="مسیر خالی است")
    if not os.path.isdir(path):
        return jsonify(ok=False, error="مسیر در دسترس نیست یا دسترسی خواندن وجود ندارد")
    exts = tuple(("." + x.lstrip(".")).lower() for x in to_list(b.get("extensions"), r"[,\s]+")) or (".bak",)
    found, missing = {}, []
    for kind in ("full", "diff"):
        dname = str(b.get(kind + "_dir") or "").strip()
        if not dname:
            continue
        p = os.path.join(path, dname)
        if not os.path.isdir(p):
            missing.append(dname)
            continue
        with os.scandir(p) as it:
            for e in it:
                if e.is_dir():
                    found.setdefault(e.name, {"name": e.name, "full": None, "diff": None})[kind] = count_files(e.path, exts)
    folders = sorted(found.values(), key=lambda f: f["name"].lower())
    return jsonify(ok=True, folders=folders, missing=missing)


@app.route("/api/exclude", methods=["POST"])
def api_exclude():
    """میان‌بر صفحه‌ی پایش: افزودن یک پوشه به لیست exclude‌ی یک سرور."""
    b = request.get_json(silent=True) or {}
    server, name = b.get("server"), str(b.get("name") or "").strip()
    with cfg_lock:
        c = load_config()
        srv = next((s for s in c["servers"] if s["name"] == server), None)
        if not srv or not name:
            return jsonify(errors=["سرور یا پوشه پیدا نشد"]), 404
        lst = to_list(srv.get("exclude_dirs"))
        if name.lower() not in (x.lower() for x in lst):
            lst.append(name)
        srv["exclude_dirs"] = lst
        save_config(c)
    scan_all()
    with state_lock:
        return jsonify(state)


if __name__ == "__main__":
    conf = load_config()
    threading.Thread(target=background_loop, daemon=True).start()
    app.run(host=conf["host"], port=conf["port"], threaded=True)
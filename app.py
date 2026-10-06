"""
Backup Monitor - بک‌اند
فقط فایل‌های بکاپ روی share را بررسی می‌کند (تاریخ تغییر + حجم)؛ هیچ اتصالی به دیتابیس ندارد.

ساختار مورد انتظار هر سرور:
  <path>/FULLBK/<db>/xxx.bak     -> سرورهای چند دیتابیسه (یک پوشه برای هر دیتابیس)
  <path>/FULLBK/xxx.bak          -> سرورهای تک دیتابیسه (همه فایل‌ها در یک پوشه)
  <path>/DIFFBK/...              -> همین منطق برای diff
"""
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from flask import Flask, jsonify, send_from_directory

BASE = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=os.path.join(BASE, "static"), static_url_path="/static")

RANK = {"ok": 0, "warning": 1, "error": 2}
state = {"servers": [], "scanned_at": None, "duration": None}
state_lock = threading.Lock()
scan_lock = threading.Lock()


def load_config():
    with open(os.path.join(BASE, "config.json"), encoding="utf-8") as f:
        return json.load(f)


def worst(statuses):
    return max(statuses, key=lambda s: RANK[s]) if statuses else "ok"


# ---------- خواندن فایل‌ها ----------
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


def scan_dir(path, exts, single_db_name):
    """خروجی: {نام دیتابیس: [فایل‌ها]} یا None اگر پوشه وجود نداشته باشد."""
    if not os.path.isdir(path):
        return None
    result = {}
    direct = list_files(path, exts)  # فایل‌های مستقیم = سرور تک دیتابیسه
    if direct:
        result[single_db_name] = direct
    with os.scandir(path) as it:
        for e in it:
            if e.is_dir():
                result[e.name] = list_files(e.path, exts)
    return result


# ---------- ارزیابی ----------
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
    out = {"name": name, "path": root, "status": "ok", "msg": "", "dbs": []}

    if not os.path.isdir(root):
        out.update(status="error", msg="مسیر share در دسترس نیست")
        return out

    full = scan_dir(os.path.join(root, cfg["full_dir"]), exts, name)
    if full is None:
        out.update(status="error", msg=f"پوشه {cfg['full_dir']} پیدا نشد")
        return out

    use_diff = bool(cfg.get("diff_dir"))
    diff = scan_dir(os.path.join(root, cfg["diff_dir"]), exts, name) if use_diff else {}
    ignore = set(cfg.get("ignore_dbs", []))
    names = sorted((set(full) | set(diff or {})) - ignore, key=str.lower)

    for db in names:
        f_files = full.get(db, [])
        f = check(f_files, cfg["full_max_age_hours"], now, "Full", cfg["size_drop_warning_percent"])
        d = None
        if use_diff:
            if diff is None:
                d = {"status": "error", "msg": f"پوشه {cfg['diff_dir']} پیدا نشد", "t": None, "size": None, "age_h": None}
            else:
                d_files = diff.get(db, [])
                d = check(d_files, cfg["diff_max_age_hours"], now, "Diff")
                d["count_24h"] = sum(1 for x in d_files if x["t"] > now - 86400)
        out["dbs"].append({
            "name": db,
            "status": worst([f["status"]] + ([d["status"]] if d else [])),
            "full": f,
            "diff": d,
            "history": [{"t": x["t"], "size": x["size"]} for x in f_files[:14]],
        })

    if not out["dbs"]:
        out.update(status="error", msg="هیچ دیتابیسی/بکاپی پیدا نشد")
    else:
        out["status"] = worst([d["status"] for d in out["dbs"]])
    return out


def scan_all():
    if not scan_lock.acquire(blocking=False):
        return  # اسکن دیگری در حال اجراست
    try:
        cfg = load_config()
        now, started = time.time(), time.time()

        def safe(srv):
            try:
                return scan_server(srv, cfg["defaults"], now)
            except Exception as ex:  # یک سرور خراب نباید بقیه را از کار بیندازد
                return {"name": srv.get("name", "?"), "path": srv.get("path", ""),
                        "status": "error", "msg": f"خطا در اسکن: {ex}", "dbs": []}

        with ThreadPoolExecutor(max_workers=8) as pool:
            servers = list(pool.map(safe, cfg["servers"]))
        with state_lock:
            state.update(servers=servers, scanned_at=now, duration=round(time.time() - started, 1))
    finally:
        scan_lock.release()


def background_loop():
    while True:
        try:
            scan_all()
            interval = load_config().get("scan_interval_minutes", 15)
        except Exception as ex:
            print("scan error:", ex)
            interval = 5
        time.sleep(max(1, interval) * 60)


# ---------- API ----------
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/status")
def api_status():
    with state_lock:
        return jsonify(state)


@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    scan_all()
    with state_lock:
        return jsonify(state)


if __name__ == "__main__":
    conf = load_config()
    threading.Thread(target=background_loop, daemon=True).start()
    app.run(host=conf.get("host", "127.0.0.1"), port=conf.get("port", 8080), threaded=True)

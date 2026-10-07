"""
اجرای پایدار (production) با Waitress — برای ویندوز و لینوکس.
  python run_server.py
حلقه‌ی اسکن خودکار هم همین‌جا راه‌اندازی می‌شود. فقط یک پروسس اجرا کنید (چند worker نه).
"""
import threading

from waitress import serve

import app as monitor

if __name__ == "__main__":
    conf = monitor.load_config()
    threading.Thread(target=monitor.background_loop, daemon=True).start()
    print(f"Backup Monitor: http://{conf['host']}:{conf['port']}")
    serve(monitor.app, host=conf["host"], port=conf["port"], threads=8)
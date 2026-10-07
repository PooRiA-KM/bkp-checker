import threading
from waitress import serve
import app as m

conf = m.load_config()
threading.Thread(target=m.background_loop, daemon=True).start()  # اسکن خودکار
serve(m.app, host=conf["host"], port=conf["port"])
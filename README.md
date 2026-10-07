# Backup Monitor — پایش بکاپ سرورها

پنل تحت وب برای مانیتور کردن بکاپ‌های روزانه‌ی SQL Server (Full و Diff) روی چندین سرور.
برنامه **هیچ اتصالی به دیتابیس‌ها ندارد**؛ فقط پوشه‌ی share که بکاپ‌ها در آن ریخته می‌شود را می‌خواند (تاریخ تغییر و حجم فایل‌ها) و وضعیت را نشان می‌دهد.

- بک‌اند: Python (Flask) — فرانت‌اند: HTML / CSS / JavaScript خالص (بدون build)
- رابط کاربری فارسی، راست‌به‌چپ، با تاریخ شمسی و تم تیره
- همه‌ی تنظیمات از داخل پنل قابل تغییر است

## امکانات

- خلاصه‌ی وضعیت کل (مثلاً «۳ مورد نیاز به بررسی دارد») و کاشی‌های آمار که هم‌زمان فیلتر هستند
- **نقشه‌ی سلامت**: هر دیتابیس یک LED؛ با کلیک روی آن، سرور مربوطه باز می‌شود
- هر سرور یک کشوی جمع‌شده است که خلاصه‌ی وضعیت (تعداد سالم/هشدار/مشکل و نام دیتابیس‌های مشکل‌دار) را جلوی خودش نشان می‌دهد
- جدول و نمودار روند حجم ۶ بکاپ آخر، جدا برای Full و Diff
- پشتیبانی از سرورهای **چند دیتابیسه** و **تک دیتابیسه**
- **Exclude** کردن پوشه‌ها (برای هر سرور یا سراسری، با پشتیبانی از `*`)
- صفحه‌ی تنظیمات: افزودن/ویرایش/حذف سرور، تست مسیر share و تشخیص خودکار پوشه‌ها
- اسکن خودکار در بازه‌ی دلخواه + دکمه‌ی اسکن فوری
- قفل اختیاری با نام کاربری و رمز (Basic Auth)

## نحوه‌ی کار

ساختار مورد انتظار روی share هر سرور:

```
<path>/FULLBK/<db1>/2026-01-01.bak     ← چند دیتابیسه: یک پوشه برای هر دیتابیس
<path>/FULLBK/<db2>/...
<path>/FULLBK/2026-01-01.bak           ← تک دیتابیسه: فایل‌ها مستقیم داخل پوشه
<path>/DIFFBK/...                      ← همین منطق برای Diff
```

نام پوشه‌های `FULLBK` و `DIFFBK` و پسوند فایل‌ها (پیش‌فرض `.bak`) قابل تغییر است. در سرور تک‌دیتابیسه، نام دیتابیس همان نام سرور نمایش داده می‌شود.

| وضعیت | شرط |
|-------|------|
| **مشکل** | مسیر share یا پوشه‌ی Full در دسترس نیست، بکاپی پیدا نشد، فایل بکاپ خالی است، یا آخرین بکاپ قدیمی‌تر از حد مجاز است (پیش‌فرض ۲۶ ساعت برای Full و Diff) |
| **هشدار** | حجم آخرین Full بیش از ۵۰٪ (قابل تنظیم) نسبت به بکاپ قبلی کم شده است |
| **سالم** | بقیه‌ی حالت‌ها |

## اجرای سریع (محیط تست)

پیش‌نیاز: Python 3.10 یا بالاتر.

```bash
git clone https://github.com/<your-account>/backup-monitor.git
cd backup-monitor
python -m venv venv

# لینوکس / مک
source venv/bin/activate
# ویندوز (PowerShell)
.\venv\Scripts\Activate.ps1

pip install -r requirements.txt
python app.py
```

سپس <http://127.0.0.1:8080> را باز کنید و از صفحه‌ی **تنظیمات** اولین سرور را اضافه کنید.
فایل `config.json` در اولین ذخیره‌ی تنظیمات خودکار ساخته می‌شود.

> `python app.py` سرور داخلی Flask را اجرا می‌کند و فقط برای تست مناسب است. برای اجرای دائمی از `run_server.py` (Waitress) استفاده کنید؛ راهنما در ادامه آمده است.

## تنظیمات

همه‌ی تنظیمات از صفحه‌ی `/settings` انجام می‌شود و در `config.json` کنار `app.py` ذخیره می‌شود. بعد از هر ذخیره، یک اسکن جدید خودکار شروع می‌شود. فقط تغییر `host` و `port` نیاز به راه‌اندازی مجدد دارد.

```json
{
  "host": "127.0.0.1",
  "port": 8080,
  "scan_interval_minutes": 15,
  "auth": { "username": "admin", "password": "یک-رمز-قوی" },
  "defaults": {
    "full_dir": "FULLBK",
    "diff_dir": "DIFFBK",
    "extensions": [".bak"],
    "full_max_age_hours": 26,
    "diff_max_age_hours": 26,
    "size_drop_warning_percent": 50,
    "exclude_dirs": ["tmp_*"]
  },
  "servers": [
    { "name": "SQL-01", "path": "\\\\sql01\\backup" },
    { "name": "SQL-02", "path": "\\\\sql02\\backup", "diff_max_age_hours": 6, "exclude_dirs": ["old_*"] },
    { "name": "SQL-03", "path": "D:\\Backups\\sql03", "diff_dir": null }
  ]
}
```

| کلید | توضیح |
|------|-------|
| `host` / `port` | آدرس و پورت پنل. `127.0.0.1` فقط همان سیستم؛ `0.0.0.0` کل شبکه |
| `scan_interval_minutes` | فاصله‌ی اسکن خودکار |
| `auth` | اختیاری. **فقط از روی فایل** تنظیم می‌شود (از پنل قابل تغییر نیست). اگر بگذارید کل پنل و API با Basic Auth قفل می‌شود |
| `defaults.*` | مقدارهای پیش‌فرض برای همه‌ی سرورها |
| `servers[].name` / `path` | نام سرور (یکتا) و مسیر share. روی ویندوز مسیر UNC، روی لینوکس مسیر mount |
| `servers[].full_dir` / `diff_dir` | override نام پوشه‌ها. `"diff_dir": null` یعنی این سرور Diff ندارد |
| `servers[].full_max_age_hours` / `diff_max_age_hours` | override حداکثر عمر بکاپ |
| `exclude_dirs` | نام پوشه‌هایی که پایش نمی‌شوند؛ بدون حساسیت به حروف بزرگ/کوچک و با پشتیبانی از `*`. لیست سراسری و لیست هر سرور با هم ترکیب می‌شوند |

> `config.json` در `.gitignore` است چون مسیر سرورها و رمز پنل را دارد. آن را در گیت‌هاب commit نکنید.

---

## دیپلوی روی Windows Server

### ۱. نصب

۱. Python 3.10+ را از [python.org](https://www.python.org/downloads/windows/) نصب کنید و تیک **Add python to PATH** را بزنید.
۲. پروژه را در `C:\BackupMonitor` قرار دهید و در PowerShell:

```powershell
cd C:\BackupMonitor
python -m venv venv
.\venv\Scripts\pip install -r requirements.txt
```

۳. اجرای آزمایشی:

```powershell
.\venv\Scripts\python run_server.py
```

### ۲. تبدیل به سرویس ویندوز (NSSM)

[NSSM](https://nssm.cc/download) را دانلود کنید و در PowerShell با دسترسی Administrator:

```powershell
nssm install BackupMonitor "C:\BackupMonitor\venv\Scripts\python.exe" "C:\BackupMonitor\run_server.py"
nssm set BackupMonitor AppDirectory "C:\BackupMonitor"
nssm set BackupMonitor Start SERVICE_AUTO_START
nssm set BackupMonitor AppStdout "C:\BackupMonitor\out.log"
nssm set BackupMonitor AppStderr "C:\BackupMonitor\err.log"
```

**حساب سرویس (مهم‌ترین نکته):** در `services.msc` سرویس **BackupMonitor** را باز کنید و در تب **Log On** حسابی را بگذارید که به shareهای بکاپ **دسترسی خواندن (Read)** دارد (هم Share Permission و هم NTFS Permission). با حساب پیش‌فرض Local System معمولاً به share شبکه دسترسی ندارید و پنل «مسیر share در دسترس نیست» نشان می‌دهد.

**مسیر شبکه** را به‌صورت UNC بدهید (`\\sql01\backup`)، نه درایو مپ‌شده (`Z:`)؛ درایو مپ‌شده داخل سرویس دیده نمی‌شود.

```powershell
nssm start BackupMonitor
```

> به‌جای NSSM می‌توانید یک **Scheduled Task** با Trigger «At startup»، گزینه‌ی «Run whether user is logged on or not» و همان حساب دارای دسترسی بسازید که `python.exe run_server.py` را اجرا کند.

### ۳. دسترسی از شبکه

در صفحه‌ی تنظیمات (بخش «پیشرفته») آدرس را `0.0.0.0` بگذارید، ذخیره کنید، سرویس را ری‌استارت کنید و فایروال را باز کنید:

```powershell
New-NetFirewallRule -DisplayName "Backup Monitor" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

حتماً بخش `auth` را در `config.json` بگذارید (بخش [امنیت](#امنیت) را ببینید).

### ۴. (اختیاری) ساب‌دامین روی IIS با Reverse Proxy

اگر می‌خواهید کاربر با آدرسی مثل `db.example.com` وارد شود، IIS را به‌صورت reverse proxy جلوی برنامه بگذارید. (ریدایرکت ساده آدرس را عوض می‌کند؛ برای حفظ ساب‌دامین باید پروکسی کرد.)

۱. ماژول‌های **URL Rewrite** و **Application Request Routing (ARR)** را نصب کنید.
۲. در IIS Manager روی نام سرور کلیک کنید ← `Application Request Routing Cache` ← `Server Proxy Settings` ← **Enable proxy** را بزنید و Time-out را به ۱۲۰ ثانیه برسانید (اسکن دستی روی shareهای کند ممکن است طول بکشد).
۳. یک Site جدید با Host name برابر `db.example.com` و یک پوشه‌ی خالی (مثلاً `C:\inetpub\db-proxy`) بسازید و در DNS رکورد A آن را بسازید.
۴. داخل پوشه‌ی سایت فایل `web.config` بسازید (آدرس سرور برنامه را عوض کنید):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="HttpsRedirect" stopProcessing="true">
          <match url="(.*)" />
          <conditions><add input="{HTTPS}" pattern="off" /></conditions>
          <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
        </rule>
        <rule name="BackupMonitorProxy" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:8080/{R:1}" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

اگر برنامه روی سرور دیگری است، `127.0.0.1` را با IP همان سرور عوض کنید، `host` برنامه را `0.0.0.0` بگذارید و فایروال را فقط برای IP سرور IIS باز کنید. قانون `HttpsRedirect` را فقط وقتی نگه دارید که برای سایت گواهی SSL دارید.

### به‌روزرسانی

```powershell
cd C:\BackupMonitor
git pull
.\venv\Scripts\pip install -r requirements.txt
nssm restart BackupMonitor
```

---

## دیپلوی روی Linux Server

مثال برای Ubuntu/Debian است؛ روی RHEL/Rocky/Alma به‌جای `apt` از `dnf` استفاده کنید.

### ۱. پیش‌نیازها و کاربر سرویس

```bash
sudo apt update
sudo apt install -y python3 python3-venv git cifs-utils
sudo useradd --system --home /opt/backup-monitor --shell /usr/sbin/nologin backupmon
```

### ۲. نصب برنامه

```bash
sudo git clone https://github.com/<your-account>/backup-monitor.git /opt/backup-monitor
sudo chown -R backupmon:backupmon /opt/backup-monitor
cd /opt/backup-monitor
sudo -u backupmon python3 -m venv venv
sudo -u backupmon venv/bin/pip install -r requirements.txt
```

> کاربر سرویس باید در پوشه‌ی برنامه **اجازه‌ی نوشتن** داشته باشد، چون `config.json` از پنل ذخیره می‌شود.

### ۳. mount کردن shareهای ویندوزی (فقط‌خواندنی)

برای هر share یک فایل credential بسازید:

```bash
sudo mkdir -p /etc/backup-monitor /mnt/backups/sql01
sudo tee /etc/backup-monitor/sql01.cred > /dev/null << 'EOF'
username=svc_backupmon
password=CHANGE_ME
domain=MYDOMAIN
EOF
sudo chmod 600 /etc/backup-monitor/sql01.cred
```

خط زیر را به `/etc/fstab` اضافه کنید:

```
//sql01/backup  /mnt/backups/sql01  cifs  credentials=/etc/backup-monitor/sql01.cred,ro,uid=backupmon,gid=backupmon,vers=3.0,_netdev,nofail  0  0
```

```bash
sudo mount -a
ls /mnt/backups/sql01        # باید پوشه‌های FULLBK و DIFFBK را ببینید
```

سپس در پنل، مسیر سرور را `/mnt/backups/sql01` بدهید. اگر سرور قدیمی است و mount خطا داد، `vers=2.1` یا `vers=3.1.1` را امتحان کنید.

### ۴. سرویس systemd

فایل `/etc/systemd/system/backup-monitor.service`:

```ini
[Unit]
Description=Backup Monitor
After=network-online.target remote-fs.target
Wants=network-online.target

[Service]
Type=simple
User=backupmon
Group=backupmon
WorkingDirectory=/opt/backup-monitor
ExecStart=/opt/backup-monitor/venv/bin/python run_server.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now backup-monitor
sudo systemctl status backup-monitor
journalctl -u backup-monitor -f        # لاگ زنده
```

### ۵. (اختیاری) Nginx و HTTPS

بهتر است `host` برنامه روی `127.0.0.1` بماند و فقط Nginx به بیرون باز باشد:

```bash
sudo apt install -y nginx
```

فایل `/etc/nginx/sites-available/backup-monitor`:

```nginx
server {
    listen 80;
    server_name db.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 120s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/backup-monitor /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d db.example.com        # HTTPS رایگان
```

روی RHEL/Rocky اگر SELinux فعال است، اجازه‌ی اتصال Nginx به برنامه را بدهید: `sudo setsebool -P httpd_can_network_connect 1`

فایروال (UFW):

```bash
sudo ufw allow 'Nginx Full'
```

اگر بدون Nginx و مستقیم از شبکه می‌خواهید، `host` را `0.0.0.0` بگذارید و پورت برنامه را در فایروال باز کنید.

### به‌روزرسانی

```bash
cd /opt/backup-monitor
sudo -u backupmon git pull
sudo -u backupmon venv/bin/pip install -r requirements.txt
sudo systemctl restart backup-monitor
```

---

## امنیت

- پنل به‌صورت پیش‌فرض **بدون رمز** است و صفحه‌ی تنظیمات می‌تواند مسیرها و نام پوشه‌ها را ببیند و تغییر دهد. اگر `host` را روی `0.0.0.0` گذاشتید حتماً `auth` را در `config.json` فعال کنید.
- Basic Auth رمز را رمزنگاری‌نشده می‌فرستد؛ برای دسترسی از بیرون از شبکه‌ی داخلی حتماً پشت HTTPS (Nginx / IIS) بگذارید.
- حساب سرویس و mount فقط به **دسترسی خواندن** نیاز دارند. به آن‌ها دسترسی نوشتن ندهید.
- فقط **یک پروسس** از برنامه اجرا کنید (چند worker نه)، چون حلقه‌ی اسکن داخل همان پروسس اجرا می‌شود.

## API

| مسیر | متد | توضیح |
|------|------|-------|
| `/api/status` | GET | آخرین نتیجه‌ی اسکن |
| `/api/refresh` | POST | اسکن فوری و برگرداندن نتیجه |
| `/api/config` | GET / PUT | خواندن و ذخیره‌ی تنظیمات (`auth` برگردانده نمی‌شود) |
| `/api/folders` | POST | تست مسیر share و فهرست پوشه‌ها با تعداد فایل (برای انتخاب exclude) |
| `/api/exclude` | POST | افزودن یک پوشه به لیست exclude یک سرور |

## عیب‌یابی

| مشکل | راه‌حل |
|------|--------|
| «مسیر share در دسترس نیست» | با همان حساب سرویس تست کنید (`dir \\sql01\backup\FULLBK` در ویندوز، `ls /mnt/backups/sql01` در لینوکس) و Share/NTFS Permission را بررسی کنید. روی ویندوز از درایو مپ‌شده استفاده نکنید |
| «پوشه FULLBK پیدا نشد» | در کارت همان سرور، «پوشه‌ی Full (اختیاری)» را به نام واقعی پوشه تغییر دهید یا از دکمه‌ی «تشخیص پوشه‌ها» استفاده کنید |
| فایل‌ها پیدا نمی‌شوند ولی پوشه‌ها هستند | پسوند فایل‌ها را بررسی کنید؛ پیش‌فرض فقط `.bak` است. پسوندهای دیگر (`.sqb`, `.zip`, ...) را در تنظیمات عمومی اضافه کنید |
| یک پوشه‌ی خالی یا قدیمی هر روز خطا می‌دهد | آن را در لیست exclude بگذارید (از صفحه‌ی تنظیمات یا لینک «نادیده گرفتن این پوشه» در صفحه‌ی پایش) |
| بعد از به‌روزرسانی ظاهر صفحه عوض نشد | یک بار Ctrl+F5 بزنید تا کش مرورگر پاک شود |
| خطای 502 پشت IIS یا Nginx | اتصال از سرور پروکسی به برنامه را تست کنید (`Test-NetConnection <ip> -Port 8080` یا `curl http://127.0.0.1:8080`) و فایروال و `host` برنامه را بررسی کنید |

## ساختار پروژه

```
backup-monitor/
├── app.py            # بک‌اند Flask: اسکن shareها، ارزیابی وضعیت، API
├── run_server.py     # اجرای پایدار با Waitress (ویندوز/لینوکس)
├── requirements.txt
├── config.json       # تنظیمات (خودکار ساخته می‌شود؛ در گیت نیست)
└── static/
    ├── index.html    # داشبورد
    ├── settings.html # صفحه‌ی تنظیمات
    ├── style.css
    ├── common.js     # توابع مشترک
    ├── app.js        # منطق داشبورد
    └── settings.js   # منطق صفحه‌ی تنظیمات
```

تعداد ردیف‌های جدول تاریخچه با ثابت `HISTORY_LIMIT` در `app.py` تغییر می‌کند.

**فونت (اختیاری):** اگر فایل‌های `Inter.woff2` و `Vazirmatn.woff2` را در `static/fonts/` بگذارید، خودکار استفاده می‌شوند؛ وگرنه فونت سیستم نمایش داده می‌شود (خطای ۴۰۴ این دو فایل در کنسول مرورگر بی‌ضرر است).

## مجوز

مجوز پروژه را اینجا مشخص کنید (مثلاً MIT).

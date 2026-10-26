const form = document.getElementById("loginForm");
const err  = document.getElementById("loginError");
const btn  = document.getElementById("submitBtn");
const pwd  = document.getElementById("password");

document.getElementById("togglePwd").onclick = () => {
  const show = pwd.type === "password";
  pwd.type = show ? "text" : "password";
  document.getElementById("togglePwd").textContent = show ? "مخفی" : "نمایش";
};

form.onsubmit = async (e) => {
  e.preventDefault();
  err.hidden = true;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "در حال بررسی…";
  try {
    const r = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("username").value.trim(),
        password: pwd.value,
        next: new URLSearchParams(location.search).get("next") || "/",
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "ورود ناموفق بود");
    location.href = data.next || "/";
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = orig;
    pwd.select();
  }
};
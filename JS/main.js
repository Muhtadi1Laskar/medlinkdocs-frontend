// Set this to your API root (no trailing slash).
const API = "https://medlinkdocs.onrender.com/api/v1";
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const svg = p => `<svg width="22" height="22" viewBox="0 0 24 24">${p}</svg>`;
const I = {
    dash: svg('<path d="M4 7h16M4 12h10M4 17h13"/>'),
    doc: svg('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>'),
    add: svg('<path d="M12 5v14M5 12h14"/>'),
    out: svg('<path d="M12 3v8"/><path d="M6.5 6.5a8 8 0 1 0 11 0"/>')
};
let token = "", user = null, reports = [], view = "dash", loaded = false, loadErr = "", fday = "", calM = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
// Authentication is shared across tabs for this browser profile. This enforces one
// active account per origin; opening another tab reuses the same login.
try { token = localStorage.getItem("mld_token") || ""; user = JSON.parse(localStorage.getItem("mld_user") || "null"); } catch (e) { }
const save = () => {
    try {
        // Write user first and token last; other tabs use the token event as the commit signal.
        if (user) localStorage.setItem("mld_user", JSON.stringify(user));
        else localStorage.removeItem("mld_user");
        if (token) localStorage.setItem("mld_token", token);
        else localStorage.removeItem("mld_token");
    } catch (e) { }
};
const p2 = n => String(n).padStart(2, "0");
const localDateValue = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const fmt = d => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fshort = d => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
const isOk = s => String(s || "").toLowerCase() === "resolved";
const sorted = () => [...reports].sort((a, b) => new Date(b.test_date) - new Date(a.test_date));

function toast(msg, bad) {
    const t = document.createElement("div"); t.className = "toast" + (bad ? " bad" : ""); t.textContent = msg;
    document.body.append(t); setTimeout(() => t.remove(), 3500);
}
async function api(path, opts = {}) {
    const auth = path.startsWith("/auth/");
    if (token && !auth && sessionExpired()) { endSession(); throw new Error("Your session expired. Please sign in again."); }
    const headers = { ...(opts.headers || {}) };
    if (token) headers.Authorization = "Bearer " + token;
    if (opts.json) { headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(opts.json); }
    let res;
    try { res = await fetch(API + path, { method: opts.method || "GET", headers, body: opts.body }); }
    catch (e) { throw new Error("Can't reach the server. It may be waking up; try again in a few seconds."); }
    const raw = await res.text();
    let data = {};
    if (raw.trim()) {
        try { data = JSON.parse(raw); }
        catch { throw new Error(`The server returned an unreadable response (HTTP ${res.status}). Check the API response and server logs.`); }
    }
    if (!res.ok || data.success === false) {
        const code = data.error?.code || "", msg = data.error?.message || data.message || "Request failed (" + res.status + ")";
        if (token && !auth && (res.status === 401 || res.status === 403 || code === "INVALID_CREDENTIALS" || /token|jwt|unauthori|expired|session/i.test(code + " " + msg))) {
            endSession(); throw new Error("Your session expired. Please sign in again.");
        }
        const er = new Error(msg); er.code = code; throw er;
    }
    return data;
}

/* ---------- session ---------- */
function jwtExp(t) {
    try { const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return p.exp ? p.exp * 1000 : 0; } catch (e) { return 0; }
}
const sessionExpired = () => { const e = jwtExp(token); return !!e && e <= Date.now(); };
let sessTimer;
function watchSession() {
    clearTimeout(sessTimer); const e = jwtExp(token);
    if (token && e) sessTimer = setTimeout(checkSession, Math.min(Math.max(e - Date.now(), 0) + 500, 2147483647));
}
function checkSession() { if (token && sessionExpired()) endSession(); }
function endSession() { if (!token) return; logout(); toast("Your session expired. Please sign in again.", true); }
function logout() {
    clearTimeout(sessTimer);
    document.querySelectorAll("dialog[open]").forEach(d => d.close());
    token = ""; user = null; reports = []; loaded = false; view = "dash"; save(); render();
}
// Keep every open tab on the same account/session. A login in another tab replaces
// the shared session; a logout clears it everywhere.
window.addEventListener("storage", event => {
    if (event.storageArea !== localStorage || event.key !== "mld_token") return;
    let nextToken = "", nextUser = null;
    try {
        nextToken = localStorage.getItem("mld_token") || "";
        nextUser = JSON.parse(localStorage.getItem("mld_user") || "null");
    } catch (e) { }
    if (nextToken === token) return;
    clearTimeout(sessTimer);
    token = nextToken; user = nextUser; reports = []; loaded = false; loadErr = ""; view = "dash";
    if (token) watchSession();
    document.querySelectorAll("dialog[open]").forEach(d => d.close());
    render();
    if (token) toast("Your account session was updated in another tab.");
    else toast("You have been signed out in another tab.", true);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkSession(); });
window.addEventListener("focus", checkSession);
setInterval(checkSession, 30000);

/* ---------- auth ---------- */
let mode = "login";
function authView() {
    const reg = mode === "register";
    $("#app").innerHTML = `<div class="auth"><div class="auth-box">
    <div class="chain"><i></i><b></b><i></i><b></b><i></i></div>
    <div class="logo">MedLinkedDocs</div>
    <h2 style="margin-top:14px">${reg ? "Create your account" : "Welcome back"}</h2>
    <div class="sub" style="margin:4px 0 0">${reg ? "Start your report timeline." : "Sign in to see your timeline."}</div>
    <div class="seg"><button data-m="login" class="${reg ? "" : "on"}">Sign in</button><button data-m="register" class="${reg ? "on" : ""}">Create account</button></div>
    <form id="af" novalidate>
      ${reg ? `<div class="r2"><div class="field"><label for="fn">First name</label><input id="fn" autocomplete="given-name"></div>
      <div class="field"><label for="ln">Last name</label><input id="ln" autocomplete="family-name"></div></div>` : ""}
      <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="email"></div>
      <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="${reg ? "new-password" : "current-password"}"></div>
      <div class="err" id="ae" role="alert"></div>
      <button class="btn block" id="ab">${reg ? "Create account" : "Sign in"}</button>
    </form></div></div>`;
    document.querySelectorAll(".seg button").forEach(b => b.onclick = () => { mode = b.dataset.m; authView(); });
    $("#af").onsubmit = async e => {
        e.preventDefault();
        const email = $("#em").value.trim(), password = $("#pw").value, err = $("#ae"), btn = $("#ab");
        const body = reg ? { firstName: $("#fn").value.trim(), lastName: $("#ln").value.trim(), email, password } : { email, password };
        if (!email || !password || (reg && (!body.firstName || !body.lastName))) { err.textContent = "Fill in every field."; return; }
        btn.disabled = true; err.textContent = "";
        try {
            if (reg) { await api("/auth/register", { method: "POST", json: body }); toast("Account created. Signing you in…"); }
            const r = await api("/auth/login", { method: "POST", json: { email, password } });
            token = r.authToken || r.data?.authToken;
            const u = r.users || r.data?.users || r.data?.user || {};
            user = { name: u.name || [u.firstName, u.lastName].filter(Boolean).join(" ") || email.split("@")[0], email };
            if (!token) throw new Error("Login worked but no token came back.");
            save(); watchSession(); render();
        } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    };
}

/* ---------- shell ---------- */
function ni(k, label, kind) { return `<button class="ni${k === "add" && kind === "tab" ? " add" : ""}" data-nav="${k}"><span class="ic">${I[k]}</span>${label}</button>`; }
function appView() {
    const name = user?.name || "", ini = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() || "U";
    $("#app").innerHTML = `<header class="mbar"><div class="logo">MedLinkedDocs</div><div class="av">${esc(ini)}</div></header><div class="shell"><aside class="side"><div class="logo">MedLinkedDocs</div>
    <nav class="nav">${ni("dash", "Dashboard")}${ni("doc", "Reports")}${ni("add", "Add report")}</nav>
    <div class="me"><div class="av">${esc(ini)}</div>${esc(name)}<button class="lo" data-nav="out">${I.out.replace('width="22" height="22"', 'width="18" height="18"')} Log out</button></div></aside>
    <section class="content" id="content"></section></div>
    <nav class="tabs" aria-label="Main">${ni("dash", "Home", "tab")}${ni("doc", "Reports", "tab")}${ni("add", "Add", "tab")}${ni("out", "Log out", "tab")}</nav>`;
    document.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => {
        const n = b.dataset.nav;
        if (n === "add") return uploadDlg();
        if (n === "out") return logout();
        fday = ""; go(n === "doc" ? "reports" : "dash");
    });
    loadReports();
}
function go(v) { view = v; window.scrollTo(0, 0); show(); }
async function loadReports() {
    loaded = false; loadErr = ""; show();
    try { reports = (await api("/documents/retrive/all")).data?.reports || []; } catch (e) { loadErr = e.message; }
    loaded = true; show();
}
function show() {
    document.querySelectorAll("[data-nav]").forEach(b => b.classList.toggle("on", (b.dataset.nav === "dash" && view === "dash") || (b.dataset.nav === "doc" && view === "reports")));
    const c = $("#content"); if (!c) return;
    if (!loaded) { c.innerHTML = `<div class="empty">Loading your reports…</div>`; return; }
    if (loadErr) { c.innerHTML = `<div class="empty"><h2>Couldn't load reports</h2>${esc(loadErr)}<br><br><button class="btn" id="rt">Try again</button></div>`; $("#rt").onclick = loadReports; return; }
    view === "dash" ? dashView() : listView();
}

/* ---------- dashboard ---------- */
function dashView() {
    const s = sorted(), total = reports.length, res = reports.filter(r => isOk(r.follow_up_status)).length, ong = total - res;
    const pct = n => total ? Math.round(n / total * 100) : 0;
    const y = calM.getFullYear(), m = calM.getMonth(), lead = new Date(y, m, 1).getDay(), dim = new Date(y, m + 1, 0).getDate();
    const has = new Set(reports.map(r => String(r.test_date).slice(0, 10))), t = new Date(), tk = `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`;
    let cells = "SMTWTFS".split("").map(d => `<b>${d}</b>`).join("") + `<i class="pad"></i>`.repeat(lead);
    for (let d = 1; d <= dim; d++) {
        const k = `${y}-${p2(m + 1)}-${p2(d)}`, cl = (has.has(k) ? "has " : "") + (k === tk ? "today" : "");
        cells += has.has(k) ? `<button class="${cl}" data-d="${k}" aria-label="Reports on ${k}">${d}</button>` : `<i class="${cl}">${d}</i>`;
    }
    const first = (user?.name || "").split(" ")[0] || "there";
    const cards = s.slice(0, 8).map((r, i) => `<div class="pw${i ? "" : " f"}"><button class="pc${i ? "" : " f"}" data-v="${esc(r.report_id)}"><span class="pi">${I.doc}</span><b>${esc(r.title)}</b><small>${esc(r.test_type)}</small></button>${i ? "" : "Latest · "}${fshort(r.test_date)}</div>`).join("");
    $("#content").innerHTML = `<div class="dash">
   <h1>Your dashboard</h1><p class="sub">Where your reports stand</p>
   <div class="col2"><div class="top">
     <div class="card cal"><h2><button class="mv" data-cm="-1" aria-label="Previous month">‹</button><span>${calM.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span><button class="mv" data-cm="1" aria-label="Next month">›</button></h2><div class="cg">${cells}</div></div>
     <div class="card hello"><h2>Hello, ${esc(first)}!</h2><p>${total ? `You have ${total} report${total > 1 ? "s" : ""} on your timeline${ong ? `, ${ong} still ongoing` : ", all resolved"}.` : "Your timeline is empty. Add your first report to get started."}</p><button class="btn" id="h-add">Add report</button></div></div>
     <div class="card"><h2 class="hd">Latest reports<button class="lnk" id="d-all">View all</button></h2>${cards ? `<div class="sc">${cards}</div>` : `<div class="empty small" style="margin-top:14px">No reports yet.</div>`}</div>
     <div class="card"><h2>Overview</h2><div class="ovs">
       <div class="ov"><span class="pi">${I.doc}</span><div class="bd"><b>Resolved</b><div class="pb"><span><i style="width:${pct(res)}%"></i></span><em>${pct(res)}%</em></div></div></div>
       <div class="ov"><span class="pi">${I.doc}</span><div class="bd"><b>Ongoing</b><div class="pb w"><span><i style="width:${pct(ong)}%"></i></span><em style="color:#19a7f0">${pct(ong)}%</em></div></div></div>
     </div></div></div>
  </div>`;
    const c = $("#content");
    c.querySelectorAll("[data-v]").forEach(b => b.onclick = () => viewer(b.dataset.v));
    c.querySelectorAll("[data-d]").forEach(b => b.onclick = () => { fday = b.dataset.d; go("reports"); });
    c.querySelectorAll("[data-cm]").forEach(b => b.onclick = () => { calM = new Date(y, m + Number(b.dataset.cm), 1); dashView(); });
    $("#h-add").onclick = uploadDlg;
    $("#d-all").onclick = () => { fday = ""; go("reports"); };
}

/* ---------- reports timeline ---------- */
function listView() {
    $("#content").innerHTML = `<h1>Your reports</h1><p class="sub">Every test, in order</p>
   <div class="bar"><input id="q" type="search" placeholder="Search by title, test, doctor or center" aria-label="Search reports">
   <select id="st" aria-label="Filter by status"><option value="">All statuses</option><option value="resolved">Resolved</option><option value="ongoing">Ongoing</option></select></div>
   ${fday ? `<button class="chip" id="clear-day-filter">Showing ${fmt(fday)} ✕</button>` : ""}<div id="list"></div>`;
    $("#q").oninput = $("#st").onchange = drawList;
    if (fday) $("#clear-day-filter").onclick = () => { fday = ""; listView(); };
    drawList();
}
function drawList() {
    const q = $("#q").value.toLowerCase(), st = $("#st").value;
    const items = sorted().filter(r => (!fday || String(r.test_date).slice(0, 10) === fday) && (!st || String(r.follow_up_status).toLowerCase() === st) &&
        [r.title, r.test_type, r.doctor_name, r.diagnostic_center_name].join(" ").toLowerCase().includes(q));
    if (!items.length) {
        $("#list").innerHTML = reports.length ? `<div class="empty"><h2>No matches</h2>Try a different search or status.</div>`
            : `<div class="empty"><h2>Your timeline is empty</h2>Add your first report to start it.<br><br><button class="btn" id="add2">Add report</button></div>`;
        if ($("#add2")) $("#add2").onclick = uploadDlg; return;
    }
    let html = `<div class="tl">`, yr = "";
    for (const r of items) {
        const y = new Date(r.test_date).getUTCFullYear();
        if (y !== yr) { yr = y; html += `<div class="yr">${y}</div>`; }
        const ok = isOk(r.follow_up_status);
        html += `<article class="node ${ok ? "ok" : "wait"}"><div class="date">${fmt(r.test_date)}</div>
      <h3>${esc(r.title)}<span class="pill ${ok ? "ok" : "wait"}">${ok ? "Resolved" : esc(r.follow_up_status || "Ongoing")}</span></h3>
      <div class="meta">${esc(r.test_type)} · ${esc(r.diagnostic_center_name)} · ${esc(r.doctor_name)}</div>
      <dl class="qa"><div><dt>What prompted the test</dt><dd>${esc(r.reason_for_test)}</dd></div>
      <div><dt>What the doctor found</dt><dd>${esc(r.doctor_findings)}</dd></div></dl>
      <div class="acts"><button class="btn sm" data-a="view" data-id="${esc(r.report_id)}">View report</button>
      <button class="btn ghost sm" data-a="dl" data-id="${esc(r.report_id)}">Download</button>
      <button class="btn ghost danger sm" data-a="del" data-id="${esc(r.report_id)}">Delete</button></div></article>`;
    }
    $("#list").innerHTML = html + `</div>`;
    $("#list").querySelectorAll("[data-a]").forEach(b => b.onclick = () => act(b));
}
async function act(b) {
    const id = b.dataset.id, a = b.dataset.a;
    if (a === "del") return delReport(id);
    if (a === "view") return viewer(id);
    b.disabled = true;
    try { location.href = (await getLink(id, true)).fileURL; } catch (e) { toast(e.message, true); }
    b.disabled = false;
}
async function getLink(id, dl) {
    const r = await api("/documents/retrive/link", { method: "POST", json: { reportId: id, isDownloadAble: dl } });
    const rep = r.data?.report;
    if (!rep?.fileURL) throw new Error("No file is attached to this report.");
    let parsed;
    try { parsed = new URL(rep.fileURL); } catch { throw new Error("The server returned an invalid file URL."); }
    if (parsed.protocol !== "https:") throw new Error("The server returned an insecure file URL.");
    return { ...rep, fileURL: parsed.href };
}

/* ---------- delete ---------- */
const DELETE_METHOD = "DELETE"; // change to "POST" if your route expects that
function confirmDlg(title, msg) {
    return new Promise(res => {
        const d = $("#confirm-dialog"); let ok = false;
        d.innerHTML = `<h2 style="font-size:20px;margin-bottom:8px">${esc(title)}</h2><p class="sub" style="margin:0 0 22px">${esc(msg)}</p>
      <div class="acts" style="justify-content:flex-end"><button class="btn ghost" id="cn">Cancel</button><button class="btn dsolid" id="cy">Delete</button></div>`;
        d.showModal();
        $("#cn").onclick = () => d.close();
        $("#cy").onclick = () => { ok = true; d.close(); };
        d.onclick = e => { if (e.target === d) d.close(); };
        d.onclose = () => res(ok);
    });
}
async function delReport(id) {
    const r = reports.find(x => x.report_id === id) || {};
    if (!await confirmDlg(`Delete "${r.title || "this report"}"?`, "This removes the report and its file. You can't undo this.")) return;
    try {
        await api("/documents/delete", { method: DELETE_METHOD, json: { reportId: id } });
        reports = reports.filter(x => x.report_id !== id);
        toast("Report deleted");
    } catch (e) {
        toast(e.message, true);
        if (e.code === "NO_DATA_FOUND") reports = reports.filter(x => x.report_id !== id);
        else return;
    }
    if (token) view === "reports" ? drawList() : show();
}

/* ---------- viewer ---------- */
async function viewer(id) {
    const r = reports.find(x => x.report_id === id) || {}, v = $("#vw");
    v.innerHTML = `<div class="vh"><h2>${esc(r.title)}</h2><button class="btn ghost sm" id="vd">Download</button><button class="btn sm" id="vc">Close</button></div>
    <div class="vb" id="vb"><div class="spin" role="status" aria-label="Loading report"></div></div><div class="vf" id="vf"></div>`;
    v.showModal();
    $("#vc").onclick = () => v.close();
    v.onclick = e => { if (e.target === v) v.close(); };
    v.onclose = () => { v.innerHTML = ""; };
    $("#vd").onclick = async e => {
        e.target.disabled = true;
        try { location.href = (await getLink(id, true)).fileURL; } catch (x) { toast(x.message, true); }
        e.target.disabled = false;
    };
    try {
        const rep = await getLink(id, false);
        if (!v.open) return;
        const url = esc(rep.fileURL);
        const img = String(rep.mimeType || "").startsWith("image/");
        $("#vb").innerHTML = img ? `<img src="${url}" alt="${esc(r.title)}">` : `<iframe src="${url}" title="${esc(r.title)}"></iframe>`;
        $("#vf").innerHTML = `Preview not showing? <a href="${url}" target="_blank" rel="noopener">Open in a new tab</a>`;
    } catch (e) { if (v.open && $("#vb")) $("#vb").innerHTML = `<div class="hint">${esc(e.message)}</div>`; }
}

/* ---------- upload ---------- */
function uploadDlg() {
    const d = $("#dlg"), today = localDateValue(new Date());
    d.innerHTML = `<form id="uf" novalidate><h2 style="margin-bottom:16px">Add a report</h2>
    <div class="drop" id="drop" tabindex="0" role="button"><span id="dn">Choose the report file or drop it here</span><small>PDF or image</small>
      <input type="file" id="file" accept="application/pdf,image/*" hidden></div>
    <div class="field"><label for="t">Title</label><input id="t" name="title" placeholder="e.g. Smell in urine"></div>
    <div class="r2"><div class="field"><label for="tt">Test type</label><input id="tt" name="testType" placeholder="e.g. Urine culture"></div>
    <div class="field"><label for="td">Test date</label><input id="td" name="testDate" type="date" max="${today}" value="${today}"></div></div>
    <div class="field"><label for="rf">What prompted the test?</label><textarea id="rf" name="reasonForTest"></textarea></div>
    <div class="field"><label for="df">What did the doctor find?</label><textarea id="df" name="doctorFindings"></textarea></div>
    <div class="r2"><div class="field"><label for="dn2">Doctor</label><input id="dn2" name="doctorName"></div>
    <div class="field"><label for="dc">Diagnostic center or hospital</label><input id="dc" name="diagnosticCenterName"></div></div>
    <div class="field"><label for="fs">Is it resolved?</label><select id="fs" name="followUpStatus"><option value="ongoing">Ongoing</option><option value="resolved">Resolved</option></select></div>
    <div class="err" id="ue" role="alert"></div>
    <div class="acts" style="justify-content:flex-end"><button type="button" class="btn ghost" id="cx">Cancel</button><button class="btn" id="us">Save report</button></div></form>`;
    d.showModal();
    const file = $("#file"), drop = $("#drop");
    const pick = f => { if (f) $("#dn").textContent = f.name; };
    drop.onclick = () => file.click();
    drop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } };
    file.onchange = () => pick(file.files[0]);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); file.files = e.dataTransfer.files; pick(file.files[0]); };
    $("#cx").onclick = () => d.close();
    $("#uf").onsubmit = async e => {
        e.preventDefault();
        const fd = new FormData(e.target), err = $("#ue"), btn = $("#us");
        for (const [k, v] of fd.entries()) if (typeof v === "string" && !v.trim()) { err.textContent = "Fill in every field."; return; }
        const selected = file.files[0];
        if (!selected) { err.textContent = "Attach the report file."; return; }
        const allowed = selected.type === "application/pdf" || selected.type.startsWith("image/");
        if (!allowed) { err.textContent = "Choose a PDF or image file."; return; }
        if (selected.size > 15 * 1024 * 1024) { err.textContent = "The file must be 15 MB or smaller."; return; }
        fd.append("files", selected);
        btn.disabled = true; btn.textContent = "Saving…"; err.textContent = "";
        try { await api("/documents/upload", { method: "POST", body: fd }); d.close(); toast("Report saved"); loadReports(); }
        catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = "Save report"; }
    };
}

function applyTheme(theme) {
    const chosen = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = chosen;
    const metaTheme = document.querySelector('meta[name="theme-color"]'); if (metaTheme) metaTheme.content = chosen === "dark" ? "#111b2b" : "#f6faff";
    try { localStorage.setItem("mld_theme", chosen); } catch { }
    const b = $("#theme-toggle");
    if (b) { b.textContent = chosen === "dark" ? "☀ Light" : "☾ Dark"; b.setAttribute("aria-label", `Switch to ${chosen === "dark" ? "light" : "dark"} mode`); }
}
function mountThemeToggle() {
    let b = $("#theme-toggle");
    if (!b) {
        b = document.createElement("button"); b.id = "theme-toggle"; b.type = "button"; b.className = "theme-toggle";
        b.onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
        document.body.append(b);
    }
    applyTheme(document.documentElement.dataset.theme || "light");
}
function render() { token ? appView() : authView(); mountThemeToggle(); }
try { applyTheme(localStorage.getItem("mld_theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")); } catch { applyTheme("light"); }
render();
checkSession();
watchSession();
/* ==================================================================
   Yönetim paneli
   ================================================================== */
(() => {
  "use strict";

  const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz",
    "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const DAYS_SHORT = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
  const STORAGE_KEY = "randevu-admin-key";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const state = {
    key: "",
    config: null,
    bookings: [],
    toastTimer: null,
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[character]));
  }

  function parseDay(iso) {
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function formatDay(iso) {
    const day = parseDay(iso);
    return `${day.getDate()} ${MONTHS_SHORT[day.getMonth()]} ${day.getFullYear()}`;
  }

  function showToast(message, type = "") {
    const toast = $("#toast");
    toast.textContent = message;
    toast.className = `toast is-visible${type === "error" ? " is-error" : ""}`;
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => { toast.className = "toast"; }, 4200);
  }

  function setError(element, message) {
    element.textContent = message || "";
    element.hidden = !message;
  }

  function withLoading(button, loading, label = "İşleniyor…") {
    if (!button) return;
    const target = button.querySelector(".btn-label") || button;
    if (!button.dataset.label) button.dataset.label = target.textContent.trim();
    button.disabled = loading;
    button.classList.toggle("is-loading", loading);
    target.textContent = loading ? label : button.dataset.label;
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}), "X-Admin-Key": state.key };
    if (options.body) headers["Content-Type"] = "application/json";
    const response = await fetch(path, { ...options, headers });
    let data = null;
    try { data = await response.json(); } catch (_) { /* yoksay */ }
    if (response.status === 401) {
      logout();
      throw new Error("Oturum sonlandı. Lütfen tekrar giriş yapın.");
    }
    if (!response.ok) {
      throw new Error((data && data.detail) || `İstek başarısız (${response.status}).`);
    }
    return data;
  }

  /* -------------------------------------------------------------- */
  /* Giriş                                                          */
  /* -------------------------------------------------------------- */
  async function authenticate(key) {
    const response = await fetch("/api/admin/bookings?status=confirmed", {
      headers: { "X-Admin-Key": key },
    });
    if (!response.ok) throw new Error("Şifre hatalı. Lütfen tekrar deneyin.");
    return response.json();
  }

  async function handleLogin(event) {
    event.preventDefault();
    const key = $("#admin-password").value.trim();
    const errorBox = $("#login-error");
    setError(errorBox, "");
    if (!key) {
      setError(errorBox, "Lütfen yönetim şifresini girin.");
      return;
    }

    const button = $("#login-btn");
    withLoading(button, true, "Giriş yapılıyor…");
    try {
      await authenticate(key);
      state.key = key;
      sessionStorage.setItem(STORAGE_KEY, key);
      $("#admin-password").value = "";
      await showDashboard();
    } catch (error) {
      setError(errorBox, error.message);
    } finally {
      withLoading(button, false);
    }
  }

  function logout() {
    state.key = "";
    state.bookings = [];
    sessionStorage.removeItem(STORAGE_KEY);
    $("#dashboard").hidden = true;
    $("#login-view").hidden = false;
  }

  /* -------------------------------------------------------------- */
  /* Panoyu doldur                                                  */
  /* -------------------------------------------------------------- */
  function buildFilters() {
    const params = new URLSearchParams();
    if ($("#filter-from").value) params.set("date_from", $("#filter-from").value);
    if ($("#filter-to").value) params.set("date_to", $("#filter-to").value);
    if ($("#filter-class").value) params.set("classroom", $("#filter-class").value);
    params.set("status", $("#filter-status").value || "confirmed");
    return params;
  }

  async function loadBookings() {
    const data = await api(`/api/admin/bookings?${buildFilters().toString()}`);
    state.bookings = data.bookings || [];
    renderBookings(state.bookings);
    renderStats(state.bookings);
  }

  async function loadReminders() {
    const data = await api("/api/admin/reminders?limit=60");
    renderReminders(data.reminders || []);
  }

  async function loadAll() {
    await Promise.all([loadBookings(), loadReminders()]);
  }

  function showDashboard() {
    $("#login-view").hidden = true;
    $("#dashboard").hidden = false;
    const config = state.config || {};
    $("#mode-banner").className =
      `mode-banner ${config.email_configured ? "is-live" : "is-demo"}`;
    $("#mode-banner").textContent = config.email_configured
      ? "Gerçek e-posta gönderimi aktif. Hatırlatmalar SMTP üzerinden gönderiliyor."
      : "Demo modu: SMTP ayarlanmadı. E-postalar gönderilmez, logs/outbox klasörüne .eml olarak yazılır.";
    return loadAll().catch((error) => showToast(error.message, "error"));
  }

  function renderStats(bookings) {
    const today = state.config ? state.config.today : "";
    const active = bookings.filter((booking) => booking.status === "confirmed");
    const todayCount = active.filter((booking) => booking.booking_date === today).length;
    const upcoming = active.filter((booking) => !booking.is_past).length;
    const locked = active.filter((booking) => booking.edit_locked && !booking.is_past).length;

    const stats = [
      { label: "Listelenen", value: bookings.length },
      { label: "Bugün", value: todayCount },
      { label: "Yaklaşan", value: upcoming },
      { label: `${state.config ? state.config.lock_days : 3} gün içinde kilitli`, value: locked },
    ];
    $("#stats").innerHTML = stats.map((item) => `
      <div class="stat">
        <span>${esc(item.label)}</span>
        <strong>${esc(item.value)}</strong>
      </div>`).join("");
  }

  function lockLabel(booking) {
    if (booking.status === "cancelled") return "—";
    if (booking.is_past) return "Geçmiş";
    if (booking.edit_locked) return "Kilitli";
    return "Açık";
  }

  function renderBookings(bookings) {
    const body = $("#bookings-body");
    const empty = $("#bookings-empty");
    $("#booking-count").textContent = `${bookings.length} kayıt`;

    if (!bookings.length) {
      body.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    body.innerHTML = bookings.map((booking) => {
      const cancelled = booking.status === "cancelled";
      const day = parseDay(booking.booking_date);
      const status = cancelled ? "İptal edildi" : (booking.is_past ? "Geçmiş" : "Onaylı");
      const manage = `${location.origin}/?token=${encodeURIComponent(booking.token)}`;
      return `
        <tr class="${cancelled ? "row-cancelled" : ""}">
          <td>
            <strong class="cell-date">${day.getDate()} ${esc(MONTHS_SHORT[day.getMonth()])}</strong>
            <span class="cell-sub">${esc(DAYS_SHORT[day.getDay()])} · ${day.getFullYear()}</span>
          </td>
          <td class="cell-time">${esc(booking.start_time)}–${esc(booking.end_time)}</td>
          <td><span class="pill">${esc(booking.classroom)}</span></td>
          <td>
            <strong>${esc(booking.full_name)}</strong>
            <span class="cell-sub">${esc(booking.code)}</span>
          </td>
          <td>
            <a class="cell-link" href="mailto:${esc(booking.email)}">${esc(booking.email)}</a>
            <span class="cell-sub">${esc(booking.phone)}</span>
          </td>
          <td><span class="status-dot ${cancelled ? "is-cancelled" : booking.is_past ? "is-past" : "is-ok"}">${status}</span></td>
          <td><span class="status-dot ${booking.edit_locked ? "is-locked" : "is-ok"}">${lockLabel(booking)}</span></td>
          <td><a class="btn btn-ghost btn-sm" href="${esc(manage)}" target="_blank" rel="noopener">Aç</a></td>
        </tr>`;
    }).join("");
  }

  function renderReminders(reminders) {
    const body = $("#reminders-body");
    const empty = $("#reminders-empty");
    if (!reminders.length) {
      body.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    const labels = { sent: "Gönderildi", simulated: "Demo (outbox)", error: "Hata" };
    body.innerHTML = reminders.map((item) => {
      const sentAt = item.sent_at ? new Date(item.sent_at).toLocaleString("tr-TR") : "—";
      const statusClass = item.status === "sent" ? "is-ok" : item.status === "error" ? "is-cancelled" : "is-locked";
      const detail = item.detail || "—";
      return `
        <tr>
          <td>${esc(sentAt)}</td>
          <td>
            <strong>${esc(formatDay(item.booking_date))} · ${esc(item.start_time)}</strong>
            <span class="cell-sub">${esc(item.code)} · ${esc(item.classroom)}</span>
          </td>
          <td>
            ${esc(item.full_name)}
            <span class="cell-sub">${esc(item.email)}</span>
          </td>
          <td>${esc(item.offset_hours)} saat</td>
          <td><span class="status-dot ${statusClass}">${esc(labels[item.status] || item.status)}</span></td>
          <td class="cell-detail" title="${esc(detail)}">${esc(detail)}</td>
        </tr>`;
    }).join("");
  }

  /* -------------------------------------------------------------- */
  /* Olaylar                                                        */
  /* -------------------------------------------------------------- */
  function bindEvents() {
    $("#login-form").addEventListener("submit", handleLogin);

    $("#logout").addEventListener("click", () => {
      logout();
      showToast("Çıkış yapıldı.");
    });

    $("#filter-apply").addEventListener("click", async () => {
      try {
        await loadBookings();
      } catch (error) {
        showToast(error.message, "error");
      }
    });

    $("#refresh-reminders").addEventListener("click", async () => {
      try {
        await loadReminders();
        showToast("Hatırlatma kayıtları güncellendi.");
      } catch (error) {
        showToast(error.message, "error");
      }
    });

    $("#run-reminders").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      withLoading(button, true, "Çalıştırılıyor…");
      try {
        const data = await api("/api/admin/reminders/run", { method: "POST" });
        const count = (data.sent || []).length;
        showToast(count ? `${count} hatırlatma işlendi.` : "Gönderilecek hatırlatma yok.");
        await loadReminders();
      } catch (error) {
        showToast(error.message, "error");
      } finally {
        withLoading(button, false);
      }
    });
  }

  function fillClassFilter() {
    const select = $("#filter-class");
    state.config.classrooms.forEach((name) => select.add(new Option(name, name)));
  }

  async function init() {
    bindEvents();
    try {
      state.config = await fetch("/api/config").then((response) => response.json());
    } catch (_) {
      state.config = { classrooms: [], today: "", lock_days: 3, email_configured: false };
    }

    const today = state.config.today || new Date().toISOString().slice(0, 10);
    const weekAgo = parseDay(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAhead = parseDay(today);
    monthAhead.setDate(monthAhead.getDate() + 30);
    const iso = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

    $("#filter-from").value = iso(weekAgo);
    $("#filter-to").value = iso(monthAhead);
    fillClassFilter();

    const storedKey = sessionStorage.getItem(STORAGE_KEY);
    if (!storedKey) return;

    try {
      await authenticate(storedKey);
      state.key = storedKey;
      await showDashboard();
    } catch (_) {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  init();
})();

/* ==================================================================
   Akademi Sınıf Randevu — arayüz mantığı
   ================================================================== */
(() => {
  "use strict";

  const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz",
    "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
  const DAYS_SHORT = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const state = {
    config: null,
    selectedClass: null,
    availability: null,
    formSeq: 0,
    edit: { booking: null, selectedClass: null, availability: null, seq: 0 },
    lookup: { email: "", phone: "" },
    bookings: new Map(),
    focusToken: null,
    cancelToken: null,
    toastTimer: null,
  };

  /* -------------------------------------------------------------- */
  /* Yardımcılar                                                    */
  /* -------------------------------------------------------------- */
  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function parseDay(iso) {
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function formatDateLong(iso) {
    if (!iso) return "—";
    const day = parseDay(iso);
    return `${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}, ${DAYS[day.getDay()]}`;
  }

  function toMin(clock) {
    if (!clock) return null;
    const [hour, minute] = clock.split(":").map(Number);
    return hour * 60 + minute;
  }

  function clockOf(minutes) {
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  }

  function durationText(minutes) {
    if (minutes <= 0) return "—";
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours && rest) return `${hours} saat ${rest} dk`;
    if (hours) return `${hours} saat`;
    return `${rest} dk`;
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[character]));
  }

  function classBadge(name) {
    const last = String(name).trim().split(/\s+/).pop() || "?";
    return last.slice(0, 2).toUpperCase();
  }

  async function api(path, options = {}) {
    const request = { ...options, headers: { ...(options.headers || {}) } };
    if (request.body && !request.headers["Content-Type"]) {
      request.headers["Content-Type"] = "application/json";
    }
    const response = await fetch(path, request);
    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      /* yanıt gövdesi JSON değilse yoksay */
    }
    if (!response.ok) {
      let message = data && data.detail;
      if (Array.isArray(message)) {
        message = message.map((item) => item.msg || "Geçersiz değer").join(", ");
      }
      throw new Error(message || `İstek başarısız oldu (${response.status}).`);
    }
    return data;
  }

  function showToast(message, type = "") {
    const toast = $("#toast");
    toast.textContent = message;
    toast.className = `toast is-visible${type === "error" ? " is-error" : ""}`;
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      toast.className = "toast";
    }, 4200);
  }

  function setError(element, message) {
    if (!element) return;
    element.textContent = message || "";
    element.hidden = !message;
  }

  function clearError(element) {
    setError(element, "");
  }

  function withLoading(button, loading, loadingLabel = "İşleniyor…") {
    if (!button) return;
    const labelElement = button.querySelector(".btn-label");
    const target = labelElement || button;
    if (!button.dataset.label) button.dataset.label = target.textContent.trim();
    button.disabled = loading;
    button.classList.toggle("is-loading", loading);
    target.textContent = loading ? loadingLabel : button.dataset.label;
  }

  function manageUrl(token) {
    const base = location.origin + location.pathname.replace(/index\.html$/i, "");
    return `${base}?token=${encodeURIComponent(token)}`;
  }

  function validateFields(values) {
    if (!values.date) return "Lütfen bir tarih seçin.";
    if (!values.classroom) return "Lütfen bir sınıf seçin.";
    if (!values.start_time || !values.end_time) return "Lütfen başlangıç ve bitiş saatini seçin.";
    if (toMin(values.end_time) <= toMin(values.start_time)) {
      return "Bitiş saati başlangıçtan sonra olmalı.";
    }
    if (values.full_name.trim().length < 2) return "Ad soyad en az 2 karakter olmalı.";
    if (!EMAIL_RE.test(values.email.trim())) return "Geçerli bir e-posta adresi girin.";
    const digits = values.phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      return "Telefon numarası 10–15 haneli olmalı. Örnek: 0532 123 45 67";
    }
    return null;
  }

  /* -------------------------------------------------------------- */
  /* Doluluk ve saat seçenekleri                                    */
  /* -------------------------------------------------------------- */
  function busyFor(availability, className, exclude = null) {
    if (!availability) return null;
    const entry = availability.classrooms.find((item) => item.name === className);
    let busy = entry ? entry.busy.slice() : [];
    if (exclude && availability.date === exclude.date && className === exclude.classroom) {
      busy = busy.filter((slot) => !(slot.start === exclude.start && slot.end === exclude.end));
    }
    return busy;
  }

  function isFree(start, end, busy) {
    return !busy.some((slot) => start < toMin(slot.end) && end > toMin(slot.start));
  }

  function renderClassGrid(container, selected, availability, exclude = null) {
    if (!container) return;
    container.innerHTML = state.config.classrooms.map((name) => {
      const busy = busyFor(availability, name, exclude);
      let status = "Yükleniyor…";
      if (busy) status = busy.length ? `${busy.length} dolu aralık` : "Tüm gün uygun";
      const isSelected = selected === name;
      return `
        <button type="button" class="class-option${isSelected ? " is-selected" : ""}"
                data-class="${esc(name)}" role="radio" aria-checked="${isSelected}">
          <span class="class-badge">${esc(classBadge(name))}</span>
          <span class="class-name">${esc(name)}</span>
          <span class="class-status">${esc(status)}</span>
        </button>`;
    }).join("");
  }

  function renderTimeOptions({
    startEl, endEl, busy, dateStr, preferredStart, preferredEnd,
  }) {
    const openM = toMin(state.config.open_time);
    const closeM = toMin(state.config.close_time);
    const slot = state.config.slot_minutes;
    const currentStart = preferredStart !== undefined ? preferredStart : startEl.value;
    const currentEnd = preferredEnd !== undefined ? preferredEnd : endEl.value;

    let minStart = openM;
    if (dateStr === state.config.today) {
      const now = new Date();
      const nowM = now.getHours() * 60 + now.getMinutes();
      minStart = Math.max(openM, Math.ceil((nowM + 5) / slot) * slot);
    }

    const starts = [];
    for (let minute = minStart; minute + slot <= closeM; minute += slot) {
      if (isFree(minute, minute + slot, busy)) starts.push(minute);
    }

    startEl.innerHTML = '<option value="">Seçin</option>';
    starts.forEach((minute) => startEl.add(new Option(clockOf(minute), clockOf(minute))));
    startEl.disabled = starts.length === 0;
    if (currentStart && starts.includes(toMin(currentStart))) startEl.value = currentStart;
    else startEl.value = "";

    rebuildEndOptions({ startEl, endEl, busy, preferredEnd: currentEnd });
  }

  function rebuildEndOptions({ startEl, endEl, busy, preferredEnd }) {
    const startValue = startEl.value;
    const previous = preferredEnd !== undefined ? preferredEnd : endEl.value;
    const slot = state.config.slot_minutes;
    const closeM = toMin(state.config.close_time);

    if (!startValue) {
      endEl.innerHTML = '<option value="">Önce başlangıç</option>';
      endEl.disabled = true;
      return;
    }

    const startM = toMin(startValue);
    const ends = [];
    for (let minute = startM + slot; minute <= closeM; minute += slot) {
      if (!isFree(startM, minute, busy)) break;
      ends.push(minute);
    }

    endEl.innerHTML = '<option value="">Seçin</option>';
    ends.forEach((minute) => endEl.add(new Option(clockOf(minute), clockOf(minute))));
    endEl.disabled = ends.length === 0;
    if (previous && ends.includes(toMin(previous))) endEl.value = previous;
    else endEl.value = "";
  }

  /* -------------------------------------------------------------- */
  /* Randevu formu                                                  */
  /* -------------------------------------------------------------- */
  function currentFormBusy() {
    if (!state.availability || !state.selectedClass) return [];
    return busyFor(state.availability, state.selectedClass) || [];
  }

  function updateBusyInfo() {
    const info = $("#busy-info");
    if (!state.availability) {
      info.textContent = "Doluluk bilgisi yükleniyor…";
      return;
    }
    if (!state.selectedClass) {
      info.textContent = "Sınıf seçtiğinizde doluluk bilgisi görünür.";
      return;
    }
    const busy = currentFormBusy();
    if (!busy.length) {
      info.textContent = `${state.selectedClass} seçilen tarihte tamamen uygun.`;
      return;
    }
    const slots = busy.map((slot) => `${slot.start}–${slot.end}`).join(", ");
    info.textContent = `${state.selectedClass} dolu saatler: ${slots}.`;
  }

  function updateSummary() {
    const startValue = $("#start_time").value;
    const endValue = $("#end_time").value;
    $("#sum-date").textContent = $("#date").value ? formatDateLong($("#date").value) : "—";
    $("#sum-class").textContent = state.selectedClass || "—";
    $("#sum-time").textContent = startValue && endValue ? `${startValue} – ${endValue}` : "—";
    $("#sum-duration").textContent =
      startValue && endValue ? durationText(toMin(endValue) - toMin(startValue)) : "—";
  }

  function updateFormHint() {
    const hint = $("#duration-note");
    const startValue = $("#start_time").value;
    const endValue = $("#end_time").value;
    if (startValue && endValue) {
      hint.textContent = `Seçilen süre: ${durationText(toMin(endValue) - toMin(startValue))}.`;
    } else if (!state.availability) {
      hint.textContent = "Doluluk bilgisi yükleniyor…";
    } else if (!state.selectedClass) {
      hint.textContent = "Önce tarih ve sınıf seçin.";
    } else if ($("#start_time").options.length <= 1) {
      hint.textContent = "Bu gün için uygun saat kalmadı. Lütfen başka bir gün deneyin.";
    } else {
      hint.textContent = "Başlangıç saatini seçtiğinizde uygun bitiş saatleri listelenir.";
    }
  }

  function applyFormAvailability(preferredStart, preferredEnd) {
    renderClassGrid($("#class-grid"), state.selectedClass, state.availability);

    if (!state.availability) {
      $("#start_time").innerHTML = '<option value="">Yükleniyor…</option>';
      $("#start_time").disabled = true;
      $("#end_time").innerHTML = '<option value="">Yükleniyor…</option>';
      $("#end_time").disabled = true;
      updateBusyInfo();
      updateSummary();
      updateFormHint();
      return;
    }

    if (!state.selectedClass) {
      $("#start_time").innerHTML = '<option value="">Önce sınıf seçin</option>';
      $("#start_time").disabled = true;
      $("#end_time").innerHTML = '<option value="">Önce sınıf seçin</option>';
      $("#end_time").disabled = true;
    } else {
      renderTimeOptions({
        startEl: $("#start_time"),
        endEl: $("#end_time"),
        busy: currentFormBusy(),
        dateStr: $("#date").value,
        preferredStart,
        preferredEnd,
      });
    }

    updateBusyInfo();
    updateSummary();
    updateFormHint();
  }

  async function refreshFormAvailability() {
    const day = $("#date").value;
    if (!day || !state.config) return;
    const sequence = ++state.formSeq;
    state.availability = null;
    applyFormAvailability("", "");
    try {
      const data = await api(`/api/availability?date=${encodeURIComponent(day)}`);
      if (sequence !== state.formSeq) return;
      state.availability = data;
      applyFormAvailability("", "");
    } catch (error) {
      if (sequence !== state.formSeq) return;
      showToast(error.message, "error");
      updateBusyInfo();
    }
  }

  function resetBookingForm() {
    $("#booking-form").reset();
    const dateEl = $("#date");
    dateEl.value = state.config.today;
    state.selectedClass = state.config.classrooms[0] || null;
    state.availability = null;
    clearError($("#form-error"));
    $("#start_time").innerHTML = '<option value="">Yükleniyor…</option>';
    $("#end_time").innerHTML = '<option value="">Yükleniyor…</option>';
    applyFormAvailability("", "");
    refreshFormAvailability();
  }

  async function onSubmitBooking(event) {
    event.preventDefault();
    const values = {
      full_name: $("#full_name").value,
      email: $("#email").value,
      phone: $("#phone").value,
      classroom: state.selectedClass,
      date: $("#date").value,
      start_time: $("#start_time").value,
      end_time: $("#end_time").value,
      note: $("#note").value.trim() || null,
    };

    clearError($("#form-error"));
    const problem = validateFields(values);
    if (problem) {
      setError($("#form-error"), problem);
      return;
    }

    const button = $("#submit-btn");
    withLoading(button, true, "Randevu oluşturuluyor…");
    try {
      const booking = await api("/api/bookings", {
        method: "POST",
        body: JSON.stringify(values),
      });
      showSuccess(booking);
    } catch (error) {
      setError($("#form-error"), error.message);
      $("#form-error").scrollIntoView({ behavior: "smooth", block: "center" });
    } finally {
      withLoading(button, false);
    }
  }

  function showSuccess(booking) {
    $("#booking-area").hidden = true;
    $("#success-panel").hidden = false;

    $("#success-code").textContent = booking.code;
    $("#success-date").textContent = formatDateLong(booking.booking_date);
    $("#success-class").textContent = booking.classroom;
    $("#success-time").textContent = `${booking.start_time} – ${booking.end_time}`;
    $("#success-message").textContent =
      `${formatDateLong(booking.booking_date)} tarihinde ${booking.classroom} için randevunuz ayrıldı.`;
    $("#success-manage").href = manageUrl(booking.token);

    const note = $("#success-mail-note");
    if (state.config.email_configured) {
      note.textContent = `Onay e-postası ${booking.email} adresine gönderildi.`;
    } else {
      note.textContent =
        "Demo modu: SMTP ayarlanmadığı için e-posta gerçekten gönderilmedi; içerik logs/outbox klasörüne kaydedildi.";
    }

    history.replaceState(null, "", `${location.pathname}?token=${encodeURIComponent(booking.token)}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function onNewBooking() {
    history.replaceState(null, "", location.pathname);
    $("#success-panel").hidden = true;
    $("#booking-area").hidden = false;
    resetBookingForm();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* -------------------------------------------------------------- */
  /* Görünüm / sekmeler                                             */
  /* -------------------------------------------------------------- */
  function switchView(view, updateUrl = true) {
    $$(".tab").forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-current", active ? "page" : "false");
    });
    $("#view-book").hidden = view !== "book";
    $("#view-my").hidden = view !== "my";
    if (updateUrl) {
      if (view === "my") history.replaceState(null, "", `${location.pathname}#randevularim`);
      else history.replaceState(null, "", location.pathname);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* -------------------------------------------------------------- */
  /* Randevu kartları                                               */
  /* -------------------------------------------------------------- */
  function statusLabel(booking) {
    if (booking.status === "cancelled") return "İptal edildi";
    if (booking.is_past) return "Geçmiş";
    return "Onaylı";
  }

  function lockNote(booking) {
    if (booking.status === "cancelled") {
      return "Bu randevu iptal edildi. İstediğiniz zaman yeni bir randevu oluşturabilirsiniz.";
    }
    if (booking.is_past) return "Bu randevunun tarihi geçti.";
    if (booking.edit_locked) {
      const extra = booking.can_delete
        ? " Dilerseniz iptal edebilirsiniz."
        : " İptal için akademi ile iletişime geçin.";
      return `Randevuya ${state.config.lock_days} günden az kaldığı için düzenlenemez.${extra}`;
    }
    return "";
  }

  function bookingCardHtml(booking) {
    const day = parseDay(booking.booking_date);
    const cancelled = booking.status === "cancelled";
    const note = lockNote(booking);
    const reminderHours = state.config.reminder_hours || [];
    const reminderText = reminderHours.length
      ? `Hatırlatma: ${reminderHours.slice().sort((a, b) => b - a).map((hour) => `${hour} saat`).join(" ve ")} önce e-posta`
      : "";

    const actions = [];
    if (booking.can_edit) {
      actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-action="edit">Düzenle</button>`);
    }
    if (booking.can_delete) {
      actions.push(`<button type="button" class="btn btn-danger btn-sm" data-action="cancel">İptal et</button>`);
    }

    return `
      <article class="card booking-card${cancelled ? " is-cancelled" : ""}" data-token="${esc(booking.token)}">
        <div class="booking-grid">
          <div class="date-block" aria-hidden="true">
            <span class="dow">${esc(DAYS_SHORT[day.getDay()])}</span>
            <strong>${day.getDate()}</strong>
            <span class="mon">${esc(MONTHS_SHORT[day.getMonth()])}</span>
          </div>
          <div class="booking-body">
            <div class="booking-head">
              <span class="pill">${esc(booking.classroom)}</span>
              <span class="pill pill-status">${esc(statusLabel(booking))}</span>
              <span class="pill pill-code">${esc(booking.code)}</span>
            </div>
            <h3 class="booking-title">${esc(booking.start_time)} – ${esc(booking.end_time)}</h3>
            <p class="booking-meta">${esc(formatDateLong(booking.booking_date))}</p>
            <p class="booking-person">${esc(booking.full_name)} · ${esc(booking.email)} · ${esc(booking.phone)}</p>
            ${booking.note ? `<p class="booking-note">Not: ${esc(booking.note)}</p>` : ""}
            ${reminderText && !cancelled ? `<p class="reminder-line">${esc(reminderText)}</p>` : ""}
          </div>
          <div class="booking-actions">
            ${actions.length ? actions.join("") : '<span class="muted small">İşlem kapalı</span>'}
          </div>
        </div>
        ${note ? `
          <div class="lock-note">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="4" y="9" width="12" height="8" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 9V7a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.5"/></svg>
            <span>${esc(note)}</span>
          </div>` : ""}
      </article>`;
  }

  function emptyStateHtml(title, text) {
    return `
      <div class="empty-state card">
        <span class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none"><rect x="5" y="7" width="22" height="20" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M5 12h22M11 4v5M21 4v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M10 17h5M10 22h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </span>
        <h3>${esc(title)}</h3>
        <p>${esc(text)}</p>
      </div>`;
  }

  function renderResults(bookings) {
    const container = $("#my-results");
    if (!bookings.length) {
      container.innerHTML = emptyStateHtml(
        "Randevu bulunamadı",
        "Girdiğiniz e-posta ve telefonla eşleşen bir randevu yok. Bilgileri kontrol edip tekrar deneyin."
      );
      return;
    }

    bookings.forEach((booking) => state.bookings.set(booking.token, booking));
    const label = bookings.length === 1 ? "1 randevu" : `${bookings.length} randevu`;
    container.innerHTML = `
      <div class="results-head">
        <span>${esc(label)} listeleniyor</span>
        <button type="button" class="btn btn-ghost btn-sm" data-action="refresh">Yenile</button>
      </div>
      ${bookings.map(bookingCardHtml).join("")}`;
  }

  async function onLookup(event) {
    event.preventDefault();
    const email = $("#lookup-email").value.trim();
    const phone = $("#lookup-phone").value.trim();
    clearError($("#lookup-error"));

    if (!EMAIL_RE.test(email)) {
      setError($("#lookup-error"), "Geçerli bir e-posta adresi girin.");
      return;
    }
    if (phone.replace(/\D/g, "").length < 10) {
      setError($("#lookup-error"), "Geçerli bir telefon numarası girin.");
      return;
    }

    const button = $("#lookup-btn");
    withLoading(button, true, "Aranıyor…");
    try {
      const data = await api(
        `/api/bookings?email=${encodeURIComponent(email)}&phone=${encodeURIComponent(phone)}`
      );
      state.lookup = { email, phone };
      state.focusToken = null;
      renderResults(data.bookings);
    } catch (error) {
      setError($("#lookup-error"), error.message);
    } finally {
      withLoading(button, false);
    }
  }

  async function refreshResults() {
    if (state.focusToken) {
      try {
        const booking = await api(`/api/bookings/${encodeURIComponent(state.focusToken)}`);
        renderResults([booking]);
      } catch (error) {
        $("#my-results").innerHTML = emptyStateHtml("Randevu bulunamadı", error.message);
      }
      return;
    }
    if (state.lookup.email) {
      try {
        const data = await api(
          `/api/bookings?email=${encodeURIComponent(state.lookup.email)}&phone=${encodeURIComponent(state.lookup.phone)}`
        );
        renderResults(data.bookings);
      } catch (error) {
        showToast(error.message, "error");
      }
    }
  }

  async function loadToken(token) {
    state.focusToken = token;
    switchView("my", false);
    $("#my-results").innerHTML = emptyStateHtml("Randevu yükleniyor", "Lütfen bekleyin…");
    try {
      const booking = await api(`/api/bookings/${encodeURIComponent(token)}`);
      renderResults([booking]);
    } catch (error) {
      $("#my-results").innerHTML = emptyStateHtml("Randevu açılamadı", error.message);
    }
  }

  /* -------------------------------------------------------------- */
  /* Düzenleme                                                      */
  /* -------------------------------------------------------------- */
  function editOwnBookingExclude() {
    const booking = state.edit.booking;
    if (!booking) return null;
    return {
      date: booking.booking_date,
      classroom: booking.classroom,
      start: booking.start_time,
      end: booking.end_time,
    };
  }

  function currentEditBusy() {
    const booking = state.edit.booking;
    if (!booking || !state.edit.availability || !state.edit.selectedClass) return [];
    return busyFor(state.edit.availability, state.edit.selectedClass, editOwnBookingExclude()) || [];
  }

  function updateEditHint(preferredStart, preferredEnd) {
    const hint = $("#edit-hint");
    const startValue = $("#edit-start").value;
    const endValue = $("#edit-end").value;
    if (startValue && endValue) {
      hint.textContent = `Seçilen süre: ${durationText(toMin(endValue) - toMin(startValue))}.`;
    } else if (!state.edit.availability) {
      hint.textContent = "Doluluk bilgisi yükleniyor…";
    } else if ($("#edit-start").options.length <= 1) {
      hint.textContent = "Bu gün için uygun saat kalmadı. Lütfen başka bir gün seçin.";
    } else {
      hint.textContent = "Uygun başlangıç ve bitiş saatini seçin.";
    }
  }

  function applyEditAvailability(preferredStart, preferredEnd) {
    renderClassGrid(
      $("#edit-class-grid"),
      state.edit.selectedClass,
      state.edit.availability,
      editOwnBookingExclude()
    );

    if (!state.edit.availability) {
      $("#edit-start").innerHTML = '<option value="">Yükleniyor…</option>';
      $("#edit-start").disabled = true;
      $("#edit-end").innerHTML = '<option value="">Yükleniyor…</option>';
      $("#edit-end").disabled = true;
    } else {
      renderTimeOptions({
        startEl: $("#edit-start"),
        endEl: $("#edit-end"),
        busy: currentEditBusy(),
        dateStr: $("#edit-date").value,
        preferredStart,
        preferredEnd,
      });
    }
    updateEditHint();
  }

  async function loadEditAvailability(preferredStart, preferredEnd) {
    const day = $("#edit-date").value;
    if (!day) return;
    const sequence = ++state.edit.seq;
    state.edit.availability = null;
    applyEditAvailability("", "");
    try {
      const data = await api(`/api/availability?date=${encodeURIComponent(day)}`);
      if (sequence !== state.edit.seq || !$("#edit-dialog").open) return;
      state.edit.availability = data;
      applyEditAvailability(preferredStart, preferredEnd);
    } catch (error) {
      if (sequence !== state.edit.seq) return;
      $("#edit-hint").textContent = error.message;
    }
  }

  function openEdit(booking) {
    state.edit = {
      booking,
      selectedClass: booking.classroom,
      availability: null,
      seq: 0,
    };

    $("#edit-token").value = booking.token;
    $("#edit-name").value = booking.full_name;
    $("#edit-email").value = booking.email;
    $("#edit-phone").value = booking.phone;
    $("#edit-note").value = booking.note || "";
    $("#edit-date").min = state.config.today;
    $("#edit-date").max = state.config.max_date;
    $("#edit-date").value = booking.booking_date;
    clearError($("#edit-error"));

    renderClassGrid($("#edit-class-grid"), booking.classroom, null);
    $("#edit-start").innerHTML = '<option value="">Yükleniyor…</option>';
    $("#edit-end").innerHTML = '<option value="">Yükleniyor…</option>';
    $("#edit-hint").textContent = "Doluluk bilgisi yükleniyor…";
    $("#edit-dialog").showModal();
    loadEditAvailability(booking.start_time, booking.end_time);
  }

  async function onSubmitEdit(event) {
    event.preventDefault();
    const booking = state.edit.booking;
    if (!booking) return;

    const values = {
      full_name: $("#edit-name").value,
      email: $("#edit-email").value,
      phone: $("#edit-phone").value,
      classroom: state.edit.selectedClass,
      date: $("#edit-date").value,
      start_time: $("#edit-start").value,
      end_time: $("#edit-end").value,
      note: $("#edit-note").value.trim() || null,
    };

    clearError($("#edit-error"));
    const problem = validateFields(values);
    if (problem) {
      setError($("#edit-error"), problem);
      return;
    }

    const button = $("#edit-submit");
    withLoading(button, true, "Kaydediliyor…");
    try {
      const updated = await api(`/api/bookings/${encodeURIComponent(booking.token)}`, {
        method: "PUT",
        body: JSON.stringify(values),
      });
      state.bookings.set(updated.token, updated);
      state.lookup = { email: updated.email, phone: updated.phone };
      $("#lookup-email").value = updated.email;
      $("#lookup-phone").value = updated.phone;
      $("#edit-dialog").close();
      showToast("Randevunuz güncellendi. Yeni bilgiler e-posta ile gönderilecek.");
      await refreshResults();
    } catch (error) {
      setError($("#edit-error"), error.message);
    } finally {
      withLoading(button, false);
    }
  }

  /* -------------------------------------------------------------- */
  /* İptal                                                          */
  /* -------------------------------------------------------------- */
  function openCancel(booking) {
    state.cancelToken = booking.token;
    $("#cancel-summary").textContent =
      `${formatDateLong(booking.booking_date)} · ${booking.start_time}–${booking.end_time} · ${booking.classroom} · ${booking.code}`;
    $("#cancel-dialog").showModal();
  }

  async function onConfirmCancel() {
    if (!state.cancelToken) return;
    const button = $("#cancel-confirm");
    withLoading(button, true, "İptal ediliyor…");
    try {
      await api(`/api/bookings/${encodeURIComponent(state.cancelToken)}`, { method: "DELETE" });
      $("#cancel-dialog").close();
      showToast("Randevunuz iptal edildi.");
      await refreshResults();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      withLoading(button, false);
    }
  }

  /* -------------------------------------------------------------- */
  /* Olay bağlama                                                   */
  /* -------------------------------------------------------------- */
  function bindEvents() {
    $$(".tab").forEach((tab) => {
      tab.addEventListener("click", () => switchView(tab.dataset.view));
    });

    $("#date").addEventListener("change", () => {
      state.availability = null;
      applyFormAvailability("", "");
      if ($("#date").value) refreshFormAvailability();
    });

    $("#class-grid").addEventListener("click", (event) => {
      const button = event.target.closest("[data-class]");
      if (!button || button.dataset.class === state.selectedClass) return;
      state.selectedClass = button.dataset.class;
      applyFormAvailability($("#start_time").value, $("#end_time").value);
    });

    $("#start_time").addEventListener("change", () => {
      rebuildEndOptions({
        startEl: $("#start_time"),
        endEl: $("#end_time"),
        busy: currentFormBusy(),
      });
      updateSummary();
      updateFormHint();
    });

    $("#end_time").addEventListener("change", () => {
      updateSummary();
      updateFormHint();
    });

    $("#booking-form").addEventListener("submit", onSubmitBooking);
    $("#new-booking").addEventListener("click", onNewBooking);
    $("#lookup-form").addEventListener("submit", onLookup);

    $("#my-results").addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "refresh") {
        refreshResults();
        return;
      }
      const card = button.closest("[data-token]");
      if (!card) return;
      const booking = state.bookings.get(card.dataset.token);
      if (!booking) return;
      if (button.dataset.action === "edit") openEdit(booking);
      if (button.dataset.action === "cancel") openCancel(booking);
    });

    $("#edit-class-grid").addEventListener("click", (event) => {
      const button = event.target.closest("[data-class]");
      if (!button || !state.edit.booking) return;
      if (button.dataset.class === state.edit.selectedClass) return;
      state.edit.selectedClass = button.dataset.class;
      const booking = state.edit.booking;
      const same =
        $("#edit-date").value === booking.booking_date &&
        state.edit.selectedClass === booking.classroom;
      applyEditAvailability(same ? booking.start_time : "", same ? booking.end_time : "");
    });

    $("#edit-date").addEventListener("change", () => {
      const booking = state.edit.booking;
      if (!booking) return;
      const same =
        $("#edit-date").value === booking.booking_date &&
        state.edit.selectedClass === booking.classroom;
      loadEditAvailability(same ? booking.start_time : "", same ? booking.end_time : "");
    });

    $("#edit-start").addEventListener("change", () => {
      rebuildEndOptions({
        startEl: $("#edit-start"),
        endEl: $("#edit-end"),
        busy: currentEditBusy(),
      });
      updateEditHint();
    });

    $("#edit-end").addEventListener("change", updateEditHint);
    $("#edit-form").addEventListener("submit", onSubmitEdit);
    $("#cancel-confirm").addEventListener("click", onConfirmCancel);

    $$("[data-close-dialog]").forEach((button) => {
      button.addEventListener("click", () => button.closest("dialog").close());
    });

    $$("dialog").forEach((dialog) => {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
    });

    $("#edit-dialog").addEventListener("close", () => {
      state.edit = { booking: null, selectedClass: null, availability: null, seq: 0 };
    });
  }

  /* -------------------------------------------------------------- */
  /* Başlangıç                                                      */
  /* -------------------------------------------------------------- */
  async function init() {
    $("#year").textContent = new Date().getFullYear();
    bindEvents();

    try {
      state.config = await api("/api/config");
    } catch (error) {
      setError($("#form-error"), `Uygulama yüklenemedi: ${error.message}`);
      $("#submit-btn").disabled = true;
      return;
    }

    document.title = `${state.config.app_name} | Online Randevu`;
    $("#fact-classes").textContent = state.config.classrooms.length;
    $("#fact-hours").textContent =
      `${state.config.open_time.slice(0, 2)}–${state.config.close_time.slice(0, 2)}`;
    $("#fact-lock").textContent = `${state.config.lock_days} gün`;

    $("#rule-slot").textContent = `${state.config.slot_minutes} dakikalık`;
    $("#rule-lock").textContent = `${state.config.lock_days} günden az`;
    const reminderParts = state.config.reminder_hours.map((hour) => `<strong>${hour} saat</strong>`);
    $("#rule-reminders").innerHTML = reminderParts.length
      ? `Hatırlatma e-postası randevudan ${reminderParts.join(" ve ")} önce gönderilir.`
      : "Bu kurulumda otomatik hatırlatma e-postası gönderilmez.";

    const dateEl = $("#date");
    dateEl.min = state.config.today;
    dateEl.max = state.config.max_date;
    dateEl.value = state.config.today;

    state.selectedClass = state.config.classrooms[0] || null;
    renderClassGrid($("#class-grid"), state.selectedClass, null);

    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    if (token) {
      await loadToken(token);
    } else if (location.hash === "#randevularim") {
      switchView("my", false);
    }

    refreshFormAvailability();
  }

  init();
})();

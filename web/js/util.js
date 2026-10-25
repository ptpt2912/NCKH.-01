// Tiện ích dùng chung: định dạng, escape HTML, thông báo, hộp thoại
export const TZ = 'Asia/Ho_Chi_Minh';

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const dtf = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const df = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const tf = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export const fmtDateTime = v => v ? dtf.format(new Date(v)) : '—';
export const fmtDate = v => v ? df.format(new Date(v)) : '—';
export const fmtTime = v => v ? tf.format(new Date(v)) : '—';
/** Khoá ngày theo giờ Việt Nam: 'YYYY-MM-DD' */
export const vnDayKey = v => keyFmt.format(new Date(v));
export const todayKey = () => vnDayKey(new Date());

/** Ngày thứ Hai đầu tuần (giờ VN) của một khoá ngày */
export function mondayOf(key) {
  const d = new Date(key + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // 0 = thứ Hai
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
export function addDays(key, n) {
  const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

export function hms(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export function durText(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? `${h} giờ ` : '') + (h || m ? `${m} phút ` : '') + `${s} giây`;
}
export function score(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Math.round(Number(v) * 100) / 100;
  return n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

export const SUBJECTS_ORDER = ['tong_hop', 'nghe_noi'];
export const REQUIRED_PER_WEEK = w => (w >= 7 ? 4 : 3);
export const TOTAL_LESSONS = 26;
export const TYPE_NAMES = {
  1: 'Dạng 1 — Hoàn thành hội thoại', 2: 'Dạng 2 — Điền vào chỗ trống',
  3: 'Dạng 3 — Sắp xếp câu', 4: 'Dạng 4 — Miêu tả tranh'
};
export const TYPE_SHORT = { 1: 'Hội thoại', 2: 'Điền từ', 3: 'Sắp xếp câu', 4: 'Miêu tả tranh' };

// ---------- Thông báo ----------
export function toast(msg, kind = 'info', ms = 4000) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`; el.textContent = msg;
  box.append(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- Hộp thoại ----------
export function modal({ title, body, confirmText = 'Đồng ý', cancelText = 'Hủy', danger = false }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mdl-t">
      <h3 id="mdl-t">${esc(title)}</h3><div class="modal-body">${body}</div>
      <div class="modal-actions">
        ${cancelText ? `<button class="btn btn-ghost" data-act="no">${esc(cancelText)}</button>` : ''}
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="yes">${esc(confirmText)}</button>
      </div></div>`;
    const done = v => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') done(false); };
    wrap.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'yes') done(wrap); else if (act === 'no' || e.target === wrap) done(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    (wrap.querySelector('input,textarea,select') || wrap.querySelector('[data-act="yes"]')).focus();
  });
}

export const loadingHTML = (t = 'Đang tải dữ liệu…') => `<div class="state state-loading" role="status"><span class="spinner" aria-hidden="true"></span>${esc(t)}</div>`;
export const emptyHTML = t => `<div class="state state-empty">${esc(t)}</div>`;
export function errorHTML(msg, retryId = 'retry') {
  return `<div class="state state-error" role="alert"><p><strong>Không tải được dữ liệu.</strong> ${esc(msg)}</p>
    <button class="btn btn-secondary" id="${retryId}">Thử lại</button></div>`;
}

export function progressBar(done, total, label) {
  const pct = total ? Math.min(100, Math.round(done / total * 100)) : 0;
  return `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-label="${esc(label || 'Tiến độ')}">
    <span style="width:${pct}%"></span></div>`;
}

export function badge(text, kind = 'neutral') { return `<span class="badge badge-${kind}">${esc(text)}</span>`; }

/** Đọc/ghi tham số trên hash: #/duong-dan?a=1&b=2 */
export function hashParams() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}
export function setHashParams(obj, replace = true) {
  const base = location.hash.split('?')[0];
  const qs = new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v != null)).toString();
  const url = base + (qs ? '?' + qs : '');
  if (replace) history.replaceState(null, '', url); else location.hash = url;
}

export function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

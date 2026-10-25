// Điều hướng, đăng nhập, phân quyền giao diện (dữ liệu được bảo vệ bằng RLS phía máy chủ)
import { configured, login, logout, restoreSession, state, rpc, errMsg } from './api.js';
import { esc, $, toast, loadingHTML } from './util.js';
import * as S from './student.js';
import * as T from './teacher.js';
import { editPage } from './teacher-edit.js';

const app = $('#app');
let cleanup = null, presenceTimer = null;

const studentRoutes = [
  [/^#\/?$/, S.homePage], [/^#\/mon\/([\w-]+)$/, S.subjectPage, ['code']], [/^#\/bai\/([\w-]+)$/, S.lessonPage, ['id']],
  [/^#\/ket-qua\/([\w-]+)$/, S.resultPage, ['id']], [/^#\/lich-su$/, S.historyPage], [/^#\/tai-khoan$/, S.accountPage],
];
const teacherRoutes = [
  [/^#\/gv\/hoc-sinh$/, T.studentsPage], [/^#\/gv\/hs\/([\w-]+)$/, T.profilePage, ['id']], [/^#\/gv\/hs\/([\w-]+)\/sua$/, editPage, ['id']],
  [/^#\/gv\/luot\/([\w-]+)$/, T.attemptPage, ['id']], [/^#\/gv\/noi-dung$/, T.contentPage], [/^#\/gv\/nhat-ky$/, T.auditPage],
];

function shell() {
  const p = state.profile, teacher = p.role === 'teacher';
  const links = teacher
    ? [['#/gv/hoc-sinh', 'Học sinh'], ['#/gv/noi-dung', 'Nội dung bài tập'], ['#/gv/nhat-ky', 'Nhật ký']]
    : [['#/', 'Trang chủ'], ['#/lich-su', 'Lịch sử học tập'], ['#/tai-khoan', 'Tài khoản']];
  app.innerHTML = `<a class="skip" href="#main">Bỏ qua điều hướng</a>
    <header class="topbar"><div class="container topbar-in">
      <a class="brand" href="${teacher ? '#/gv/hoc-sinh' : '#/'}"><span class="brand-mark zh" aria-hidden="true">中</span><span>Học tiếng Trung</span></a>
      <nav class="nav" aria-label="Điều hướng chính">${links.map(([h, t]) => `<a href="${h}" data-nav="${h}">${t}</a>`).join('')}</nav>
      <div class="user"><span class="user-name">${esc(teacher ? 'Giáo viên' : p.full_name)}</span><button class="btn btn-ghost btn-sm" id="logout">Đăng xuất</button></div>
    </div></header>
    <main id="main" class="container" tabindex="-1"></main>`;
  $('#logout').addEventListener('click', async () => {
    if (cleanup) { cleanup(); cleanup = null; }
    await logout(); clearInterval(presenceTimer); location.hash = ''; renderLogin();
  });
}

function route() {
  if (!state.profile) return;
  if (cleanup) { try { cleanup(); } catch { /* bỏ qua */ } cleanup = null; }
  const teacher = state.profile.role === 'teacher';
  let hash = location.hash || '#/';
  const path = hash.split('?')[0];
  if (teacher && !path.startsWith('#/gv/')) { location.replace('#/gv/hoc-sinh'); return; }
  if (!teacher && path.startsWith('#/gv/')) { location.replace('#/'); toast('Bạn không có quyền truy cập trang giáo viên.', 'error'); return; }
  const table = teacher ? teacherRoutes : studentRoutes;
  const main = $('#main');
  const view = document.createElement('div'); view.className = 'view';
  main.replaceChildren(view);
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', path === a.dataset.nav || (a.dataset.nav !== '#/' && path.startsWith(a.dataset.nav))));
  for (const [re, page, names = []] of table) {
    const m = path.match(re);
    if (m) {
      const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      const c = page(view, params); cleanup = typeof c === 'function' ? c : null;
      window.scrollTo(0, 0);
      return;
    }
  }
  view.innerHTML = `<div class="state state-empty">Không tìm thấy trang. <a href="${teacher ? '#/gv/hoc-sinh' : '#/'}">Về trang chính</a></div>`;
}

function startPresence() {
  clearInterval(presenceTimer);
  presenceTimer = setInterval(() => { if (document.visibilityState === 'visible') rpc('touch_presence').catch(() => {}); }, 60000);
}

function enter() {
  shell(); startPresence();
  if (state.profile.role === 'teacher' && !location.hash.startsWith('#/gv/')) location.replace('#/gv/hoc-sinh');
  route();
}

function renderLogin(msg = '') {
  app.innerHTML = `<main class="login-wrap">
    <div class="login card">
      <div class="brand big"><span class="brand-mark zh" aria-hidden="true">中</span><span>Học tiếng Trung</span></div>
      <p class="muted">Tiếng Trung tổng hợp · Tiếng Trung nghe - nói</p>
      ${configured ? `<form id="login-form" novalidate>
        <label class="lbl" for="code">Mã đăng nhập</label>
        <input id="code" name="code" inputmode="numeric" autocomplete="username" required autofocus>
        <label class="lbl" for="password">Mật khẩu</label>
        <div class="pw-wrap"><input id="password" name="password" type="password" autocomplete="current-password" required>
          <button type="button" class="btn btn-ghost btn-sm" id="toggle-pw" aria-pressed="false">Hiện</button></div>
        <p id="login-msg" class="form-msg" role="alert">${esc(msg)}</p>
        <button class="btn btn-primary w-full" id="login-btn">Đăng nhập</button>
        <p class="small muted center">Dùng tài khoản do giáo viên cấp. Học sinh và giáo viên đăng nhập tại đây.</p>
      </form>` : `<div class="state state-error" role="alert"><strong>Chưa cấu hình Supabase.</strong> Sao chép <code>js/config.example.js</code> thành <code>js/config.js</code> và điền SUPABASE_URL, SUPABASE_ANON_KEY (xem docs/HUONG_DAN.md).</div>`}
    </div></main>`;
  if (!configured) return;
  $('#toggle-pw').addEventListener('click', e => { const i = $('#password'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; e.target.textContent = show ? 'Ẩn' : 'Hiện'; e.target.setAttribute('aria-pressed', show); });
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('#code').value.trim(), pw = $('#password').value, m = $('#login-msg'), btn = $('#login-btn');
    if (!code || !pw) { m.textContent = 'Vui lòng nhập mã đăng nhập và mật khẩu.'; return; }
    btn.disabled = true; btn.textContent = 'Đang đăng nhập…'; m.textContent = '';
    try { await login(code, pw); enter(); }
    catch (err) { m.textContent = errMsg(err); btn.disabled = false; btn.textContent = 'Đăng nhập'; }
  });
}

window.addEventListener('hashchange', route);
(async () => {
  app.innerHTML = loadingHTML('Đang kiểm tra đăng nhập…');
  if (!configured) { renderLogin(); return; }
  try { const p = await restoreSession(); if (p) enter(); else renderLogin(); }
  catch (e) { renderLogin(errMsg(e)); }
})();

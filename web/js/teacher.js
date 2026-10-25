// Trang giáo viên: danh sách học sinh, hồ sơ, chi tiết lượt + chấm dạng 4, nội dung bài tập, nhật ký, Excel
import { rpc, select, curriculum, state, errMsg } from './api.js';
import {
  esc, $, $$, toast, modal, fmtDateTime, fmtDate, vnDayKey, todayKey, addDays, hms, durText, score,
  REQUIRED_PER_WEEK, TOTAL_LESSONS, TYPE_NAMES, TYPE_SHORT, loadingHTML, emptyHTML, errorHTML, progressBar, badge,
  hashParams, setHashParams
} from './util.js';
import { renderSection, renderAttemptResult } from './render.js';
import { barChart, bindCharts } from './charts.js';

const ONLINE_MS = 120 * 1000;
const isOnline = p => p.last_seen_at && (Date.now() - new Date(p.last_seen_at).getTime() <= ONLINE_MS);
const onlineBadge = p => isOnline(p) ? badge('Online', 'ok') : badge('Offline', 'neutral');
const accBadge = p => p.deleted_at ? badge('Đã xoá', 'bad') : p.status === 'locked' ? badge('Đã khoá', 'pending') : badge('Hoạt động', 'ok');

async function withLoad(root, fn) {
  root.innerHTML = loadingHTML();
  try { await fn(); }
  catch (e) { root.innerHTML = errorHTML(errMsg(e)); $('#retry', root)?.addEventListener('click', () => withLoad(root, fn)); }
}

// Cùng một nguồn cho bảng và Excel
async function loadOverview() {
  const [students, report] = await Promise.all([
    select('profiles', q => q.eq('role', 'student').order('full_name')),
    rpc('teacher_week_report'),
  ]);
  const rep = {};
  for (const r of report) (rep[r.student_id] ||= {})[r.week] = r;
  return { students, rep };
}

// ======================= DANH SÁCH HỌC SINH =======================
export function studentsPage(root) {
  const PAGE = 15;
  let data = null;
  const f = { q: '', w: '1', tk: 'conhd', td: '', sx: 'ten', dir: 'asc', p: '1', ...JSON.parse(sessionStorage.getItem('gv-filter') || '{}'), ...hashParams() };
  const save = () => { sessionStorage.setItem('gv-filter', JSON.stringify(f)); setHashParams(f); };

  function filtered() {
    const w = Number(f.w), req = REQUIRED_PER_WEEK(w);
    const q = f.q.trim().toLowerCase();
    let list = data.students.filter(s => {
      if (q && !(`${s.student_code || ''} ${s.login_code} ${s.full_name}`.toLowerCase().includes(q))) return false;
      if (f.tk === 'conhd' && s.deleted_at) return false;
      if (f.tk === 'active' && (s.status !== 'active' || s.deleted_at)) return false;
      if (f.tk === 'locked' && (s.status !== 'locked' || s.deleted_at)) return false;
      if (f.tk === 'deleted' && !s.deleted_at) return false;
      const done = data.rep[s.id]?.[w]?.completed || 0;
      if (f.td === 'chua' && done > 0) return false;
      if (f.td === 'dang' && !(done > 0 && done < req)) return false;
      if (f.td === 'xong' && done < req) return false;
      return true;
    });
    const key = {
      ten: s => s.full_name.toLowerCase(), ma: s => s.student_code || s.login_code,
      dangnhap: s => s.last_login_at || '', tiendo: s => data.rep[s.id]?.[w]?.completed || 0
    }[f.sx] || (s => s.full_name);
    list.sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * (f.dir === 'desc' ? -1 : 1); });
    return list;
  }

  function drawShell() {
    const sortOpt = (v, t) => `<option value="${v}" ${f.sx === v ? 'selected' : ''}>${t}</option>`;
    root.innerHTML = `<div class="row-between wrap"><h1>Danh sách học sinh</h1>
        <div class="actions"><button class="btn btn-secondary" id="add">+ Thêm học sinh</button>
        <button class="btn btn-primary" id="xlsx">Xuất Excel (danh sách đang lọc)</button></div></div>
      <form class="filters card" id="flt" role="search">
        <label class="grow">Tìm theo mã hoặc họ tên <input type="search" name="q" value="${esc(f.q)}" placeholder="vd: 482915 hoặc Châu Vũ"></label>
        <label>Tuần <select name="w">${[1, 2, 3, 4, 5, 6, 7, 8].map(x => `<option ${String(x) === f.w ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Tài khoản <select name="tk">${[['conhd', 'Chưa xoá'], ['active', 'Hoạt động'], ['locked', 'Đã khoá'], ['deleted', 'Đã xoá'], ['all', 'Tất cả']].map(([v, t]) => `<option value="${v}" ${f.tk === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Tiến độ tuần <select name="td">${[['', 'Tất cả'], ['chua', 'Chưa hoàn thành bài nào'], ['dang', 'Hoàn thành một phần'], ['xong', 'Hoàn thành đủ tuần']].map(([v, t]) => `<option value="${v}" ${f.td === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Sắp xếp <select name="sx">${sortOpt('ten', 'Tên')}${sortOpt('ma', 'Mã học sinh')}${sortOpt('dangnhap', 'Lần đăng nhập')}${sortOpt('tiendo', 'Tiến độ')}</select></label>
        <label>Thứ tự <select name="dir"><option value="asc" ${f.dir === 'asc' ? 'selected' : ''}>Tăng dần</option><option value="desc" ${f.dir === 'desc' ? 'selected' : ''}>Giảm dần</option></select></label>
      </form><div id="tbl" aria-live="polite"></div>`;
  }

  function draw() {
    const w = Number(f.w), req = REQUIRED_PER_WEEK(w);
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    const page = Math.min(pages, Math.max(1, Number(f.p) || 1));
    const rows = list.slice((page - 1) * PAGE, page * PAGE).map((s, i) => {
      const r = data.rep[s.id]?.[w] || { completed: 0, seconds: 0 };
      return `<tr>
        <td data-label="STT">${(page - 1) * PAGE + i + 1}</td>
        <td data-label="Mã học sinh">${esc(s.student_code || '—')}</td>
        <td data-label="Họ tên"><strong>${esc(s.full_name)}</strong></td>
        <td data-label="Lớp">${esc(s.class_name || '—')}</td>
        <td data-label="Tên đăng nhập">${esc(s.login_code)}</td>
        <td data-label="Tài khoản">${accBadge(s)}</td>
        <td data-label="Đăng nhập gần nhất">${fmtDateTime(s.last_login_at)}</td>
        <td data-label="Trạng thái">${onlineBadge(s)}</td>
        <td data-label="Tuần ${w}"><strong>${r.completed}/${req} bài</strong><div class="small muted">${hms(r.seconds)}</div></td>
        <td data-label="Tiến độ tuần" class="td-progress">${progressBar(r.completed, req, 'Tiến độ tuần ' + w)}</td>
        <td data-label="" class="td-actions"><a class="btn btn-sm btn-secondary" href="#/gv/hs/${s.id}">Xem hồ sơ</a>
          <a class="btn btn-sm btn-ghost" href="#/gv/hs/${s.id}/sua">Chỉnh sửa</a></td></tr>`;
    }).join('');
    $('#tbl', root).innerHTML = list.length ? `<p class="small muted">${list.length} học sinh khớp bộ lọc</p><div class="table-wrap card"><table class="table responsive"><thead><tr>
        <th>STT</th><th>Mã HS</th><th>Họ tên</th><th>Lớp</th><th>Tên đăng nhập</th><th>Tài khoản</th><th>Đăng nhập gần nhất</th><th>Online</th><th>Tuần ${w}</th><th>Tiến độ tuần</th><th></th>
        </tr></thead><tbody>${rows}</tbody></table></div>
        <nav class="pager" aria-label="Phân trang">${pages > 1 ? Array.from({ length: pages }, (_, i) => `<button class="btn btn-sm ${i + 1 === page ? 'btn-primary' : 'btn-ghost'}" data-page="${i + 1}" aria-current="${i + 1 === page}">${i + 1}</button>`).join('') : ''}
        <span class="muted small">Online = có hoạt động trong 2 phút gần nhất · tự cập nhật mỗi 30 giây</span></nav>`
      : emptyHTML(data.students.length ? 'Không có học sinh nào khớp bộ lọc.' : 'Chưa có học sinh trong hệ thống.');
  }

  root.addEventListener('input', e => {
    if (e.target.name === 'q' && !e.isComposing) { f.q = e.target.value; f.p = '1'; save(); draw(); }
  });
  root.addEventListener('change', e => {
    if (!e.target.closest('#flt') || e.target.name === 'q') return;
    f[e.target.name] = e.target.value; f.p = '1'; save(); draw();
  });
  root.addEventListener('compositionend', e => { if (e.target.name === 'q') { f.q = e.target.value; f.p = '1'; save(); draw(); } });
  root.addEventListener('submit', e => e.preventDefault());
  root.addEventListener('click', e => {
    const pg = e.target.closest('[data-page]')?.dataset.page; if (pg) { f.p = pg; save(); draw(); }
    if (e.target.id === 'xlsx') exportExcel(filtered(), data.rep);
    if (e.target.id === 'add') addStudent().then(ok => ok && load());
  });
  const load = () => withLoad(root, async () => { data = await loadOverview(); drawShell(); draw(); });
  load();
  const t = setInterval(async () => {
    if (document.visibilityState !== 'visible' || !$('#tbl', root)) return;
    try { data = await loadOverview(); draw(); } catch { /* giữ dữ liệu cũ */ }
  }, 30000);
  return () => clearInterval(t);
}

// ---------- Xuất Excel: đúng 8 cột tuần, mỗi ô "hh:mm:ss | x/y bài" ----------
function exportExcel(list, rep) {
  if (!window.XLSX) { toast('Chưa tải được thư viện Excel. Kiểm tra kết nối mạng và thử lại.', 'error'); return; }
  if (!list.length) { toast('Không có học sinh nào để xuất.', 'error'); return; }
  const head = ['STT', 'Mã học sinh', 'Họ tên', 'Lớp', 'Tên đăng nhập', ...[1, 2, 3, 4, 5, 6, 7, 8].map(w => `Tuần ${w}`)];
  const rows = list.map((s, i) => [i + 1, s.student_code || '', s.full_name, s.class_name || '', s.login_code,
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(w => { const r = rep[s.id]?.[w] || { seconds: 0, completed: 0 }; return `${hms(r.seconds)} | ${r.completed}/${REQUIRED_PER_WEEK(w)} bài`; })]);
  const title = [`Báo cáo tiến độ học tiếng Trung — xuất lúc ${fmtDateTime(new Date())} (giờ Việt Nam)`];
  const note = ['Mỗi ô tuần: tổng thời gian học hợp lệ | số bài hoàn thành / số bài bắt buộc (tuần 1–6: 3 bài, tuần 7–8: 4 bài)'];
  const ws = XLSX.utils.aoa_to_sheet([title, note, [], head, ...rows]);
  ws['!cols'] = [{ wch: 5 }, { wch: 13 }, { wch: 22 }, { wch: 10 }, { wch: 14 }, ...Array(8).fill({ wch: 21 })];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 12 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 12 } }];
  ws['!autofilter'] = { ref: `A4:M${rows.length + 4}` };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Báo cáo');
  XLSX.writeFile(wb, `bao-cao-tieng-trung-${todayKey()}.xlsx`);
  toast('Đã xuất file Excel.', 'ok');
}

async function addStudent() {
  const box = await modal({
    title: 'Thêm học sinh', confirmText: 'Tạo tài khoản',
    body: `<div class="form-grid">
      <label>Họ tên <input name="name" required maxlength="120"></label>
      <label>Mã đăng nhập <input name="code" required pattern="[0-9A-Za-z_.-]{3,32}"></label>
      <label>Mã học sinh <input name="scode" placeholder="Mặc định = mã đăng nhập"></label>
      <label>Lớp <input name="cls"></label>
      <label>Mật khẩu ban đầu <input name="pw" type="password" minlength="6" required autocomplete="new-password"></label></div>`
  });
  if (!box) return false;
  const v = n => box.querySelector(`[name=${n}]`).value.trim();
  try {
    await rpc('admin_create_student', { p_code: v('code'), p_password: box.querySelector('[name=pw]').value, p_full_name: v('name'), p_student_code: v('scode') || null, p_class: v('cls') || null });
    toast('Đã tạo tài khoản học sinh.', 'ok'); return true;
  } catch (e) { toast('Chưa tạo được: ' + errMsg(e), 'error', 7000); return false; }
}

export async function resetPassword(student) {
  const box = await modal({
    title: `Đặt lại mật khẩu — ${student.full_name}`, confirmText: 'Đặt lại',
    body: `<p class="small muted">Mật khẩu được mã hoá ngay trên máy chủ; hệ thống không lưu hay hiển thị mật khẩu dạng văn bản.</p>
      <div class="form-grid"><label>Mật khẩu mới <input name="pw" type="password" minlength="6" required autocomplete="new-password"></label>
      <label>Lý do <input name="reason" placeholder="vd: học sinh quên mật khẩu"></label></div>`
  });
  if (!box) return;
  try {
    await rpc('admin_set_password', { p_user: student.id, p_password: box.querySelector('[name=pw]').value, p_reason: box.querySelector('[name=reason]').value || null });
    toast('Đã đặt lại mật khẩu.', 'ok');
  } catch (e) { toast('Chưa đặt lại được: ' + errMsg(e), 'error', 7000); }
}

// ======================= HỒ SƠ HỌC SINH =======================
export function profilePage(root, { id }) {
  withLoad(root, async () => {
    const [cur, prof, sums, comp, sessions, logins, secs] = await Promise.all([
      curriculum(),
      select('profiles', q => q.eq('id', id)),
      select('v_attempt_summary', q => q.eq('student_id', id).order('started_at', { ascending: false })),
      select('v_lesson_completion', q => q.eq('student_id', id)),
      select('study_sessions', q => q.eq('student_id', id).is('deleted_at', null).order('started_at').range(0, 9999)),
      select('login_events', q => q.eq('user_id', id).is('deleted_at', null).order('logged_in_at', { ascending: false }).limit(50)),
      select('attempt_sections', q => q, 'attempt_id, section_type, status, grading_status'),
    ]);
    const p = prof[0];
    if (!p) { root.innerHTML = emptyHTML('Không tìm thấy học sinh.'); return; }
    const live = sums.filter(a => !a.deleted_at);
    const done = new Set(comp.map(c => c.lesson_id));
    const totalSec = sessions.filter(s => live.some(a => a.attempt_id === s.attempt_id)).reduce((a, s) => a + s.duration_seconds, 0);
    const finals = live.filter(a => a.score_final).sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
    const scores = finals.map(a => Number(a.score_so_far));
    const secBy = {}; for (const s of secs) (secBy[s.attempt_id] ||= {})[s.section_type] = s;

    // tiến độ từng bài
    const progress = [1, 2, 3, 4, 5, 6, 7, 8].map(w => {
      const ls = cur.lessons.filter(l => l.week === w);
      const dn = ls.filter(l => done.has(l.id)).length;
      const wsec = sessions.filter(s => cur.lessonMap[s.lesson_id].week === w && live.some(a => a.attempt_id === s.attempt_id)).reduce((a, s) => a + s.duration_seconds, 0);
      return `<section class="week-mini card-inner"><div class="row-between"><strong>Tuần ${w}</strong><span>${dn}/${REQUIRED_PER_WEEK(w)} bài · ${hms(wsec)}</span></div>
        ${progressBar(dn, REQUIRED_PER_WEEK(w), 'Tuần ' + w)}
        <ul class="lesson-list compact">${ls.map(l => {
          const at = live.filter(a => a.lesson_id === l.id);
          const latest = at[0];
          const st = at.some(a => a.status === 'in_progress') ? badge('Đang làm', 'pending') : done.has(l.id) ? badge('Đã hoàn thành', 'ok') : badge('Chưa làm', 'neutral');
          const types = latest ? [1, 2, 3, 4].map(t => { const s = secBy[latest.attempt_id]?.[t]; const lbl = !s || s.status !== 'submitted' ? 'chưa nộp' : 'đã nộp'; return `<span class="type-dot ${s?.status === 'submitted' ? 'on' : ''}" title="${TYPE_SHORT[t]}: ${lbl}">D${t}: ${lbl}</span>`; }).join('') : '';
          const best = at.filter(a => a.score_final).map(a => Number(a.score_so_far));
          return `<li class="lesson-row"><div><span class="eyebrow">${esc(cur.subjectMap[l.subject_code].title)} · Bài ${l.lesson_order}</span>
            <div class="zh lesson-title">${esc(l.title)}</div>${st}<div class="types">${types}</div></div>
            <div class="small right">${at.length} lượt${at.length > 1 ? ` (làm lại ${at.length - 1})` : ''}<br>${best.length ? 'Cao nhất ' + score(Math.max(...best)) : ''}</div></li>`;
        }).join('')}</ul></section>`;
    }).join('');

    const days = []; for (let i = 29; i >= 0; i--) { const k = addDays(todayKey(), -i); const sec = sessions.filter(s => vnDayKey(s.started_at) === k).reduce((a, s) => a + s.duration_seconds, 0); days.push({ label: k.slice(8) + '/' + k.slice(5, 7), value: Math.round(sec / 60 * 10) / 10, tip: `${fmtDate(k + 'T12:00:00+07:00')}: ${durText(sec)}` }); }
    const scoreData = finals.map((a, i) => ({ label: '#' + (i + 1), value: Number(a.score_so_far), tip: `${fmtDateTime(a.submitted_at)} · ${cur.subjectMap[a.subject_code].title} T${a.week}B${a.lesson_order} lượt ${a.attempt_no}: ${score(a.score_so_far)}/10` }));
    const weekData = [1, 2, 3, 4, 5, 6, 7, 8].map(w => ({ label: 'T' + w, value: comp.filter(c => c.week === w).length, tip: `Tuần ${w}: ${comp.filter(c => c.week === w).length}/${REQUIRED_PER_WEEK(w)} bài` }));

    root.innerHTML = `<nav class="crumbs"><a href="#/gv/hoc-sinh">Danh sách học sinh</a> › ${esc(p.full_name)}</nav>
      <div class="row-between wrap"><h1>${esc(p.full_name)}</h1>
        <div class="actions"><button class="btn btn-ghost" id="pw">Đặt lại mật khẩu</button><a class="btn btn-primary" href="#/gv/hs/${p.id}/sua">Chỉnh sửa toàn bộ dữ liệu</a></div></div>
      <section class="card"><dl class="meta">
        <div><dt>Mã học sinh</dt><dd>${esc(p.student_code || '—')}</dd></div><div><dt>Tên đăng nhập</dt><dd>${esc(p.login_code)}</dd></div>
        <div><dt>Lớp</dt><dd>${esc(p.class_name || '—')}</dd></div><div><dt>Tài khoản</dt><dd>${accBadge(p)} ${onlineBadge(p)}</dd></div>
        <div><dt>Đăng nhập gần nhất</dt><dd>${fmtDateTime(p.last_login_at)}</dd></div><div><dt>Tổng lượt đăng nhập</dt><dd>${p.login_count}</dd></div>
      </dl></section>
      <div class="stats-4 mt-3">
        <div class="stat card"><span class="lbl">Bài hoàn thành</span><strong>${done.size}/${TOTAL_LESSONS}</strong>${progressBar(done.size, TOTAL_LESSONS, 'Toàn khoá')}</div>
        <div class="stat card"><span class="lbl">Tổng thời gian học</span><strong>${hms(totalSec)}</strong></div>
        <div class="stat card"><span class="lbl">Lượt làm hoàn thành</span><strong>${live.filter(a => a.status === 'submitted').length}</strong></div>
        <div class="stat card"><span class="lbl">Điểm cao nhất · gần nhất · TB</span><strong>${scores.length ? `${score(Math.max(...scores))} · ${score(scores[scores.length - 1])} · ${score(scores.reduce((a, b) => a + b, 0) / scores.length)}` : '—'}</strong>
          <span class="small muted">${scores.length ? `Tính trên ${scores.length} lượt đã có điểm cuối cùng` : 'Chưa có lượt nào có điểm cuối cùng'}</span></div>
      </div>
      <div class="grid-3 mt-3">
        <section class="card"><h2 class="h3">Điểm theo từng lượt</h2>${barChart(scoreData, { max: 10, yFormat: v => score(v), emptyText: 'Chưa có lượt có điểm cuối cùng.' })}</section>
        <section class="card"><h2 class="h3">Thời gian học 30 ngày (phút)</h2>${barChart(days, { yFormat: v => Math.round(v) + "'", emptyText: 'Chưa có thời gian học trong 30 ngày qua.' })}</section>
        <section class="card"><h2 class="h3">Tiến độ hoàn thành theo tuần</h2>${barChart(weekData, { max: 4, yFormat: v => Math.round(v), emptyText: 'Chưa hoàn thành bài nào.' })}</section>
      </div>
      <section class="card mt-3"><h2 class="h3">Tiến độ 8 tuần · hai môn</h2><div class="weeks-grid">${progress}</div></section>
      <section class="card mt-3"><h2 class="h3">Lịch sử làm bài</h2>
        ${sums.length ? `<div class="table-wrap"><table class="table responsive"><thead><tr><th>Môn · Tuần · Bài</th><th>Lượt</th><th>Bắt đầu</th><th>Nộp</th><th>Thời gian</th><th>Điểm D1–D4</th><th>Tổng</th><th></th></tr></thead><tbody>
          ${sums.map(a => `<tr class="${a.deleted_at ? 'row-deleted' : ''}"><td data-label="Bài">${esc(cur.subjectMap[a.subject_code].title)} · T${a.week} · B${a.lesson_order}<div class="zh small">${esc(a.lesson_title)}</div>${a.deleted_at ? badge('Đã xoá', 'bad') : ''}</td>
            <td data-label="Lượt">#${a.attempt_no}</td><td data-label="Bắt đầu">${fmtDateTime(a.started_at)}</td><td data-label="Nộp">${a.status === 'submitted' ? fmtDateTime(a.submitted_at) : badge('Đang làm', 'neutral')}</td>
            <td data-label="Thời gian">${hms(a.time_seconds)}</td><td data-label="Dạng" class="small">${a.sections_submitted}/4 dạng đã nộp</td>
            <td data-label="Tổng">${a.status !== 'submitted' ? '—' : `<strong>${score(a.score_so_far)}</strong>/10`}</td>
            <td><a class="btn btn-sm btn-secondary" href="#/gv/luot/${a.attempt_id}">Xem chi tiết</a></td></tr>`).join('')}</tbody></table></div>` : emptyHTML('Học sinh chưa có lượt làm bài nào.')}
      </section>
      <section class="card mt-3"><h2 class="h3">Lịch sử đăng nhập (50 lần gần nhất)</h2>
        ${logins.length ? `<div class="table-wrap"><table class="table responsive"><thead><tr><th>Đăng nhập</th><th>Đăng xuất</th><th>Thiết bị / trình duyệt</th></tr></thead><tbody>
          ${logins.map(l => `<tr><td data-label="Đăng nhập">${fmtDateTime(l.logged_in_at)}</td><td data-label="Đăng xuất">${l.logged_out_at ? fmtDateTime(l.logged_out_at) : '—'}</td><td data-label="Thiết bị" class="small muted">${esc(l.user_agent || '—')}</td></tr>`).join('')}</tbody></table></div>` : emptyHTML('Chưa có lịch sử đăng nhập.')}
      </section>`;
    bindCharts(root);
    $('#pw', root).addEventListener('click', () => resetPassword(p));
  });
}

// ======================= CHI TIẾT LƯỢT + CHẤM DẠNG 4 =======================
export function attemptPage(root, { id }) {
  const load = () => withLoad(root, async () => {
    const [cur, detail] = await Promise.all([curriculum(), rpc('get_attempt_detail', { p_attempt: id })]);
    const prof = (await select('profiles', q => q.eq('id', detail.attempt.student_id)))[0];
    root.innerHTML = `<nav class="crumbs"><a href="#/gv/hoc-sinh">Danh sách học sinh</a> › <a href="#/gv/hs/${prof.id}">${esc(prof.full_name)}</a> › Lượt #${detail.attempt.attempt_no}</nav>
      ${detail.attempt.deleted_at ? `<div class="state state-error">Lượt này đã bị xoá mềm lúc ${fmtDateTime(detail.attempt.deleted_at)}. Có thể khôi phục trong “Chỉnh sửa toàn bộ dữ liệu”.</div>` : ''}
      ${renderAttemptResult(detail, cur, { teacher: true, durText })}
      <section class="card"><h2 class="h3">Các phiên học của lượt</h2>
        ${detail.sessions.length ? `<div class="table-wrap"><table class="table responsive"><thead><tr><th>Bắt đầu</th><th>Tín hiệu cuối</th><th>Kết thúc</th><th>Thời lượng</th><th>Lý do kết thúc</th></tr></thead><tbody>
        ${detail.sessions.map(s => `<tr class="${s.deleted_at ? 'row-deleted' : ''}"><td data-label="Bắt đầu">${fmtDateTime(s.started_at)}</td><td data-label="Tín hiệu cuối">${fmtDateTime(s.last_heartbeat_at)}</td><td data-label="Kết thúc">${s.ended_at ? fmtDateTime(s.ended_at) : 'đang mở'}</td><td data-label="Thời lượng">${hms(s.duration_seconds)}</td><td data-label="Lý do">${esc(s.end_reason || '—')}${s.deleted_at ? ' ' + badge('Đã xoá', 'bad') : ''}</td></tr>`).join('')}</tbody></table></div>` : emptyHTML('Chưa có phiên học.')}
      </section>
      <div class="actions-bar"><a class="btn btn-secondary" href="#/gv/hs/${prof.id}/sua?luot=${id}">Sửa dữ liệu lượt này</a>
        <button class="btn btn-ghost" id="regrade">Chấm lại dạng 1–3 theo đáp án hiện tại</button></div>`;
    $('#regrade', root)?.addEventListener('click', async () => {
      const box = await modal({ title: 'Chấm lại lượt này?', body: '<p>Dạng 1–3 sẽ được chấm lại theo đáp án và quy tắc hiện tại. Các điều chỉnh thủ công của giáo viên được giữ nguyên. Thao tác được ghi nhật ký.</p><label class="lbl">Lý do<input name="reason"></label>', confirmText: 'Chấm lại' });
      if (!box) return;
      try { await rpc('admin_regrade_attempt', { p_attempt: id, p_reason: box.querySelector('[name=reason]').value || null }); toast('Đã chấm lại.', 'ok'); load(); }
      catch (err) { toast(errMsg(err), 'error'); }
    });
  });
  load();
}

// ======================= NỘI DUNG BÀI TẬP (xem trước + đáp án) =======================
export function contentPage(root) {
  let lessonId = hashParams().bai || 'tong_hop-w1-b1';
  const load = () => withLoad(root, async () => {
    const cur = await curriculum();
    const lesson = cur.lessonMap[lessonId] || cur.lessons[0]; lessonId = lesson.id;
    const sections = cur.byLesson[lesson.id];
    const qids = sections.flatMap(s => (cur.bySection[s.id] || []).map(q => q.id));
    const keysArr = await select('answer_keys', q => q.in('question_id', qids));
    const keys = Object.fromEntries(keysArr.map(k => [k.question_id, k]));
    const opts = cur.subjects.map(s => `<optgroup label="${esc(s.title)}">${cur.lessons.filter(l => l.subject_code === s.code).map(l => `<option value="${l.id}" ${l.id === lesson.id ? 'selected' : ''}>Tuần ${l.week} · Bài ${l.lesson_order} — ${esc(l.title)}</option>`).join('')}</optgroup>`).join('');
    root.innerHTML = `<h1>Nội dung bài tập</h1>
      <p class="muted">Bản xem trước toàn bộ bài tập đã nhập từ file Word, kèm đáp án đã cấu hình. Học sinh chỉ thấy đáp án sau khi nộp từng dạng. File Word gốc không được cung cấp cho học sinh.</p>
      <label class="lbl" for="pick">Chọn bài</label><select id="pick" class="w-full">${opts}</select>
      <p class="small muted mt-2">${esc(lesson.source_ref || '')}</p>
      ${sections.map(s => `<section class="card mt-3">${renderSection(s, cur.bySection[s.id] || [], 'preview', { keys })}
        <div class="key-tools">
          ${s.section_type < 4 ? `<form class="rules" data-sec="${s.id}"><span class="lbl">Quy tắc chấm:</span>
            <label class="check"><input type="checkbox" name="ignore_whitespace" ${s.grading_rules.ignore_whitespace ? 'checked' : ''}> Bỏ qua khoảng trắng</label>
            <label class="check"><input type="checkbox" name="ignore_punctuation" ${s.grading_rules.ignore_punctuation ? 'checked' : ''}> Bỏ qua dấu câu</label>
            <button class="btn btn-sm btn-secondary">Lưu quy tắc</button></form>
            <details><summary>Sửa / xác nhận đáp án (${(cur.bySection[s.id] || []).length} câu)</summary>
              <p class="small muted">Mỗi dòng là một phương án đúng. Câu có nhiều ô: ngăn cách các ô bằng dấu “|”.</p>
              ${(cur.bySection[s.id] || []).map(q => `<form class="key-edit" data-q="${q.id}"><span class="item-no">${q.prompt.label || q.prompt.no + '.'}</span>
                <textarea rows="2" class="zh" aria-label="Đáp án câu ${q.q_order}">${esc((keys[q.id]?.accepted || []).map(a => a.join(' | ')).join('\n'))}</textarea>
                <button class="btn btn-sm btn-ghost">Lưu</button></form>`).join('')}
            </details>` : '<p class="small muted">Dạng 4 do giáo viên chấm thủ công; đáp án tham khảo chỉ để đối chiếu.</p>'}
        </div></section>`).join('')}`;
    $('#pick', root).addEventListener('change', e => { lessonId = e.target.value; setHashParams({ bai: lessonId }); load(); });
    $$('form.rules', root).forEach(f => f.addEventListener('submit', async e => {
      e.preventDefault();
      try { await rpc('admin_update_grading_rules', { p_section: f.dataset.sec, p_rules: { ignore_whitespace: f.ignore_whitespace.checked, ignore_punctuation: f.ignore_punctuation.checked } }); await curriculum(true); toast('Đã lưu quy tắc chấm. Các lượt đã nộp không tự chấm lại — dùng “Chấm lại” trong chi tiết lượt nếu cần.', 'ok', 7000); }
      catch (err) { toast(errMsg(err), 'error'); }
    }));
    $$('form.key-edit', root).forEach(f => f.addEventListener('submit', async e => {
      e.preventDefault();
      const q = (cur.bySection[sections.find(s => f.dataset.q.startsWith(s.id)).id] || []).find(x => x.id === f.dataset.q);
      const alts = f.querySelector('textarea').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split('|').map(x => x.trim()));
      if (!alts.length || alts.some(a => a.length !== q.blank_count)) { toast(`Mỗi phương án phải có đúng ${q.blank_count} ô.`, 'error'); return; }
      try { await rpc('admin_update_answer_key', { p_question: q.id, p_accepted: alts }); toast('Đã lưu đáp án.', 'ok'); }
      catch (err) { toast(errMsg(err), 'error'); }
    }));
  });
  load();
}

// ======================= NHẬT KÝ KIỂM TOÁN =======================
const RESTORABLE = ['profiles', 'attempts', 'attempt_sections', 'responses', 'study_sessions', 'login_events'];
const TABLE_VI = { profiles: 'Hồ sơ', attempts: 'Lượt làm', attempt_sections: 'Dạng bài / điểm', responses: 'Câu trả lời', study_sessions: 'Phiên học', login_events: 'Đăng nhập', answer_keys: 'Đáp án', sections: 'Quy tắc chấm', 'auth.users': 'Mật khẩu' };
const ACTION_VI = { update: 'Sửa', delete: 'Xoá mềm', restore: 'Khôi phục', grade: 'Chấm điểm (cũ)', reset_password: 'Đặt lại mật khẩu', create: 'Tạo mới', answer_key: 'Đáp án / quy tắc' };
const jv = v => v === null || v === undefined ? '∅' : typeof v === 'string' ? v : JSON.stringify(v);

export function auditPage(root) {
  let student = hashParams().hs || '';
  const load = () => withLoad(root, async () => {
    const [students, logs] = await Promise.all([
      select('profiles', q => q.eq('role', 'student').order('full_name'), 'id, full_name'),
      select('audit_log', q => (student ? q.eq('student_id', student) : q).order('id', { ascending: false }).limit(300)),
    ]);
    const nm = Object.fromEntries(students.map(s => [s.id, s.full_name]));
    root.innerHTML = `<h1>Nhật ký kiểm toán</h1>
      <p class="muted">Mọi thao tác sửa, xoá, khôi phục, chấm điểm đều được ghi lại và không thể chỉnh sửa từ giao diện. Hiển thị 300 bản ghi mới nhất.</p>
      <label class="lbl" for="hs">Học sinh</label><select id="hs"><option value="">Tất cả</option>${students.map(s => `<option value="${s.id}" ${s.id === student ? 'selected' : ''}>${esc(s.full_name)}</option>`).join('')}</select>
      ${logs.length ? `<div class="table-wrap card mt-3"><table class="table responsive"><thead><tr><th>#</th><th>Thời điểm</th><th>Người thực hiện</th><th>Học sinh</th><th>Thao tác</th><th>Bản ghi · trường</th><th>Trước</th><th>Sau</th><th>Lý do</th><th></th></tr></thead><tbody>
        ${logs.map(l => `<tr><td data-label="#">${l.id}</td><td data-label="Thời điểm">${fmtDateTime(l.created_at)}</td><td data-label="Người thực hiện">Giáo viên</td>
          <td data-label="Học sinh">${esc(nm[l.student_id] || '—')}</td><td data-label="Thao tác">${esc(ACTION_VI[l.action] || l.action)}</td>
          <td data-label="Bản ghi">${esc(TABLE_VI[l.table_name] || l.table_name)} · <code>${esc(l.field || '')}</code></td>
          <td data-label="Trước" class="zh small cell-val">${esc(jv(l.old_value))}</td><td data-label="Sau" class="zh small cell-val">${esc(jv(l.new_value))}</td>
          <td data-label="Lý do" class="small">${esc(l.reason || '')}</td>
          <td>${RESTORABLE.includes(l.table_name) && l.field && ['update', 'delete', 'restore', 'grade'].includes(l.action) ? `<button class="btn btn-sm btn-ghost" data-restore="${l.id}">Khôi phục giá trị trước</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : emptyHTML('Chưa có bản ghi nhật ký.')}`;
    $('#hs', root).addEventListener('change', e => { student = e.target.value; setHashParams({ hs: student }); load(); });
  });
  root.addEventListener('click', async e => {
    const id = e.target.closest('[data-restore]')?.dataset.restore; if (!id) return;
    const box = await modal({ title: `Khôi phục theo nhật ký #${id}?`, body: '<p>Trường dữ liệu sẽ được đặt lại về giá trị “Trước”. Thao tác khôi phục cũng được ghi nhật ký.</p><label class="lbl">Lý do<input name="reason"></label>', confirmText: 'Khôi phục' });
    if (!box) return;
    try { await rpc('admin_restore', { p_audit_id: Number(id), p_reason: box.querySelector('[name=reason]').value || null }); toast('Đã khôi phục.', 'ok'); load(); }
    catch (err) { toast('Chưa khôi phục được: ' + errMsg(err), 'error', 7000); }
  });
  load();
}

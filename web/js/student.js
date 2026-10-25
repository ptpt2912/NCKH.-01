// Trang học sinh: trang chủ, danh sách tuần, làm bài, kết quả, lịch sử, tài khoản
import { rpc, select, rpcKeepalive, curriculum, state, errMsg } from './api.js';
import {
  esc, $, $$, toast, modal, fmtDateTime, fmtDate, fmtTime, vnDayKey, todayKey, mondayOf, addDays, hms, durText, score,
  REQUIRED_PER_WEEK, TOTAL_LESSONS, TYPE_NAMES, TYPE_SHORT, loadingHTML, emptyHTML, errorHTML, progressBar, badge,
  hashParams, setHashParams
} from './util.js';
import { renderSection, renderAttemptResult, sectionScoreLine } from './render.js';
import { barChart, bindCharts } from './charts.js';

// Ngày học hợp lệ = ngày có ít nhất một dạng bài được nộp thành công (giờ Việt Nam)
async function loadMyData() {
  const [summaries, completion, sections, sessions] = await Promise.all([
    select('v_attempt_summary', q => q.eq('student_id', state.profile.id).is('deleted_at', null).order('started_at', { ascending: false })),
    select('v_lesson_completion', q => q.eq('student_id', state.profile.id)),
    select('attempt_sections', q => q.eq('status', 'submitted'), 'attempt_id, section_type, submitted_at'),
    select('study_sessions', q => q.eq('student_id', state.profile.id).order('started_at').range(0, 9999),
      'id, attempt_id, lesson_id, started_at, last_heartbeat_at, ended_at, duration_seconds'),
  ]);
  const completed = new Set(completion.map(c => c.lesson_id));
  const inProgress = Object.fromEntries(summaries.filter(s => s.status === 'in_progress').map(s => [s.lesson_id, s]));
  const lastSubmitted = {};
  for (const s of summaries) if (s.status === 'submitted' && !lastSubmitted[s.lesson_id]) lastSubmitted[s.lesson_id] = s;
  return { summaries, completion, completed, inProgress, lastSubmitted, sections, sessions };
}

function lessonStatus(d, lessonId) {
  if (d.inProgress[lessonId]) return 'doing';
  if (d.completed.has(lessonId)) return 'done';
  return 'todo';
}
const STATUS_BADGE = { todo: badge('Chưa làm', 'neutral'), doing: badge('Đang làm', 'pending'), done: badge('Đã hoàn thành', 'ok') };

function lessonActions(d, l) {
  const st = lessonStatus(d, l.id);
  const res = d.lastSubmitted[l.id] ? `<a class="btn btn-secondary btn-sm" href="#/ket-qua/${d.lastSubmitted[l.id].attempt_id}">Xem kết quả</a>` : '';
  if (st === 'todo') return `<a class="btn btn-primary btn-sm" href="#/bai/${l.id}">Làm bài</a>`;
  if (st === 'doing') return `<a class="btn btn-primary btn-sm" href="#/bai/${l.id}">Tiếp tục làm</a>${res}`;
  return `${res}<button class="btn btn-ghost btn-sm" data-redo="${l.id}">Làm lại bài</button>`;
}

async function bindRedo(root) {
  root.addEventListener('click', async e => {
    const id = e.target.closest('[data-redo]')?.dataset.redo;
    if (!id) return;
    const ok = await modal({ title: 'Làm lại bài?', body: '<p>Hệ thống sẽ tạo một lượt làm mới với các ô nhập trống. Kết quả và lịch sử các lượt cũ vẫn được giữ nguyên.</p>', confirmText: 'Làm lại' });
    if (ok) location.hash = `#/bai/${id}`;
  });
}

async function withLoad(root, fn) {
  root.innerHTML = loadingHTML();
  try { await fn(); }
  catch (e) {
    root.innerHTML = errorHTML(errMsg(e));
    $('#retry', root)?.addEventListener('click', () => withLoad(root, fn));
  }
}

// ======================= TRANG CHỦ =======================
export function homePage(root) {
  withLoad(root, async () => {
    const [cur, d] = await Promise.all([curriculum(), loadMyData()]);
    const cards = cur.subjects.map(s => {
      const ls = cur.lessons.filter(l => l.subject_code === s.code);
      const done = ls.filter(l => d.completed.has(l.id)).length;
      return `<a class="card subject-card" href="#/mon/${s.code}">
        <h2>${esc(s.title)}</h2><p class="muted zh-mixed">${esc(s.description || '')}</p>
        <div class="row-between"><span>Tiến độ</span><strong>${done}/${ls.length} bài</strong></div>
        ${progressBar(done, ls.length, 'Tiến độ ' + s.title)}
        <span class="link-arrow">Xem 8 tuần →</span></a>`;
    }).join('');
    const total = d.completed.size;
    root.innerHTML = `<h1>Xin chào, ${esc(state.profile.full_name)}</h1>
      <p class="muted">Toàn khoá: ${total}/${TOTAL_LESSONS} bài đã hoàn thành.</p>
      ${progressBar(total, TOTAL_LESSONS, 'Tiến độ toàn khoá')}
      <div class="grid-2 mt-3">${cards}</div>`;
  });
}

// ======================= DANH SÁCH TUẦN =======================
export function subjectPage(root, { code }) {
  bindRedo(root);
  withLoad(root, async () => {
    const [cur, d] = await Promise.all([curriculum(), loadMyData()]);
    const subj = cur.subjectMap[code];
    if (!subj) { root.innerHTML = emptyHTML('Không tìm thấy môn học.'); return; }
    // Chỉ hiển thị bài của môn đang chọn
    const mine = cur.lessons.filter(l => l.subject_code === code);
    const totalDone = mine.filter(l => d.completed.has(l.id)).length;
    const weeks = [1, 2, 3, 4, 5, 6, 7, 8].map(w => {
      const ordered = mine.filter(l => l.week === w);
      const req = ordered.length;
      const done = ordered.filter(l => d.completed.has(l.id)).length;
      return `<section class="card week-card" aria-labelledby="w${w}">
        <div class="row-between"><h2 id="w${w}">Tuần ${w}</h2><strong>${done}/${req} bài</strong></div>
        ${progressBar(done, req, `Tiến độ tuần ${w}`)}
        <ul class="lesson-list">${ordered.map(l => `<li class="lesson-row">
          <div><span class="eyebrow">Bài ${l.lesson_order}</span>
            <div class="zh lesson-title">${esc(l.title)}</div> ${STATUS_BADGE[lessonStatus(d, l.id)]}</div>
          <div class="actions">${lessonActions(d, l)}</div></li>`).join('')}</ul></section>`;
    }).join('');
    root.innerHTML = `<nav class="crumbs"><a href="#/">Trang chủ</a> › ${esc(subj.title)}</nav>
      <h1>${esc(subj.title)}</h1>
      <p class="muted">${totalDone}/${mine.length} bài đã hoàn thành.</p>
      ${progressBar(totalDone, mine.length, 'Tiến độ ' + subj.title)}
      <div class="weeks">${weeks}</div>`;
  });
}

// ======================= LÀM BÀI =======================
export function lessonPage(root, { id }) {
  let cleanup = () => {};
  const ctl = { alive: true };
  withLoad(root, async () => {
    const cur = await curriculum();
    const lesson = cur.lessonMap[id];
    if (!lesson) { root.innerHTML = emptyHTML('Không tìm thấy bài học.'); return; }
    const attempt = await rpc('start_or_resume_attempt', { p_lesson: id });
    if (!ctl.alive) return;
    cleanup = runAttempt(root, cur, lesson, attempt, ctl);
  });
  return () => { ctl.alive = false; cleanup(); };
}

function runAttempt(root, cur, lesson, attempt, ctl) {
  const sections = cur.byLesson[lesson.id];
  const subj = cur.subjectMap[lesson.subject_code];
  let detail = null, current = 1, viewing = 1;
  const answers = {};           // qid -> [..] bản nháp trong trình duyệt (luôn đồng bộ lên máy chủ)
  const dirty = new Set();
  let saving = false, saveTimer = null, lastSaveError = null, submitting = false;

  // ---------- Thời gian học: phiên + heartbeat ----------
  let sessionId = null, sessionStartLocal = 0, hbTimer = null, tickTimer = null, baseSeconds = 0, starting = false;
  const visible = () => document.visibilityState === 'visible';
  async function startSession() {
    if (sessionId || starting || !visible() || detail?.attempt.status !== 'in_progress') return;
    starting = true;
    try { sessionId = await rpc('session_start', { p_attempt: attempt.id }); sessionStartLocal = Date.now(); }
    catch (e) { setTimeStatus('Không bắt đầu được phiên tính giờ: ' + errMsg(e)); }
    finally { starting = false; }
  }
  function endSession(reason, keepalive = false) {
    if (!sessionId) return;
    const sid = sessionId; sessionId = null;
    baseSeconds += Math.floor((Date.now() - sessionStartLocal) / 1000);
    if (keepalive) rpcKeepalive('session_end', { p_session: sid, p_reason: reason });
    else rpc('session_end', { p_session: sid, p_reason: reason }).catch(() => {});
  }
  async function heartbeat() {
    if (!sessionId || !visible()) return;
    try {
      const r = await rpc('session_heartbeat', { p_session: sessionId });
      if (r !== 'ok') { baseSeconds += Math.floor((Date.now() - sessionStartLocal) / 1000); sessionId = null; if (r === 'expired') await startSession(); }
    } catch { /* mất mạng: không cộng thời gian; máy chủ chốt phiên theo tín hiệu cuối */ }
  }
  const onVis = () => {
    if (visible()) startSession(); else { endSession('hidden', true); flushSave(); }
  };
  const onHide = () => { endSession('pagehide', true); flushSave(true); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', onHide);
  hbTimer = setInterval(heartbeat, 15000);
  tickTimer = setInterval(() => {
    const el = $('#timer', root); if (!el) return;
    const live = sessionId ? Math.floor((Date.now() - sessionStartLocal) / 1000) : 0;
    el.textContent = hms(baseSeconds + live) + (sessionId ? '' : ' (tạm dừng)');
  }, 1000);
  const setTimeStatus = t => { const el = $('#time-note', root); if (el) el.textContent = t; };

  // ---------- Tự động lưu ----------
  function setSaveStatus(kind, text) {
    const el = $('#save-status', root); if (!el) return;
    el.className = `save-status save-${kind}`;
    el.innerHTML = esc(text) + (kind === 'error' ? ' <button class="btn btn-sm btn-secondary" id="save-retry">Thử lại</button>' : '');
  }
  async function flushSave(keepalive = false) {
    clearTimeout(saveTimer);
    if (!dirty.size) return true;
    if (saving && !keepalive) { saveTimer = setTimeout(flushSave, 400); return false; }
    const payload = {}; for (const q of dirty) payload[q] = answers[q];
    if (keepalive) { rpcKeepalive('save_answers', { p_attempt: attempt.id, p_answers: payload }); return true; }
    const sent = [...dirty]; dirty.clear();
    saving = true; setSaveStatus('saving', 'Đang lưu…');
    try {
      const r = await rpc('save_answers', { p_attempt: attempt.id, p_answers: payload });
      lastSaveError = null;
      if (!dirty.size) setSaveStatus('ok', `Đã lưu lúc ${fmtTime(r.saved_at)}`);
      return true;
    } catch (e) {
      sent.forEach(q => dirty.add(q)); lastSaveError = e;
      setSaveStatus('error', 'Chưa lưu được: ' + errMsg(e));
      return false;
    } finally { saving = false; }
  }
  const scheduleSave = () => { clearTimeout(saveTimer); setSaveStatus('pending', 'Có thay đổi chưa lưu…'); saveTimer = setTimeout(flushSave, 800); };

  function onInput(e) {
    const el = e.target.closest('[data-q]'); if (!el || el.disabled) return;
    if (e.isComposing) return;                  // IME đang ghép chữ: chờ compositionend
    const q = el.dataset.q, b = Number(el.dataset.b);
    const sec = sections.find(s => s.section_type === viewing);
    const qq = (cur.bySection[sec.id] || []).find(x => x.id === q);
    const arr = answers[q] ? [...answers[q]] : Array(qq.blank_count).fill('');
    arr[b] = el.value;                          // giữ nguyên văn, không tự sửa nội dung đang nhập
    answers[q] = arr; dirty.add(q); scheduleSave(); updateCount();
  }
  root.addEventListener('input', onInput);
  root.addEventListener('compositionend', onInput);
  root.addEventListener('click', e => { if (e.target.id === 'save-retry') flushSave(); });

  function countAnswered(type) {
    const sec = sections.find(s => s.section_type === type);
    const qs = cur.bySection[sec.id] || [];
    const n = qs.filter(q => (answers[q.id] || []).some(v => (v || '').trim())).length;
    return { n, total: qs.length };
  }
  function updateCount() {
    const el = $('#answered', root); if (!el) return;
    const { n, total } = countAnswered(viewing); el.textContent = `Đã trả lời ${n}/${total} câu`;
  }

  // ---------- Hiển thị ----------
  function draw() {
    const secStates = Object.fromEntries(detail.sections.map(s => [s.section_type, s]));
    current = [1, 2, 3, 4].find(t => secStates[t].status !== 'submitted') || 4;
    const sec = sections.find(s => s.section_type === viewing);
    const qs = cur.bySection[sec.id] || [];
    const sd = secStates[viewing];
    const done = sd.status === 'submitted';
    const stepper = [1, 2, 3, 4].map(t => {
      const st = secStates[t].status === 'submitted' ? 'done' : t === current ? 'current' : 'locked';
      const lbl = st === 'done' ? 'Đã nộp' : st === 'current' ? 'Đang làm' : 'Chưa mở';
      return `<li><button class="step step-${st} ${t === viewing ? 'is-view' : ''}" data-step="${t}" ${st === 'locked' ? 'disabled' : ''}
        aria-current="${t === viewing ? 'step' : 'false'}"><span class="step-n">${t}</span><span class="step-t">${TYPE_SHORT[t]}<small>${lbl}</small></span></button></li>`;
    }).join('');
    let body;
    if (done) {
      const responses = Object.fromEntries(sd.responses.map(r => [r.question_id, r]));
      body = `<div class="result-sec-score">${sectionScoreLine(sd)}</div>
        ${renderSection(sec, qs, 'result', { responses, keys: sd.keys || {} })}
        <div class="actions-bar">${viewing < 4 && current >= viewing + 1 && detail.attempt.status === 'in_progress'
          ? `<button class="btn btn-primary" data-step="${current}">Tiếp tục ${TYPE_SHORT[current]} →</button>` : ''}</div>`;
    } else {
      body = `${renderSection(sec, qs, 'do', { answers })}
        <div class="actions-bar"><span id="answered" class="muted"></span>
          <button class="btn btn-primary" id="submit-sec">Nộp ${TYPE_NAMES[viewing].split(' — ')[0].toLowerCase()}</button></div>`;
    }
    root.innerHTML = `<nav class="crumbs"><a href="#/">Trang chủ</a> › <a href="#/mon/${subj.code}">${esc(subj.title)}</a> › Tuần ${lesson.week}</nav>
      <div class="lesson-top card">
        <div><p class="eyebrow">${esc(subj.title)} · Tuần ${lesson.week} · Bài ${lesson.lesson_order} · Lượt #${detail.attempt.attempt_no}</p>
          <h1 class="zh h2">${esc(lesson.title)}</h1></div>
        <div class="lesson-status">
          <div><span class="lbl">Thời gian lượt này</span> <strong id="timer">${hms(baseSeconds)}</strong></div>
          <div id="save-status" class="save-status save-ok" aria-live="polite">Câu trả lời được tự động lưu</div>
          <div id="time-note" class="muted small">Đồng hồ dừng khi bạn chuyển sang tab khác.</div>
        </div></div>
      <ol class="stepper" aria-label="Các dạng bài">${stepper}</ol>
      <section class="card exercise" aria-live="off">${body}</section>`;
    updateCount();
  }

  root.addEventListener('click', async e => {
    const step = e.target.closest('[data-step]')?.dataset.step;
    if (step) { await flushSave(); viewing = Number(step); draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (e.target.id === 'submit-sec') submit();
  });

  async function submit() {
    if (submitting) return;
    const { n, total } = countAnswered(viewing);
    const ok = await modal({
      title: `Nộp ${TYPE_NAMES[viewing]}?`,
      body: `<p>Bạn đã trả lời <strong>${n}/${total}</strong> câu.${n < total ? ' Các câu bỏ trống sẽ được tính là chưa trả lời.' : ''}</p><p>Sau khi nộp, bạn không thể sửa câu trả lời của dạng này trong lượt hiện tại.</p>`,
      confirmText: 'Nộp bài'
    });
    if (!ok) return;
    submitting = true;
    const btn = $('#submit-sec', root); if (btn) { btn.disabled = true; btn.textContent = 'Đang nộp…'; }
    const sec = sections.find(s => s.section_type === viewing);
    const payload = {};
    for (const q of cur.bySection[sec.id] || []) if (answers[q.id]) payload[q.id] = answers[q.id];
    try {
      clearTimeout(saveTimer);
      detail = await rpc('submit_section', { p_attempt: attempt.id, p_type: viewing, p_answers: payload });
      for (const q of Object.keys(payload)) dirty.delete(q);
      if (detail.attempt.status === 'submitted') {
        endSession('submitted');
        toast('Đã nộp đủ 4 dạng. Đang mở trang kết quả…', 'ok');
        location.hash = `#/ket-qua/${attempt.id}`;
        return;
      }
      toast('Đã nộp và chấm xong.', 'ok');
      draw();
    } catch (e) {
      // Không khoá câu trả lời khi nộp chưa thành công
      toast('Nộp chưa thành công: ' + errMsg(e), 'error', 7000);
      if (btn) { btn.disabled = false; btn.textContent = 'Thử nộp lại'; }
    } finally { submitting = false; }
  }

  // ---------- Khởi động: khôi phục câu trả lời đã lưu trên máy chủ ----------
  (async () => {
    try {
      detail = await rpc('get_attempt_detail', { p_attempt: attempt.id });
      if (!ctl.alive) return;
      for (const s of detail.sections) for (const r of s.responses) answers[r.question_id] = r.answer;
      baseSeconds = detail.summary?.time_seconds || 0;
      viewing = [1, 2, 3, 4].find(t => detail.sections.find(s => s.section_type === t).status !== 'submitted') || 4;
      draw();
      await startSession();
    } catch (e) {
      root.innerHTML = errorHTML(errMsg(e));
      $('#retry', root)?.addEventListener('click', () => location.reload());
    }
  })();

  return () => {
    flushSave(true); endSession('leave', true);
    clearInterval(hbTimer); clearInterval(tickTimer); clearTimeout(saveTimer);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('pagehide', onHide);
  };
}

// ======================= KẾT QUẢ =======================
export function resultPage(root, { id }) {
  const load = () => withLoad(root, async () => {
    const [cur, detail] = await Promise.all([curriculum(), rpc('get_attempt_detail', { p_attempt: id })]);
    const lesson = cur.lessonMap[detail.attempt.lesson_id];
    root.innerHTML = `<nav class="crumbs"><a href="#/">Trang chủ</a> › <a href="#/lich-su">Lịch sử học tập</a> › Kết quả</nav>
      ${renderAttemptResult(detail, cur, { durText })}
      <div class="actions-bar">
        <a class="btn btn-secondary" href="#/mon/${lesson.subject_code}">Về danh sách tuần</a>
        ${detail.attempt.status === 'submitted' ? `<button class="btn btn-primary" id="redo">Làm lại bài</button>` : `<a class="btn btn-primary" href="#/bai/${lesson.id}">Tiếp tục làm</a>`}
      </div>`;
    $('#redo', root)?.addEventListener('click', async () => {
      const ok = await modal({ title: 'Làm lại bài?', body: '<p>Một lượt mới sẽ được tạo với các ô nhập trống. Lượt này vẫn được giữ trong lịch sử.</p>', confirmText: 'Làm lại' });
      if (ok) location.hash = `#/bai/${lesson.id}`;
    });
  });
  load();
}

// ======================= LỊCH SỬ HỌC TẬP =======================
export function historyPage(root) {
  let month = hashParams().thang || todayKey().slice(0, 7);
  let selectedDay = null;
  let D = null, cur = null;
  const filters = { mon: '', tuan: '', tt: '', tu: '', den: '', sx: 'moi', ...hashParams() };

  function dayStats() {
    const days = {};
    const add = k => (days[k] ||= { seconds: 0, completed: 0, lessons: new Set(), active: false });
    for (const s of D.sessions) { const d = add(vnDayKey(s.started_at)); d.seconds += s.duration_seconds || 0; d.lessons.add(s.lesson_id); }
    for (const s of D.sections) { const d = add(vnDayKey(s.submitted_at)); d.active = true; }
    for (const a of D.summaries) if (a.status === 'submitted' && a.submitted_at) { const d = add(vnDayKey(a.submitted_at)); d.completed++; d.lessons.add(a.lesson_id); }
    return days;
  }
  function streak(days) {
    let k = todayKey(); if (!days[k]?.active) k = addDays(k, -1);
    let n = 0; while (days[k]?.active) { n++; k = addDays(k, -1); }
    return n;
  }

  function draw() {
    const days = dayStats();
    const totalSec = D.sessions.reduce((a, s) => a + (s.duration_seconds || 0), 0);
    const mon = mondayOf(todayKey()), sun = addDays(mon, 6);
    const weekSec = D.sessions.filter(s => { const k = vnDayKey(s.started_at); return k >= mon && k <= sun; }).reduce((a, s) => a + (s.duration_seconds || 0), 0);
    const doneAttempts = D.summaries.filter(s => s.status === 'submitted').length;

    // Lịch tháng
    const [y, m] = month.split('-').map(Number);
    const first = `${month}-01`, nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7;
    const today = todayKey();
    let cells = Array(lead).fill('<div class="cal-cell empty" aria-hidden="true"></div>').join('');
    for (let i = 1; i <= nDays; i++) {
      const k = `${month}-${String(i).padStart(2, '0')}`, d = days[k];
      const fut = k > today;
      cells += `<button class="cal-cell ${d?.active ? 'studied' : ''} ${k === today ? 'today' : ''} ${k === selectedDay ? 'sel' : ''}" data-day="${k}" ${fut ? 'disabled' : ''}
        aria-label="Ngày ${i}${d?.active ? ', có học' : ''}${k === today ? ', hôm nay' : ''}">
        <span>${i}</span>${d?.active ? '<svg class="flame" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3.5-1.5 5-1.5 7.5A2.5 2.5 0 0 0 13 12c1.5 0 2.5-1.2 2.3-3C17.6 10.5 19 13 19 15a7 7 0 1 1-14 0c0-4 4-6.5 7-13z"/></svg>' : ''}</button>`;
    }
    const sel = selectedDay && days[selectedDay];
    const dayInfo = selectedDay ? (sel ? `<div class="day-info card-inner"><strong>${fmtDate(selectedDay + 'T12:00:00+07:00')}</strong>
        <p>Thời gian học: ${durText(sel.seconds)} · Lượt hoàn thành: ${sel.completed}</p>
        <ul>${[...sel.lessons].map(l => `<li><span class="zh">${esc(cur.lessonMap[l].title)}</span> <span class="muted">(${esc(cur.subjectMap[cur.lessonMap[l].subject_code].title)})</span></li>`).join('')}</ul></div>`
      : `<div class="day-info card-inner muted">Không có hoạt động học vào ngày ${fmtDate(selectedDay + 'T12:00:00+07:00')}.</div>`) : '';

    const chartData = []; for (let i = 1; i <= nDays; i++) { const k = `${month}-${String(i).padStart(2, '0')}`; chartData.push({ label: String(i), value: Math.round((days[k]?.seconds || 0) / 60 * 10) / 10, tip: `${fmtDate(k + 'T12:00:00+07:00')}: ${durText(days[k]?.seconds || 0)}` }); }

    // Danh sách lượt
    let list = D.summaries.filter(a =>
      (!filters.mon || a.subject_code === filters.mon) && (!filters.tuan || a.week === Number(filters.tuan)) &&
      (!filters.tt || (filters.tt === 'dang' && a.status === 'in_progress') || (filters.tt === 'xong' && a.score_final)) &&
      (!filters.tu || vnDayKey(a.submitted_at || a.started_at) >= filters.tu) && (!filters.den || vnDayKey(a.submitted_at || a.started_at) <= filters.den));
    const sorters = {
      moi: (a, b) => (b.submitted_at || b.started_at).localeCompare(a.submitted_at || a.started_at),
      cu: (a, b) => (a.submitted_at || a.started_at).localeCompare(b.submitted_at || b.started_at),
      diemcao: (a, b) => (b.score_final ? b.score_so_far : -1) - (a.score_final ? a.score_so_far : -1),
      diemthap: (a, b) => (a.score_final ? a.score_so_far : 99) - (b.score_final ? b.score_so_far : 99),
      tgtang: (a, b) => a.time_seconds - b.time_seconds, tggiam: (a, b) => b.time_seconds - a.time_seconds,
    };
    list.sort(sorters[filters.sx] || sorters.moi);
    const rows = list.map(a => `<tr>
      <td data-label="Môn">${esc(cur.subjectMap[a.subject_code].title)}</td>
      <td data-label="Tuần · Bài">Tuần ${a.week} · Bài ${a.lesson_order}<div class="zh small">${esc(a.lesson_title)}</div></td>
      <td data-label="Lượt">#${a.attempt_no}</td>
      <td data-label="Hoàn thành">${a.status === 'submitted' ? fmtDateTime(a.submitted_at) : badge('Đang làm', 'neutral')}</td>
      <td data-label="Thời gian">${hms(a.time_seconds)}</td>
      <td data-label="Điểm">${a.status !== 'submitted' ? '—' : `<strong>${score(a.score_so_far)}</strong>/10`}</td>
      <td data-label="">${a.status === 'submitted' ? `<a class="btn btn-sm btn-secondary" href="#/ket-qua/${a.attempt_id}">Xem kết quả</a>` : `<a class="btn btn-sm btn-primary" href="#/bai/${a.lesson_id}">Tiếp tục</a>`}</td></tr>`).join('');

    root.innerHTML = `<h1>Lịch sử học tập</h1>
      <div class="stats-4">
        <div class="stat card"><span class="lbl">Lượt làm bài hoàn thành</span><strong>${doneAttempts}</strong></div>
        <div class="stat card"><span class="lbl">Bài hoàn thành</span><strong>${D.completed.size}/${TOTAL_LESSONS}</strong></div>
        <div class="stat card"><span class="lbl">Thời gian học tuần này</span><strong>${hms(weekSec)}</strong><span class="small muted">${fmtDate(mon + 'T12:00:00+07:00')} – ${fmtDate(sun + 'T12:00:00+07:00')}</span></div>
        <div class="stat card"><span class="lbl">Thời gian tích luỹ toàn khoá</span><strong>${hms(totalSec)}</strong></div>
      </div>
      <div class="grid-2 mt-3">
        <section class="card"><div class="row-between"><h2 class="h3">Chuỗi ngày học: ${streak(days)} ngày</h2>
          <div class="month-nav"><button class="btn btn-ghost btn-sm" data-month="-1" aria-label="Tháng trước">‹</button>
          <strong>Tháng ${m}/${y}</strong><button class="btn btn-ghost btn-sm" data-month="1" aria-label="Tháng sau">›</button></div></div>
          <div class="cal-head"><span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span><span>CN</span></div>
          <div class="cal">${cells}</div>
          <p class="small muted">Ngày có biểu tượng ngọn lửa: có ít nhất một dạng bài được nộp thành công (giờ Việt Nam).</p>
          ${dayInfo}</section>
        <section class="card"><h2 class="h3">Thời gian học theo ngày (phút) — tháng ${m}/${y}</h2>
          ${barChart(chartData, { yFormat: v => Math.round(v) + "'", ariaLabel: 'Thời gian học theo ngày', emptyText: 'Chưa có thời gian học trong tháng này.' })}</section>
      </div>
      <section class="card mt-3"><h2 class="h3">Các lượt làm bài</h2>
        <form class="filters" id="flt">
          <label>Môn <select name="mon"><option value="">Tất cả</option>${cur.subjects.map(s => `<option value="${s.code}" ${filters.mon === s.code ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select></label>
          <label>Tuần <select name="tuan"><option value="">Tất cả</option>${[1, 2, 3, 4, 5, 6, 7, 8].map(w => `<option ${String(w) === filters.tuan ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
          <label>Trạng thái <select name="tt"><option value="">Tất cả</option><option value="xong" ${filters.tt === 'xong' ? 'selected' : ''}>Đã hoàn thành</option><option value="dang" ${filters.tt === 'dang' ? 'selected' : ''}>Đang làm</option></select></label>
          <label>Từ ngày <input type="date" name="tu" value="${esc(filters.tu)}"></label>
          <label>Đến ngày <input type="date" name="den" value="${esc(filters.den)}"></label>
          <label>Sắp xếp <select name="sx">${[['moi', 'Mới nhất'], ['cu', 'Cũ nhất'], ['diemcao', 'Điểm cao → thấp'], ['diemthap', 'Điểm thấp → cao'], ['tgtang', 'Thời gian tăng'], ['tggiam', 'Thời gian giảm']].map(([v, t]) => `<option value="${v}" ${filters.sx === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        </form>
        ${list.length ? `<div class="table-wrap"><table class="table responsive"><thead><tr><th>Môn</th><th>Tuần · Bài</th><th>Lượt</th><th>Hoàn thành</th><th>Thời gian</th><th>Điểm</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
          : emptyHTML(D.summaries.length ? 'Không có lượt làm nào khớp bộ lọc.' : 'Bạn chưa có lượt làm bài nào.')}
      </section>`;
    bindCharts(root);
  }

  root.addEventListener('click', e => {
    const mv = e.target.closest('[data-month]')?.dataset.month;
    if (mv) { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + Number(mv), 1)); month = d.toISOString().slice(0, 7); selectedDay = null; setHashParams({ ...filters, thang: month }); draw(); }
    const day = e.target.closest('[data-day]')?.dataset.day;
    if (day) { selectedDay = day; draw(); }
  });
  root.addEventListener('change', e => {
    if (!e.target.closest('#flt')) return;
    filters[e.target.name] = e.target.value; setHashParams({ ...filters, thang: month }); draw();
  });
  withLoad(root, async () => { [cur, D] = await Promise.all([curriculum(), loadMyData()]); draw(); });
}

// ======================= TÀI KHOẢN =======================
export function accountPage(root) {
  const p = state.profile;
  root.innerHTML = `<h1>Tài khoản</h1>
    <section class="card"><dl class="meta">
      <div><dt>Họ tên</dt><dd>${esc(p.full_name)}</dd></div>
      <div><dt>Mã học sinh</dt><dd>${esc(p.student_code || '—')}</dd></div>
      <div><dt>Mã đăng nhập</dt><dd>${esc(p.login_code)}</dd></div>
      <div><dt>Lớp</dt><dd>${esc(p.class_name || '—')}</dd></div></dl></section>
    <p class="small muted mt-2">Cần đổi mật khẩu? Vui lòng liên hệ giáo viên.</p>`;
}

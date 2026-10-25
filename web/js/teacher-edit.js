// "Chỉnh sửa toàn bộ dữ liệu" của một học sinh. Mọi thay đổi đi qua admin_edit() phía máy chủ:
// kiểm tra quyền, kiểm tra ràng buộc, ghi nhật ký giá trị trước/sau, tính lại các trường phụ thuộc.
import { rpc, select, curriculum, errMsg } from './api.js';
import { esc, $, $$, toast, modal, fmtDateTime, hms, score, TYPE_NAMES, loadingHTML, emptyHTML, errorHTML, badge, hashParams, setHashParams } from './util.js';
import { resetPassword } from './teacher.js';

// ---- chuyển đổi thời gian ISO <-> ô datetime-local theo giờ Việt Nam ----
function toLocalInput(iso) {
  if (!iso) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}
const fromLocalInput = v => v ? new Date(v.length === 16 ? v + ':00+07:00' : v + '+07:00').toISOString() : null;

function display(f, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (f.type === 'datetime') return fmtDateTime(v);
  if (f.type === 'deleted') return v ? 'Đã xoá (' + fmtDateTime(v) + ')' : 'Không';
  if (f.type === 'select') return (f.options.find(o => String(o[0]) === String(v)) || [v, v])[1];
  if (f.type === 'bool3') return v === true ? 'Đúng' : v === false ? 'Sai' : 'Tự động';
  if (f.type === 'answer') return v.map(x => x || '(trống)').join(' | ');
  return String(v);
}

function inputFor(f, v, name) {
  const id = name;
  if (f.type === 'textarea') return `<textarea id="${id}" name="${f.k}" rows="2">${esc(v ?? '')}</textarea>`;
  if (f.type === 'number') return `<input id="${id}" name="${f.k}" type="number" step="${f.step || 1}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} value="${v ?? ''}" inputmode="decimal">`;
  if (f.type === 'datetime') return `<input id="${id}" name="${f.k}" type="datetime-local" step="1" value="${toLocalInput(v)}">`;
  if (f.type === 'select') return `<select id="${id}" name="${f.k}">${f.options.map(([val, t]) => `<option value="${esc(val)}" ${String(val) === String(v ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  if (f.type === 'bool3') return `<select id="${id}" name="${f.k}"><option value="" ${v == null ? 'selected' : ''}>Tự động (theo máy chấm)</option><option value="true" ${v === true ? 'selected' : ''}>Đúng</option><option value="false" ${v === false ? 'selected' : ''}>Sai</option></select>`;
  if (f.type === 'deleted') return `<label class="check"><input id="${id}" type="checkbox" name="${f.k}" ${v ? 'checked' : ''}> Xoá mềm (có thể khôi phục)</label>`;
  if (f.type === 'answer') return `<div class="answer-inputs">${(v || []).map((x, i) => `<input class="zh" name="${f.k}" data-i="${i}" value="${esc(x)}" aria-label="Ô ${i + 1}">`).join('')}</div>`;
  return `<input id="${id}" name="${f.k}" value="${esc(v ?? '')}">`;
}

function readValue(form, f, orig) {
  const els = $$(`[name="${f.k}"]`, form);
  const el = els[0];
  if (f.type === 'deleted') return el.checked ? (orig || new Date().toISOString()) : null;
  if (f.type === 'answer') return els.map(e => e.value);
  const v = el.value;
  if (f.type === 'number') return v === '' ? null : Number(v);
  if (f.type === 'datetime') return fromLocalInput(v);
  if (f.type === 'bool3') return v === '' ? null : v === 'true';
  if (f.type === 'select' && f.num) return v === '' ? null : Number(v);
  return v === '' && f.nullable !== false ? null : v;
}

const same = (a, b, f) => f.type === 'datetime' ? (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null)
  : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Một biểu mẫu sửa bản ghi: hiển thị giá trị hiện tại và giá trị đang sửa */
function recordForm(table, rec, fields, title) {
  return `<form class="rec-form card-inner" data-table="${table}" data-id="${rec.id}">
    ${title ? `<div class="rec-title">${title}</div>` : ''}
    <div class="edit-grid">${fields.map((f, i) => `<div class="edit-field" data-k="${f.k}">
      <label for="${table}-${rec.id}-${i}">${esc(f.label)}</label>
      ${inputFor(f, rec[f.k], `${table}-${rec.id}-${i}`)}
      <span class="current small muted">Hiện tại: ${esc(display(f, rec[f.k]))}</span></div>`).join('')}</div>
    <div class="rec-actions"><span class="rec-msg small" role="status"></span>
      <button type="button" class="btn btn-sm btn-ghost" data-cancel>Hủy</button>
      <button class="btn btn-sm btn-primary">Lưu thay đổi</button></div></form>`;
}

export function editPage(root, { id }) {
  const registry = new Map();   // form key -> {table, rec, fields}
  let tab = hashParams().muc || 'taikhoan';
  let attemptSel = hashParams().luot || '';
  let cur, prof, attempts, sections, responses, sessions, logins, summaries;

  const ATT_STATUS = [['in_progress', 'Đang làm'], ['submitted', 'Đã nộp đủ 4 dạng']];
  const F = {
    profiles: [
      { k: 'student_code', label: 'Mã học sinh' }, { k: 'full_name', label: 'Họ tên', nullable: false },
      { k: 'class_name', label: 'Lớp' }, { k: 'login_code', label: 'Tên đăng nhập (mã đăng nhập)', nullable: false },
      { k: 'status', label: 'Trạng thái tài khoản', type: 'select', options: [['active', 'Hoạt động'], ['locked', 'Khoá']] },
      { k: 'notes', label: 'Ghi chú', type: 'textarea' },
      { k: 'last_login_at', label: 'Lần đăng nhập gần nhất', type: 'datetime' },
      { k: 'login_count', label: 'Tổng lượt đăng nhập', type: 'number', min: 0 },
      { k: 'deleted_at', label: 'Xoá học sinh', type: 'deleted' }],
    attempts: [
      { k: 'attempt_no', label: 'Số thứ tự lượt', type: 'number', min: 1 },
      { k: 'status', label: 'Trạng thái lượt / hoàn thành', type: 'select', options: ATT_STATUS },
      { k: 'started_at', label: 'Bắt đầu', type: 'datetime' }, { k: 'submitted_at', label: 'Thời điểm nộp', type: 'datetime' },
      { k: 'deleted_at', label: 'Xoá lượt', type: 'deleted' }],
    attempt_sections: [
      { k: 'status', label: 'Trạng thái dạng', type: 'select', options: [['in_progress', 'Chưa nộp'], ['submitted', 'Đã nộp']] },
      { k: 'submitted_at', label: 'Thời điểm nộp', type: 'datetime' },
      { k: 'grading_status', label: 'Trạng thái chấm', type: 'select', options: [['not_submitted', 'Chưa nộp'], ['auto', 'Chấm tự động'], ['not_graded', 'Không chấm (dạng 4)']] },
      { k: 'score_override', label: 'Điểm điều chỉnh thủ công (ghi đè, ≤ điểm tối đa của dạng)', type: 'number', step: 0.05, min: 0, max: 4 },
      { k: 'teacher_comment', label: 'Nhận xét', type: 'textarea' }],
    responses: [
      { k: 'answer', label: 'Câu trả lời', type: 'answer' },
      { k: 'correct_override', label: 'Đúng / sai', type: 'bool3' },
      { k: 'points_override', label: 'Điểm câu (ghi đè)', type: 'number', step: 0.01, min: 0, max: 4 }],
    study_sessions: [
      { k: 'started_at', label: 'Bắt đầu phiên', type: 'datetime' }, { k: 'last_heartbeat_at', label: 'Tín hiệu hợp lệ cuối', type: 'datetime' },
      { k: 'ended_at', label: 'Kết thúc phiên', type: 'datetime' }, { k: 'end_reason', label: 'Lý do kết thúc' },
      { k: 'deleted_at', label: 'Xoá phiên', type: 'deleted' }],
    login_events: [
      { k: 'logged_in_at', label: 'Đăng nhập', type: 'datetime' }, { k: 'logged_out_at', label: 'Đăng xuất', type: 'datetime' },
      { k: 'deleted_at', label: 'Xoá bản ghi', type: 'deleted' }],
  };

  const form = (table, rec, title, fields = F[table]) => { registry.set(`${table}:${rec.id}`, { table, rec, fields }); return recordForm(table, rec, fields, title); };
  const lessonName = lid => { const l = cur.lessonMap[lid]; return `${cur.subjectMap[l.subject_code].title} · Tuần ${l.week} · Bài ${l.lesson_order} — <span class="zh">${esc(l.title)}</span>`; };

  async function loadAll() {
    cur = await curriculum();
    [prof, attempts, summaries, sessions, logins] = await Promise.all([
      select('profiles', q => q.eq('id', id)),
      select('attempts', q => q.eq('student_id', id).order('started_at', { ascending: false })),
      select('v_attempt_summary', q => q.eq('student_id', id)),
      select('study_sessions', q => q.eq('student_id', id).order('started_at', { ascending: false }).range(0, 9999)),
      select('login_events', q => q.eq('user_id', id).order('logged_in_at', { ascending: false }).limit(200)),
    ]);
    prof = prof[0];
    const ids = attempts.map(a => a.id);
    sections = ids.length ? await select('v_section_scores', q => q.in('attempt_id', ids).order('section_type')) : [];
    if (!attemptSel && attempts[0]) attemptSel = attempts[0].id;
    responses = attemptSel ? await select('responses', q => q.eq('attempt_id', attemptSel)) : [];
  }

  function attemptPicker() {
    return `<label class="lbl" for="pick-att">Chọn lượt làm</label><select id="pick-att" class="w-full">${attempts.map(a => `<option value="${a.id}" ${a.id === attemptSel ? 'selected' : ''}>${cur.subjectMap[cur.lessonMap[a.lesson_id].subject_code].title} · T${cur.lessonMap[a.lesson_id].week} · B${cur.lessonMap[a.lesson_id].lesson_order} — lượt #${a.attempt_no}${a.deleted_at ? ' (đã xoá)' : ''}</option>`).join('')}</select>`;
  }

  function draw() {
    registry.clear();
    const tabs = [['taikhoan', 'Tài khoản'], ['luot', 'Lượt làm & tiến độ'], ['diem', 'Điểm số & dạng bài'], ['traloi', 'Câu trả lời'], ['thoigian', 'Thời gian học'], ['dangnhap', 'Lịch sử đăng nhập'], ['thongke', 'Thống kê']];
    let body = '';
    if (tab === 'taikhoan') {
      body = `${form('profiles', prof, 'Thông tin tài khoản')}
        <div class="card-inner mt-2"><strong>Mật khẩu</strong><p class="small muted">Không hiển thị và không lưu mật khẩu dạng văn bản. Dùng chức năng đặt lại an toàn.</p>
        <button class="btn btn-secondary btn-sm" id="pw">Đặt lại mật khẩu</button></div>`;
    } else if (tab === 'luot') {
      body = `<p class="small muted">Một bài được tính hoàn thành khi có ít nhất một lượt “Đã nộp đủ 4 dạng” chưa bị xoá. Trạng thái bài, tuần và tiến độ được tính lại tự động từ các lượt này.</p>` +
        (attempts.length ? attempts.map(a => form('attempts', a, `${lessonName(a.lesson_id)} · lượt #${a.attempt_no} ${a.deleted_at ? badge('Đã xoá', 'bad') : ''}`)).join('') : emptyHTML('Chưa có lượt làm.'));
    } else if (tab === 'diem') {
      body = attempts.length ? attemptPicker() + `<p class="small muted mt-2">Điểm dạng 1–3 do máy chủ tính từ câu trả lời. Quy tắc 3-3-4: Dạng 1 tối đa 3, Dạng 2 tối đa 3, Dạng 3 tối đa 4; Dạng 4 không chấm điểm. “Điểm điều chỉnh thủ công” ghi đè điểm tự động và được đánh dấu riêng. Tổng điểm (tối đa 10) tự tính lại.</p>` +
        sections.filter(s => s.attempt_id === attemptSel).map(s => form('attempt_sections', s,
          `${TYPE_NAMES[s.section_type]} · điểm hiện hành: <strong>${s.effective_score == null ? (s.section_type === 4 ? 'Không chấm điểm' : '—') : score(s.effective_score)}</strong>${s.section_type < 4 ? ` · tự động: ${score(s.auto_score)} · ${s.correct_count ?? 0} đúng / ${s.wrong_count ?? 0} sai` : ''}${s.is_overridden ? ' ' + badge('Đang ghi đè thủ công', 'info') : ''}`, s.section_type === 4 ? F.attempt_sections.filter(f => ['status', 'submitted_at', 'teacher_comment'].includes(f.k)) : F.attempt_sections)).join('')
        : emptyHTML('Chưa có lượt làm.');
    } else if (tab === 'traloi') {
      if (!attempts.length) body = emptyHTML('Chưa có lượt làm.');
      else {
        const att = attempts.find(a => a.id === attemptSel);
        const byQ = Object.fromEntries(responses.map(r => [r.question_id, r]));
        body = attemptPicker() + `<p class="small muted mt-2">Sửa câu trả lời sẽ tự chấm lại câu đó (dạng 1–3). “Đúng / sai” và “Điểm câu” cho phép giáo viên ghi đè kết quả máy chấm.</p>` +
          cur.byLesson[att.lesson_id].map(sec => `<h3 class="h3 mt-3">${TYPE_NAMES[sec.section_type]}</h3>` + (cur.bySection[sec.id] || []).map(q => {
            const r = byQ[q.id];
            const label = q.prompt.label || `${q.prompt.no}.`;
            const ctx = q.prompt.words ? q.prompt.words.join(' / ') : q.prompt.word ? 'Từ: ' + q.prompt.word : q.prompt.lines ? q.prompt.lines.map(l => l.map(sg => sg.t ?? '___').join('')).join(' ') : '';
            if (!r) return `<div class="card-inner small muted">${esc(label)} <span class="zh">${esc(ctx)}</span> — chưa có câu trả lời được lưu.</div>`;
            const fields = sec.section_type === 4 ? F.responses.slice(0, 1) : F.responses;
            return form('responses', r, `${esc(label)} <span class="zh small">${esc(ctx)}</span> ${r.is_correct === true ? badge('Máy chấm: đúng', 'ok') : r.is_correct === false ? badge('Máy chấm: sai', 'bad') : ''}`, fields);
          }).join('')).join('');
      }
    } else if (tab === 'thoigian') {
      const total = sessions.filter(s => !s.deleted_at).reduce((a, s) => a + s.duration_seconds, 0);
      body = `<p class="small muted">Thời lượng phiên = thời điểm kết thúc (hoặc tín hiệu hợp lệ cuối) − bắt đầu, không âm. Tổng theo bài, tuần, toàn khoá được tính lại từ các phiên chưa xoá. Tổng hiện tại: <strong>${hms(total)}</strong>.</p>` +
        (sessions.length ? sessions.map(s => form('study_sessions', s, `${lessonName(s.lesson_id)} · ${hms(s.duration_seconds)} ${s.deleted_at ? badge('Đã xoá', 'bad') : ''}`)).join('') : emptyHTML('Chưa có phiên học.'));
    } else if (tab === 'dangnhap') {
      body = logins.length ? logins.map(l => form('login_events', l, `${fmtDateTime(l.logged_in_at)} <span class="small muted">${esc(l.user_agent || '')}</span>`)).join('') : emptyHTML('Chưa có lịch sử đăng nhập.');
    } else {
      const live = summaries.filter(a => !a.deleted_at);
      const lessonsDone = new Set(live.filter(a => a.status === 'submitted').map(a => a.lesson_id));
      body = `<p class="muted">Các số liệu thống kê là dữ liệu <strong>tính toán</strong> từ dữ liệu nguồn (lượt làm, dạng bài, câu trả lời, phiên học). Để thay đổi, hãy sửa dữ liệu nguồn ở các mục khác — số liệu sẽ được tính lại nhất quán ở mọi trang và trong Excel.</p>
        <dl class="meta">
          <div><dt>Số lượt làm</dt><dd>${live.length}</dd></div>
          <div><dt>Lượt đã nộp đủ</dt><dd>${live.filter(a => a.status === 'submitted').length}</dd></div>
          <div><dt>Số bài hoàn thành</dt><dd>${lessonsDone.size}/26</dd></div>
          <div><dt>Số câu đúng / sai (dạng 1–3)</dt><dd>${live.reduce((a, s) => a + s.correct_count, 0)} / ${live.reduce((a, s) => a + s.wrong_count, 0)}</dd></div>
          <div><dt>Tổng thời gian</dt><dd>${hms(live.reduce((a, s) => a + s.time_seconds, 0))}</dd></div>
          <div><dt>Tổng lượt đăng nhập</dt><dd>${prof.login_count} (sửa ở mục Tài khoản)</dd></div></dl>`;
    }
    root.innerHTML = `<nav class="crumbs"><a href="#/gv/hoc-sinh">Danh sách học sinh</a> › <a href="#/gv/hs/${id}">${esc(prof.full_name)}</a> › Chỉnh sửa toàn bộ dữ liệu</nav>
      <h1>Chỉnh sửa toàn bộ dữ liệu — ${esc(prof.full_name)}</h1>
      <p class="muted small">Mỗi thay đổi được kiểm tra trên máy chủ và ghi vào <a href="#/gv/nhat-ky?hs=${id}">nhật ký kiểm toán</a> (giá trị trước, sau, người thực hiện, thời điểm, lý do). Xoá là xoá mềm và có thể khôi phục.</p>
      <div class="tabs" role="tablist">${tabs.map(([k, t]) => `<button role="tab" class="tab ${k === tab ? 'active' : ''}" aria-selected="${k === tab}" data-tab="${k}">${t}</button>`).join('')}</div>
      <section class="card">${body}</section>`;
  }

  root.addEventListener('click', async e => {
    const t = e.target.closest('[data-tab]')?.dataset.tab;
    if (t) { tab = t; setHashParams({ muc: tab, luot: attemptSel }); draw(); return; }
    if (e.target.id === 'pw') resetPassword(prof);
    if (e.target.closest('[data-cancel]')) {
      const f = e.target.closest('form'); const reg = registry.get(`${f.dataset.table}:${f.dataset.id}`);
      f.outerHTML = recordForm(reg.table, reg.rec, reg.fields, f.querySelector('.rec-title')?.innerHTML);
    }
  });
  root.addEventListener('change', async e => {
    if (e.target.id === 'pick-att') { attemptSel = e.target.value; setHashParams({ muc: tab, luot: attemptSel }); reload(); return; }
    const f = e.target.closest('.rec-form'); if (!f) return;
    const reg = registry.get(`${f.dataset.table}:${f.dataset.id}`);
    for (const fld of reg.fields) {
      const box = f.querySelector(`.edit-field[data-k="${fld.k}"]`);
      box.classList.toggle('changed', !same(readValue(f, fld, reg.rec[fld.k]), reg.rec[fld.k], fld));
    }
  });
  root.addEventListener('input', e => { const f = e.target.closest('.rec-form'); if (f) f.dispatchEvent(new Event('change', { bubbles: true })); });
  root.addEventListener('submit', async e => {
    const f = e.target.closest('.rec-form'); if (!f) return;
    e.preventDefault();
    const reg = registry.get(`${f.dataset.table}:${f.dataset.id}`);
    const changes = {}; const lines = [];
    for (const fld of reg.fields) {
      const nv = readValue(f, fld, reg.rec[fld.k]);
      if (!same(nv, reg.rec[fld.k], fld)) { changes[fld.k] = nv; lines.push(`<li><strong>${esc(fld.label)}</strong>: ${esc(display(fld, reg.rec[fld.k]))} → <strong>${esc(display(fld, nv))}</strong></li>`); }
    }
    const msg = f.querySelector('.rec-msg');
    if (!lines.length) { msg.textContent = 'Chưa có thay đổi.'; return; }
    const isDelete = 'deleted_at' in changes && changes.deleted_at;
    const box = await modal({
      title: isDelete ? 'Xác nhận xoá mềm' : 'Xác nhận lưu thay đổi', danger: !!isDelete, confirmText: 'Lưu thay đổi',
      body: `<ul class="change-list">${lines.join('')}</ul><label class="lbl" for="rsn">Lý do (khuyến nghị)</label><input id="rsn" name="reason" maxlength="300">`
    });
    if (!box) return;
    const btn = f.querySelector('button.btn-primary'); btn.disabled = true; msg.textContent = 'Đang lưu…'; msg.className = 'rec-msg small';
    try {
      await rpc('admin_edit', { p_table: reg.table, p_id: String(reg.rec.id), p_changes: changes, p_reason: box.querySelector('[name=reason]').value || null });
      toast('Máy chủ đã lưu thay đổi và ghi nhật ký.', 'ok');
      await reload();
    } catch (err) {
      // giữ nguyên nội dung đang sửa để giáo viên điều chỉnh
      msg.textContent = 'Chưa lưu được: ' + errMsg(err); msg.className = 'rec-msg small text-bad'; btn.disabled = false;
    }
  });

  const reload = async () => { try { await loadAll(); draw(); } catch (e) { toast(errMsg(e), 'error'); } };
  (async () => {
    root.innerHTML = loadingHTML();
    try { await loadAll(); if (!prof) { root.innerHTML = emptyHTML('Không tìm thấy học sinh.'); return; } draw(); }
    catch (e) { root.innerHTML = errorHTML(errMsg(e)); $('#retry', root)?.addEventListener('click', () => location.reload()); }
  })();
}

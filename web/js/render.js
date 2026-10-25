// Hiển thị nội dung bài tập (đã chuyển từ Word) ở chế độ làm bài và chế độ kết quả.
import { esc, TYPE_NAMES, score, badge, fmtDateTime } from './util.js';

const zh = t => `<span class="zh">${esc(t)}</span>`;

/** Tô đậm tên người nói ở đầu dòng hội thoại (chỉ trình bày, không đổi nội dung). */
function speakerText(text, first) {
  if (!first) return zh(text);
  const m = text.match(/^([^：:]{1,8}[：:])(.*)$/s);
  return m ? `<b class="zh speaker">${esc(m[1])}</b>${zh(m[2])}` : zh(text);
}

function blankInput(qid, b, label, value, locked) {
  return `<input class="blank zh" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false"
    data-q="${esc(qid)}" data-b="${b}" aria-label="Chỗ trống ${esc(label)}" value="${esc(value ?? '')}" ${locked ? 'disabled' : ''}>`;
}

function resultSpan(val, ok, keyText) {
  const v = (val ?? '').trim();
  const cls = ok === true ? 'ok' : ok === false ? 'bad' : 'pending';
  const lbl = ok === true ? 'Đúng' : ok === false ? 'Sai' : 'Chưa chấm';
  return `<span class="ans ans-${cls}"><span class="zh">${v ? esc(v) : '<em>(bỏ trống)</em>'}</span><span class="ans-lbl">${lbl}</span></span>` +
    (ok === false && keyText ? `<span class="key-inline">→ <span class="zh">${esc(keyText)}</span></span>` : '');
}

const keyAlts = (key, b = null) => (key?.accepted || []).map(alt => b === null ? alt.join('，') : alt[b]).filter((v, i, a) => v && a.indexOf(v) === i);

/**
 * mode: 'do' | 'result' | 'preview'
 * ctx: { answers: {qid:[...]}, responses: {qid: resp}, keys: {qid:key}, locked }
 */
export function renderSection(section, questions, mode, ctx = {}) {
  const t = section.section_type;
  const ans = ctx.answers || {};
  const resp = ctx.responses || {};
  const keys = ctx.keys || {};
  const val = (qid, b) => mode === 'do' ? ans[qid]?.[b] : resp[qid]?.answer?.[b];
  const head = `<div class="sec-head"><h3>${esc(TYPE_NAMES[t])} <span class="zh muted">${esc(section.title.replace(/^.*?\s{2}/, ''))}</span></h3>
    ${section.instruction ? `<p class="muted">${esc(section.instruction)}</p>` : ''}</div>`;
  let body = '';

  if (t === 1) {
    const byId = Object.fromEntries(questions.map(q => [q.id, q]));
    body = (section.content.groups || []).map(g => `
      <div class="dialogue card-inner"><div class="dlg-label zh">${esc(g.label)}</div>
      ${g.lines.map(line => `<p class="dlg-line">${line.map((seg, i) => {
        if (seg.t !== undefined) return speakerText(seg.t, i === 0);
        const q = byId[seg.q];
        const lbl = `<span class="blank-no">${esc(seg.label)}</span>`;
        if (mode === 'do') return lbl + blankInput(seg.q, 0, seg.label, val(seg.q, 0), ctx.locked);
        if (mode === 'preview') return lbl + `<span class="ans ans-key zh">${esc(keyAlts(keys[seg.q], 0).join(' / ') || '?')}</span>`;
        return lbl + resultSpan(val(seg.q, 0), resp[seg.q]?.is_correct, keyAlts(keys[seg.q], 0).join(' / '));
      }).join('')}</p>`).join('')}
      </div>`).join('');
  }

  if (t === 2) {
    if (section.word_bank?.length) {
      body += `<div class="word-bank" aria-label="Từ cho sẵn"><span class="muted">Từ cho sẵn:</span> ${section.word_bank.map(w => `<span class="word zh">${esc(w)}</span>`).join('')}</div>`;
    }
    body += questions.map(q => {
      const rows = q.prompt.lines.map(line => `<p class="item-line">${line.map(seg => {
        if (seg.t !== undefined) return zh(seg.t);
        if (mode === 'do') return blankInput(q.id, seg.b, `câu ${q.prompt.no}${q.blank_count > 1 ? ' ô ' + (seg.b + 1) : ''}`, val(q.id, seg.b), ctx.locked);
        if (mode === 'preview') return `<span class="ans ans-key zh">${esc(keyAlts(keys[q.id], q.blank_count > 1 ? seg.b : 0).join(' / ') || '?')}</span>`;
        return resultSpan(val(q.id, seg.b), resp[q.id]?.is_correct, null);
      }).join('')}</p>`).join('');
      const keyLine = mode !== 'do' && keys[q.id] ? `<p class="key-line">Đáp án: <span class="zh">${esc(keyAlts(keys[q.id]).join('  /  '))}</span>${mode === 'result' ? ' ' + resultBadge(resp[q.id]) : ''}</p>` : '';
      return `<div class="item"><span class="item-no">${q.prompt.no}.</span><div class="item-body">${rows}${keyLine}</div></div>`;
    }).join('');
  }

  if (t === 3) {
    body = questions.map(q => {
      const words = `<p class="words zh" aria-label="Các từ đã cho">${q.prompt.words.map(w => `<span class="word">${esc(w)}</span>`).join('<span class="slash">/</span>')}</p>`;
      let field;
      if (mode === 'do') {
        field = `<label class="sr-only" for="in-${esc(q.id)}">Câu hoàn chỉnh ${q.prompt.no}</label>
          <input id="in-${esc(q.id)}" class="line-input zh" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
          data-q="${esc(q.id)}" data-b="0" placeholder="Nhập câu hoàn chỉnh…" value="${esc(val(q.id, 0) ?? '')}" ${ctx.locked ? 'disabled' : ''}>`;
      } else if (mode === 'preview') {
        field = `<p class="key-line">Đáp án: <span class="zh">${esc(keyAlts(keys[q.id], 0).join('  /  '))}</span></p>`;
      } else {
        field = `<p>${resultSpan(val(q.id, 0), resp[q.id]?.is_correct, null)}</p>
          <p class="key-line">Đáp án: <span class="zh">${esc(keyAlts(keys[q.id], 0).join('  /  '))}</span></p>`;
      }
      return `<div class="item"><span class="item-no">${q.prompt.no}.</span><div class="item-body">${words}${field}</div></div>`;
    }).join('');
  }

  if (t === 4) {
    body = `<div class="pic-grid">` + questions.map(q => {
      let field;
      if (mode === 'do') {
        field = `<label class="lbl" for="in-${esc(q.id)}">Câu miêu tả của bạn</label>
          <textarea id="in-${esc(q.id)}" class="para-input zh" rows="4" data-q="${esc(q.id)}" data-b="0" spellcheck="false"
            placeholder="Viết câu hoặc đoạn miêu tả bằng tiếng Trung…" ${ctx.locked ? 'disabled' : ''}>${esc(val(q.id, 0) ?? '')}</textarea>`;
      } else {
        const own = mode === 'result' ? `<div class="lbl">Bài làm của bạn</div><div class="para-answer zh">${esc(val(q.id, 0) || '') || '<em>(bỏ trống)</em>'}</div>` : '';
        const ref = keys[q.id]?.reference_answer ? `<p class="key-line">Đáp án tham khảo: <span class="zh">${esc(keys[q.id].reference_answer)}</span></p>` : '';
        field = own + ref;
      }
      return `<figure class="pic-item card-inner">
        <img src="${esc(q.prompt.image)}" alt="Tranh ${q.prompt.no} — từ cho sẵn: ${esc(q.prompt.word)}" loading="lazy">
        <figcaption><span class="item-no">${q.prompt.no}.</span> Từ cho sẵn: <span class="word zh">${esc(q.prompt.word)}</span></figcaption>
        ${field}</figure>`;
    }).join('') + `</div>`;
  }
  return head + `<div class="sec-body">${body}</div>`;
}

function resultBadge(r) {
  if (!r) return badge('Bỏ trống', 'bad');
  return r.is_correct ? badge('Đúng', 'ok') : badge('Sai', 'bad');
}

/** Ô tóm tắt điểm 1 dạng (dùng ở trang kết quả) */
export const MAX_POINTS = { 1: 3, 2: 3, 3: 4, 4: 0 };   // quy tắc 3-3-4, dạng 4 không chấm điểm
export function sectionScoreLine(sec) {
  if (sec.status !== 'submitted') return badge('Chưa nộp', 'neutral');
  if (sec.section_type === 4) return `${badge('Không chấm điểm', 'info')} <span class="muted">Đối chiếu với đáp án tham khảo bên dưới.</span>`;
  const parts = [`<strong>${score(sec.effective_score)}</strong> / ${MAX_POINTS[sec.section_type]} điểm`,
    `${sec.correct_count ?? 0} đúng · ${sec.wrong_count ?? 0} sai`];
  if (sec.score_override != null) parts.push(badge('Điểm điều chỉnh thủ công', 'info'));
  return parts.join(' <span class="dot">·</span> ');
}

/** Trang kết quả một lượt (dùng chung HS & GV) */
export function renderAttemptResult(detail, cur, opts = {}) {
  const a = detail.attempt, sum = detail.summary || {};
  const lesson = cur.lessonMap[a.lesson_id];
  const subj = cur.subjectMap[lesson.subject_code];
  const sections = cur.byLesson[lesson.id];
  const final = sum.score_final;
  const totalHTML = a.status === 'submitted' && final
    ? `<span class="big-score">${score(sum.score_so_far)}</span><span class="muted"> / 10</span>`
    : `${badge('Lượt đang làm dở', 'neutral')}${sum.score_so_far != null ? ` <span class="muted">Điểm tạm tính các dạng đã nộp: ${score(sum.score_so_far)}</span>` : ''}`;
  const secHTML = detail.sections.map(sd => {
    const section = sections.find(s => s.id === sd.section_id);
    const qs = cur.bySection[section.id] || [];
    const responses = Object.fromEntries(sd.responses.map(r => [r.question_id, r]));
    const inner = sd.status === 'submitted' || opts.teacher
      ? renderSection(section, qs, 'result', { responses, keys: sd.keys || {} })
      : `<div class="sec-head"><h3>${TYPE_NAMES[sd.section_type]}</h3></div>`;
    const comment = sd.teacher_comment
      ? `<div class="comment"><div class="lbl">Nhận xét của giáo viên</div><p>${esc(sd.teacher_comment)}</p></div>` : '';
    return `<section class="card result-sec" id="sec-${sd.section_type}">
      <div class="result-sec-score">${sectionScoreLine(sd)}</div>${inner}${comment}
      ${opts.sectionExtra ? opts.sectionExtra(sd) : ''}</section>`;
  }).join('');
  return `
    <div class="card result-head">
      <p class="eyebrow">${esc(subj.title)} · Tuần ${lesson.week} · Bài ${lesson.lesson_order}</p>
      <h2 class="zh">${esc(lesson.title)}</h2>
      <dl class="meta">
        <div><dt>Lượt làm</dt><dd>#${a.attempt_no}</dd></div>
        <div><dt>Bắt đầu</dt><dd>${fmtDateTime(a.started_at)}</dd></div>
        <div><dt>Kết thúc</dt><dd>${fmtDateTime(a.submitted_at)}</dd></div>
        <div><dt>Thời gian làm</dt><dd>${opts.durText(sum.time_seconds)}</dd></div>
        <div><dt>Đúng / sai (dạng 1–3)</dt><dd>${sum.correct_count ?? 0} đúng · ${sum.wrong_count ?? 0} sai</dd></div>
      </dl>
      <div class="total">Tổng điểm: ${totalHTML}</div>
      <div class="score-row">${detail.sections.map(s => `<div class="score-chip"><span>${['', 'Dạng 1', 'Dạng 2', 'Dạng 3', 'Dạng 4'][s.section_type]}</span>
        <strong>${s.section_type === 4 ? (s.status === 'submitted' ? 'Không chấm điểm' : '—') : s.status !== 'submitted' ? `— / ${MAX_POINTS[s.section_type]}` : score(s.effective_score) + ' / ' + MAX_POINTS[s.section_type]}</strong></div>`).join('')}</div>
    </div>${secHTML}`;
}

// Kết nối Supabase. Chỉ dùng anon key (công khai) — mọi quyền được kiểm tra bằng RLS và hàm phía máy chủ.
const cfg = window.APP_CONFIG || {};
export const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_URL.includes('YOUR-PROJECT'));
export const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'htt-auth' }
}) : null;
export const LOGIN_DOMAIN = cfg.LOGIN_EMAIL_DOMAIN || 'hoctiengtrung.example.com';

let accessToken = null;
sb?.auth.onAuthStateChange((_e, session) => { accessToken = session?.access_token || null; });

const MESSAGES = {
  ACCOUNT_LOCKED: 'Tài khoản đang bị khoá. Vui lòng liên hệ giáo viên.',
  ACCOUNT_NOT_FOUND: 'Không tìm thấy hồ sơ của tài khoản này.',
  NOT_ALLOWED: 'Bạn không có quyền thực hiện thao tác này.',
  ATTEMPT_CLOSED: 'Lượt làm này đã nộp, không thể thay đổi.',
  SECTION_CLOSED: 'Dạng bài này đã nộp, không thể sửa câu trả lời.',
  PREVIOUS_SECTION_NOT_SUBMITTED: 'Cần nộp các dạng trước theo thứ tự.',
  SCORE_OUT_OF_RANGE: 'Điểm vượt quá điểm tối đa của dạng (Dạng 1: 3, Dạng 2: 3, Dạng 3: 4).', TYPE_4_NOT_SCORED: 'Dạng 4 không chấm điểm.',
  BAD_ANSWER: 'Câu trả lời không hợp lệ.',
  FIELD_NOT_ALLOWED: 'Trường dữ liệu không được phép sửa.',
  ONLY_STUDENT_DATA: 'Chỉ được sửa dữ liệu của học sinh.',
  LOGIN_CODE_EXISTS: 'Mã đăng nhập đã tồn tại.',
  STUDENT_CODE_EXISTS: 'Mã học sinh đã tồn tại.',
  PASSWORD_TOO_SHORT: 'Mật khẩu cần ít nhất 6 ký tự.',
  CANNOT_RESTORE: 'Không thể khôi phục bản ghi này.',
  NO_CHANGES: 'Chưa có thay đổi nào.',
};
export function errMsg(e) {
  const raw = (e?.message || String(e || '')).trim();
  for (const k of Object.keys(MESSAGES)) if (raw.includes(k)) return MESSAGES[k];
  if (/check constraint/i.test(raw)) return 'Giá trị không hợp lệ (vượt giới hạn cho phép hoặc thời gian không hợp lệ).';
  if (/duplicate key|unique/i.test(raw)) return 'Giá trị bị trùng với bản ghi khác.';
  if (/Failed to fetch|NetworkError|network/i.test(raw)) return 'Mất kết nối mạng. Vui lòng kiểm tra Internet và thử lại.';
  if (/Invalid login credentials/i.test(raw)) return 'Mã đăng nhập hoặc mật khẩu không đúng.';
  if (/JWT|token/i.test(raw)) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  return raw || 'Đã có lỗi xảy ra.';
}

export async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
export async function select(table, build = q => q, columns = '*') {
  const { data, error } = await build(sb.from(table).select(columns));
  if (error) throw new Error(error.message);
  return data;
}

/** Gọi RPC bằng fetch keepalive — dùng khi trang đang bị ẩn/đóng (pagehide) */
export function rpcKeepalive(name, args) {
  if (!accessToken) return;
  try {
    fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(args)
    }).catch(() => {});
  } catch { /* trình duyệt đang đóng */ }
}

// ---------- Người dùng hiện tại ----------
export const state = { user: null, profile: null, curriculum: null };

export async function login(code, password) {
  const email = `${code.trim().toLowerCase()}@${LOGIN_DOMAIN}`;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  accessToken = data.session.access_token;
  try {
    state.profile = await rpc('record_login', { p_user_agent: navigator.userAgent });
  } catch (e) { await sb.auth.signOut(); throw e; }
  state.user = data.user;
  return state.profile;
}

export async function restoreSession() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  accessToken = data.session.access_token;
  state.user = data.session.user;
  const rows = await select('profiles', q => q.eq('id', state.user.id));
  const p = rows[0];
  if (!p || p.status !== 'active' || p.deleted_at) { await sb.auth.signOut(); return null; }
  state.profile = { ...p, full_name: p.role === 'teacher' ? 'Giáo viên' : p.full_name };
  return state.profile;
}

export async function logout() {
  try { await rpc('record_logout'); } catch { /* vẫn đăng xuất */ }
  await sb.auth.signOut();
  state.user = state.profile = null;
}

// ---------- Chương trình học (không có đáp án) ----------
export async function curriculum(force = false) {
  if (state.curriculum && !force) return state.curriculum;
  const [subjects, lessons, sections, questions] = await Promise.all([
    select('subjects', q => q.order('sort_order')),
    select('lessons', q => q.order('week').order('lesson_order')),
    select('sections', q => q.order('section_type')),
    select('questions', q => q.order('q_order').range(0, 4999)),
  ]);
  const byLesson = {}, bySection = {};
  for (const s of sections) (byLesson[s.lesson_id] ||= []).push(s);
  for (const q of questions) (bySection[q.section_id] ||= []).push(q);
  const lessonMap = Object.fromEntries(lessons.map(l => [l.id, l]));
  const subjectMap = Object.fromEntries(subjects.map(s => [s.code, s]));
  state.curriculum = { subjects, lessons, sections, lessonMap, subjectMap, byLesson, bySection };
  return state.curriculum;
}

export function lessonLabel(l, cur = state.curriculum) {
  const s = cur?.subjectMap[l.subject_code];
  return `${s ? s.title : ''} · Tuần ${l.week} · Bài ${l.lesson_order}`;
}

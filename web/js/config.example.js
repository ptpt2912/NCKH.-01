// Sao chép file này thành js/config.js rồi điền thông tin dự án Supabase
// (Supabase Dashboard › Project Settings › API).
// Chỉ dùng "anon public" key. TUYỆT ĐỐI không dán service_role key vào đây.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLIC-KEY',
  // Phải trùng với app_settings.login_email_domain trong cơ sở dữ liệu
  LOGIN_EMAIL_DOMAIN: 'hoctiengtrung.example.com'
};

// Sao chép file này thành js/config.js rồi điền thông tin dự án Supabase
// (Supabase Dashboard › Project Settings › API).
// Chỉ dùng "anon public" key. TUYỆT ĐỐI không dán service_role key vào đây.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://ngwroirfgxfpuriczaod.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_m3yDhoOHaeq7tBS2faeqOw_x_bGVZYB',
  // Phải trùng với app_settings.login_email_domain trong cơ sở dữ liệu
  LOGIN_EMAIL_DOMAIN: 'hoctiengtrung.example.com'
};

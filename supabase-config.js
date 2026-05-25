// Supabase client — anon key is safe to expose; RLS policies protect all data
var SUPABASE_URL  = 'https://byjuocnkyuxxudondciz.supabase.co';
var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5anVvY25reXV4eHVkb25kY2l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NDQzNjgsImV4cCI6MjA5NTIyMDM2OH0.IZPJZ1ZHgy3hweRZDcOdMs8dP8vo5O7zwOCWNbKwoZU';
// sessionStorage: la sesión se borra al cerrar el navegador (seguridad)
var _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
        storage:          window.sessionStorage,
        persistSession:   true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});

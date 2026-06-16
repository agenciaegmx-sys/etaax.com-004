// Supabase client — anon key is safe to expose; RLS policies protect all data
var SUPABASE_URL  = 'https://byjuocnkyuxxudondciz.supabase.co';
var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5anVvY25reXV4eHVkb25kY2l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NDQzNjgsImV4cCI6MjA5NTIyMDM2OH0.IZPJZ1ZHgy3hweRZDcOdMs8dP8vo5O7zwOCWNbKwoZU';
// localStorage: la sesión se comparte entre pestañas y sobrevive cerrar el
// navegador. La seguridad la da el auto-logout por inactividad (30 min) de
// security.js, que limpia la sesión y manda al hub.
var _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
        storage:          window.localStorage,
        persistSession:   true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});

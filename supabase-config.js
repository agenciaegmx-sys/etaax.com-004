// Supabase client — anon key is safe to expose; RLS policies protect all data
var SUPABASE_URL  = 'https://byjuocnkyuxxudondciz.supabase.co';
var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5anVvY25reXV4eHVkb25kY2l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NDQzNjgsImV4cCI6MjA5NTIyMDM2OH0.IZPJZ1ZHgy3hweRZDcOdMs8dP8vo5O7zwOCWNbKwoZU';
// Limpieza: si quedó una sesión en localStorage de la versión que usaba ese
// almacenamiento, borrarla para que NO sobreviva al cierre de pestaña.
try {
    for (var _i = localStorage.length - 1; _i >= 0; _i--) {
        var _k = localStorage.key(_i);
        if (_k && _k.indexOf('sb-') === 0) localStorage.removeItem(_k);
    }
} catch (e) {}

// sessionStorage: la sesión se borra al cerrar la pestaña/navegador (seguridad).
// Al volver a abrir el hub se exige login. El auto-logout por inactividad
// (30 min) de security.js refuerza esto durante la sesión.
var _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
        storage:          window.sessionStorage,
        persistSession:   true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});

// Supabase client for RABBIT HOLE.
// The publishable key is meant to be public; Row Level Security gates all data access.
const SUPABASE_URL = 'https://obkwrrecpxezjonwearb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ZaEqfqkPwxdF2MaU_eJ17w_MBsp_Hd-';

// supabase-js is loaded via the UMD bundle in index.html (global `supabase`).
window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

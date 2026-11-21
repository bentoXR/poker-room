// Conexão única com o Supabase (usada por todos os módulos e modos)
export const SUPABASE_URL = 'https://lymawbmtdalvjvgclnpd.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_RG0H_4lqNuQNL0GCg1uY9A_efA8wDga';

export const banco = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

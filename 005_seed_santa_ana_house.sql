// core/supabase-client.js
//
// Único punto de creación del cliente Supabase. Ningún módulo debe llamar a
// createClient() por su cuenta — todos importan `supabase` desde aquí.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://bhtmiqtwbzuezbqsrhej.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_9XKSyYxpCkuIDF8WfW-92A_PHNPoO8r';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

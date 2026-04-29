import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      flowType: "implicit",     // prevents PKCE code verifier being lost during Stripe redirect
      persistSession: true,     // keep session in localStorage across page navigations
      detectSessionInUrl: true, // pick up auth tokens from URL on return
    },
  }
);

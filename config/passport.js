const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { createClient } = require('@supabase/supabase-js');

// Admin client — uses service role key so it can upsert Auth users
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID || 'DUMMY_CLIENT_ID',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'DUMMY_CLIENT_SECRET',
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
      proxy: true,
    },
    async (accessToken, refreshToken, googleProfile, done) => {
      try {
        const email = googleProfile.emails?.[0]?.value || '';
        const name = googleProfile.displayName || '';
        const avatar = googleProfile.photos?.[0]?.value || '';

        // ── Step 1: Find or create the user in Supabase Auth ───────────────
        // List users by email to check if they already exist
        let supabaseUserId = null;

        if (email) {
          const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
          if (!listError && listData?.users) {
            const existing = listData.users.find((u) => u.email === email);
            if (existing) {
              supabaseUserId = existing.id;
            }
          }
        }

        // If not found, create the user in Supabase Auth
        if (!supabaseUserId) {
          const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: {
              full_name: name,
              avatar_url: avatar,
              provider: 'google',
              google_id: googleProfile.id,
            },
          });

          if (createError) {
            console.error('[Passport] Failed to create Supabase user:', createError.message);
            return done(createError, null);
          }
          supabaseUserId = createData.user.id;
        }

        // ── Step 2: Ensure a profiles row exists ───────────────────────────
        const { error: upsertError } = await supabaseAdmin
          .from('profiles')
          .upsert(
            {
              id: supabaseUserId,
              display_name: name || 'User',
              avatar_url: avatar,
              onboarded: false, // will be completed via PersonalizationModal
            },
            { onConflict: 'id', ignoreDuplicates: true }
          );

        if (upsertError) {
          // Non-fatal: profile row may already exist with richer data
          console.warn('[Passport] Profile upsert warning:', upsertError.message);
        }

        // ── Return the Supabase UUID as the canonical user id ─────────────
        const user = {
          id: supabaseUserId,
          email,
          name,
          avatar,
          googleId: googleProfile.id,
        };

        return done(null, user);
      } catch (err) {
        console.error('[Passport] Strategy error:', err);
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

module.exports = passport;

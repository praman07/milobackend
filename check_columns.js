const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const tables = ['profiles', 'likes', 'matches', 'messages', 'reports', 'blocks', 'subscriptions'];

async function check() {
  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .limit(1);

    if (error) {
      console.log(`Table "${table}": ❌ ERROR (${error.code}): ${error.message}`);
    } else {
      console.log(`Table "${table}": ✅ EXISTS (returned ${data.length} rows)`);
    }
  }
}

check();

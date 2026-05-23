const { Client } = require('pg');

async function testConnection() {
  const host = 'db.aadpczvmfgkesglnjgqq.supabase.co';
  const port = 5432;
  const passwords = [
    'Kodex0000',
    'Kodex0000!',
    'Kodex!0000',
    'Kodex@0000',
    'praman07',
    'Praman07',
    'praman@07',
    'Praman@07',
    'Praman07!',
    'Praman!07',
    'Kodex2026',
    'Kodex@2026'
  ];

  for (const password of passwords) {
    console.log(`Trying password: "${password}"...`);
    const client = new Client({
      host,
      port,
      user: 'postgres',
      password,
      database: 'postgres',
      ssl: { rejectUnauthorized: false }
    });

    try {
      await client.connect();
      console.log(`✅ Success connecting with password "${password}"!`);
      const res = await client.query('SELECT version();');
      console.log('Database version:', res.rows[0].version);
      await client.end();
      process.exit(0);
    } catch (err) {
      if (err.message.includes('password authentication failed')) {
        // expected, keep trying
      } else {
        console.error(`❌ Unexpected error for "${password}":`, err.message);
      }
    }
  }
  console.log('All password attempts failed.');
}

testConnection();

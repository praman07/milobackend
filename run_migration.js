const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

const dbPassword = process.env.DB_PASSWORD;
if (!dbPassword) {
  console.error('❌ Error: DB_PASSWORD environment variable is not defined in server/.env.');
  console.log('Please add DB_PASSWORD=your_supabase_db_password to server/.env and run this script again.');
  process.exit(1);
}

const host = 'db.aadpczvmfgkesglnjgqq.supabase.co';
const port = 5432;
const user = 'postgres';
const database = 'postgres';

async function runMigration() {
  console.log(`Connecting to database at ${host}...`);
  const client = new Client({
    host,
    port,
    user,
    password: dbPassword,
    database,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected successfully!');

    const schemaPath = path.resolve(__dirname, '../supabase/schema.sql');
    console.log(`Reading SQL schema from ${schemaPath}...`);
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Executing schema.sql on database...');
    // We execute the SQL query. PostgreSQL client allows multiple queries separated by semicolon.
    await client.query(sql);
    console.log('🎉 Migration completed successfully! Database has been updated to production schema.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

runMigration();

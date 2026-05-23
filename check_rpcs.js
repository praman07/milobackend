require('dotenv').config();

const url = `${process.env.SUPABASE_URL}/rest/v1/?apikey=${process.env.SUPABASE_SERVICE_ROLE_KEY}`;

async function getSpec() {
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log('OpenAPI Paths:');
    console.log(Object.keys(data.paths));
  } catch (err) {
    console.error('Error fetching OpenAPI spec:', err.message);
  }
}

getSpec();

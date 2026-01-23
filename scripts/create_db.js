const { Client } = require('pg');
require('dotenv').config();

const createDb = async () => {
  // Parse DB URL to get credentials, but connect to 'postgres' database
  const dbUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/govbudget';
  const urlParts = new URL(dbUrl);
  urlParts.pathname = '/postgres'; // Connect to default DB
  
  const client = new Client({
    connectionString: urlParts.toString(),
  });

  try {
    await client.connect();
    console.log('Connected to postgres database.');
    
    // Check if db exists
    const res = await client.query("SELECT 1 FROM pg_database WHERE datname = 'govbudget'");
    if (res.rowCount === 0) {
      console.log("Creating database 'govbudget'...");
      await client.query('CREATE DATABASE govbudget');
      console.log("Database 'govbudget' created successfully.");
    } else {
      console.log("Database 'govbudget' already exists.");
    }
  } catch (err) {
    console.error('Error creating database:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
};

createDb();

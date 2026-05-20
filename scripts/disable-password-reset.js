const { Client } = require('pg')
require('dotenv').config({ path: '.env.production' })

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  console.error('DATABASE_URL not found in .env.production')
  process.exit(1)
}

const client = new Client({
  connectionString: connectionString,
})

async function main() {
  console.log('Connecting to database...')
  await client.connect()
  console.log('Starting to disable password reset requirement for all users...')
  try {
    const res = await client.query('UPDATE users SET must_change_password = 0 WHERE must_change_password = 1')
    console.log(`Successfully disabled password reset for ${res.rowCount} users.`)
  } catch (error) {
    console.error('Database update failed:', error)
  } finally {
    await client.end()
  }
}

main()
  .catch((e) => {
    console.error('Error in script:', e)
    process.exit(1)
  })

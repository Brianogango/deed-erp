const { sql } = require('../lib/auth/db')

async function main() {
  console.log('Starting to disable password reset requirement for all users...')
  try {
    // We use the actual table name and column name found from the DB pull
    const result = await sql`UPDATE users SET must_change_password = 0 WHERE must_change_password = 1`
    console.log('Successfully disabled password reset for users.')
  } catch (error) {
    console.error('Database update failed:', error)
  }
}

main()
  .catch((e) => {
    console.error('Error in script:', e)
    process.exit(1)
  })

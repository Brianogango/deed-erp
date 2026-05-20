const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
require('dotenv').config({ path: '.env.production' })

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  console.error('DATABASE_URL not found in .env.production')
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Starting to disable password reset requirement for all users...')
  try {
    const result = await prisma.user.updateMany({
      where: {
        mustResetPw: true
      },
      data: {
        mustResetPw: false
      }
    })
    console.log(`Successfully disabled password reset for ${result.count} users.`)
  } catch (error) {
    console.error('Database update failed:', error)
  }
}

main()
  .catch((e) => {
    console.error('Error in script:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

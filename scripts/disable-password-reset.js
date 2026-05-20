const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

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

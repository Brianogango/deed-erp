import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
})

async function main() {
  console.log('Starting to disable password reset requirement for all users...')
  const result = await prisma.user.updateMany({
    where: {
      mustResetPw: true
    },
    data: {
      mustResetPw: false
    }
  })
  console.log(`Successfully disabled password reset for ${result.count} users.`)
}

main()
  .catch((e) => {
    console.error('Error updating users:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

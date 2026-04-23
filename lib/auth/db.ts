import 'server-only'

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const dataDirectory = path.join(process.cwd(), 'data')
const databaseFile = path.join(dataDirectory, 'deed-erp.sqlite')

declare global {
  // eslint-disable-next-line no-var
  var __deedErpDb: DatabaseSync | undefined
}

const ensureDatabaseDirectory = () => {
  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory, { recursive: true })
  }
}

const createDatabase = () => {
  ensureDatabaseDirectory()
  const database = new DatabaseSync(databaseFile)
  database.exec('PRAGMA foreign_keys = ON;')
  database.exec('PRAGMA journal_mode = WAL;')
  return database
}

export const getDatabase = () => {
  if (!global.__deedErpDb) {
    global.__deedErpDb = createDatabase()
  }

  return global.__deedErpDb
}

export const getDatabaseFilePath = () => databaseFile

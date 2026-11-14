import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import ts from 'typescript'

// Files marked "@ts-nocheck" are never type-checked, so a name used without being
// declared or imported (e.g. `userCan(currentUser, …)` with no `currentUser`)
// compiles and only crashes in the browser when that code path runs. This guard
// resolves every identifier in those files and fails on any that resolve to nothing.

const GLOBAL_NAMES = new Set(['undefined', 'arguments', 'globalThis'])

function nocheckFiles(): string[] {
  const out = execSync('git grep -l -E "^// @ts-nocheck" -- "app/*.ts" "app/*.tsx" "components/*.tsx" "components/*.ts" "lib/*.ts" "lib/*.tsx" "hooks/*.ts"', { encoding: 'utf8' })
  return out.split('\n').filter(Boolean).map(f => path.resolve(f))
}

function isNameNotReference(n: ts.Identifier): boolean {
  const p = n.parent
  return (ts.isPropertyAccessExpression(p) && p.name === n)
    || (ts.isPropertyAssignment(p) && p.name === n)
    || (ts.isQualifiedName(p) && p.right === n)
    || ts.isPropertySignature(p)
    || (ts.isMethodDeclaration(p) && p.name === n)
    || (ts.isPropertyDeclaration(p) && p.name === n)
    || ((ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name === n)
    || ts.isJsxAttribute(p)
    || (ts.isBindingElement(p) && p.propertyName === n)
    || ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)
    || ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isEnumMember(p) || ts.isMetaProperty(p)
    || ((ts.isJsxOpeningElement(p) || ts.isJsxClosingElement(p) || ts.isJsxSelfClosingElement(p)) && /^[a-z]/.test(n.text))
}

describe('@ts-nocheck files', () => {
  it('are only the store and its action files (the list may shrink, never grow)', () => {
    const files = nocheckFiles().map(f => path.relative(process.cwd(), f))
    const allowed = (f: string) => f === 'lib/store.tsx' || /^lib\/store\/actions\/[\w-]+\.ts$/.test(f)
    expect(files.filter(f => !allowed(f))).toEqual([])
  })

  it('use no undeclared names', () => {
    const files = nocheckFiles()
    const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile('tsconfig.json', ts.sys.readFile).config, ts.sys, process.cwd())
    const program = ts.createProgram(files, { ...cfg.options, noEmit: true })
    const checker = program.getTypeChecker()
    const found: string[] = []
    for (const file of files) {
      const sf = program.getSourceFile(file)!
      const walk = (n: ts.Node) => {
        if (ts.isIdentifier(n) && !GLOBAL_NAMES.has(n.text) && !isNameNotReference(n)) {
          const shorthand = ts.isShorthandPropertyAssignment(n.parent) && checker.getShorthandAssignmentValueSymbol(n.parent)
          if (!shorthand && !checker.getSymbolAtLocation(n)) {
            const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
            found.push(`${path.relative(process.cwd(), file)}:${line} ${n.text}`)
          }
        }
        ts.forEachChild(n, walk)
      }
      walk(sf)
    }
    expect(found).toEqual([])
  }, 60_000)
})

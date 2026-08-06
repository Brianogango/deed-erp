# Cursor Design Skills Installation Record

**Date (UTC):** 2026-08-06  
**Project root:** `/workspace`  
**Branch at install:** `cursor/ux-audit-redesign-proposal-ddc8`  
**Installer:** Cloud agent (project-local only; no `sudo`; ERP `package.json` / app source not modified)

---

## 1. Environment

| Item | Value |
|------|-------|
| OS | Linux 6.12.94+ (x86_64) |
| Shell | bash (`/bin/bash`) |
| Node.js | v22.14.0 |
| npm | 10.9.7 |
| npx | 10.9.2 (available) |
| Git | 2.43.0 |
| Python | 3.12.3 |
| Working tree before install | Clean on proposal branch; existing incomplete `.cursor/skills/ui-ux-pro-max` (pycache only) + full `.claude/skills/ui-ux-pro-max` |

Root confirmed via `.git`, `package.json`, `package-lock.json`, `pnpm-lock.yaml`.

---

## 2. Existing configuration found

| Path | Pre-install state |
|------|-------------------|
| `.cursor/` | Present; only incomplete `skills/ui-ux-pro-max` (scripts/`__pycache__` only, no `SKILL.md`) |
| `.cursor/skills/` | `ui-ux-pro-max` (broken/incomplete) |
| `.cursor/rules/` | Absent |
| `.cursor/commands/` | Absent |
| `.cursor/hooks.json` | Absent |
| `.agents/skills/` | Absent |
| `.claude/skills/` | `ui-ux-pro-max` (full, with YAML frontmatter) |
| `AGENTS.md` / `PRODUCT.md` / `DESIGN.md` | Absent |
| `skills-lock.json` | Absent |
| Prior backup | `.cursor-design-install-backup/claude-pre-install/` |

**Backup created:** `.cursor-design-install-backup/pre-install-20260806/`  
Contains copies of pre-install `.cursor`, `.claude`, incomplete cursor ui-ux-pro-max, and `INVENTORY.txt`.

**Conflict note:** Pre-existing `.cursor/skills/ui-ux-pro-max` was incomplete (no `SKILL.md`). Replaced by official `uipro-cli init --ai cursor --force`. Full prior Claude copy preserved under backup `claude-ui-ux-pro-max-pre/`.

---

## 3. Skills requested

1. impeccable (pbakaus/impeccable)  
2. frontend-design (anthropics/skills)  
3. design-taste-frontend (Leonxlnx/taste-skill)  
4. redesign-existing-projects (Leonxlnx/taste-skill)  
5. ui-ux-pro-max (nextlevelbuilder / uipro-cli)  
6. emil-design-eng, review-animations, improve-animations, find-animation-opportunities, animation-vocabulary, pick-ui-library (emilkowalski/skills)

---

## 4–7. Skills installed, sources, commands, paths

### Commands executed

```bash
# Discovery / security (list-only where possible)
npx --yes impeccable --help
npx --yes impeccable skills --help   # NOTE: current CLI may run install with defaults when stdin is non-TTY
npx --yes skills@latest --help
npx --yes skills@latest add emilkowalski/skills --list
npx --yes skills@latest add Leonxlnx/taste-skill --list
npx --yes skills@latest add anthropics/skills --list
npm view uipro-cli version repository engines
npx --yes uipro-cli --help
npx --yes uipro-cli init --help

# Installs
npx --yes impeccable install          # project scope; providers cursor+claude+github (auto-detected)
npx --yes skills@latest add anthropics/skills --skill frontend-design --agent cursor --yes --copy
npx --yes skills@latest add Leonxlnx/taste-skill \
  --skill design-taste-frontend --skill redesign-existing-projects \
  --agent cursor --yes --copy
npx --yes skills@latest add emilkowalski/skills \
  --skill emil-design-eng --skill review-animations --skill improve-animations \
  --skill find-animation-opportunities --skill animation-vocabulary --skill pick-ui-library \
  --agent cursor --yes --copy
npx --yes uipro-cli init --ai cursor --force

# Mirror .agents/skills → .cursor/skills (copies) for harnesses that only scan .cursor/skills
```

**Note on Impeccable CLI:** Requested `npx impeccable skills install -y --providers=cursor --scope=project` is **legacy**. Current release uses `npx impeccable install` (v3.5.0 npm / skill content v4.0.4). Install landed project-local under `.cursor`, `.claude`, and `.github`.

### Installation matrix

| Skill | Source | Path(s) | Scope | Scripts | Hooks | Frontmatter | Verify |
|-------|--------|---------|-------|---------|-------|-------------|--------|
| impeccable | github.com/pbakaus/impeccable | `.cursor/skills/impeccable/`, also `.claude/skills/impeccable/`, `.github/skills/impeccable/` | project | Yes (detector, live, hooks) | Yes — `.cursor/hooks.json` `preToolUse` → `hook-before-edit.mjs` | Valid `name` + `description` | OK |
| frontend-design | github.com/anthropics/skills | `.agents/skills/frontend-design/` + `.cursor/skills/frontend-design/` | project | No (LICENSE only) | No | Valid | OK |
| design-taste-frontend | github.com/Leonxlnx/taste-skill | `.agents/` + `.cursor/skills/` | project | No | No | Valid | OK |
| redesign-existing-projects | github.com/Leonxlnx/taste-skill | `.agents/` + `.cursor/skills/` | project | No | No | Valid | OK |
| ui-ux-pro-max | uipro-cli 2.2.3 → nextlevelbuilder templates | `.cursor/skills/ui-ux-pro-max/` (+ existing `.claude/skills/ui-ux-pro-max/`) | project | Yes (`scripts/*.py`, CSV data) | No | **No YAML frontmatter** (H1 title only) — still usable | OK with caveat |
| emil-design-eng | github.com/emilkowalski/skills | `.agents/` + `.cursor/skills/` | project | No | No | Valid | OK |
| review-animations | emilkowalski/skills | `.agents/` + `.cursor/skills/` | project | No | No | Valid | OK |
| improve-animations | emilkowalski/skills | `.agents/` + `.cursor/skills/` | project | No | No | Valid | OK |
| find-animation-opportunities | emilkowalski/skills | `.agents/` + `.cursor/skills/` | project | No | No | Valid | OK |
| animation-vocabulary | emilkowalski/skills | `.agents/` + `.cursor/skills/` | project | No | No | Valid | OK |
| pick-ui-library | emilkowalski/skills | `.agents/` + `.cursor/skills/` | project | No | No | Valid | OK |

**Failed / skipped:** none of the requested confirmed skill names.  
**Not installed (by policy):** `prototype` (present in emilkowalski/skills but not requested).  
**Symlinks:** none (copies only). No broken links.

**Tracking file:** `skills-lock.json` (project root) — records Anthropic / Taste / Emil hashes. Impeccable and ui-ux-pro-max are outside that lock file (different installers).

---

## 8. Files created or modified (skills only)

- `.cursor/hooks.json` (new)
- `.cursor/skills/**` (impeccable, ui-ux-pro-max, + mirrored skills)
- `.cursor/agents/impeccable-*.md`
- `.agents/skills/**`
- `.claude/skills/impeccable/`, `.claude/settings.local.json`
- `.github/skills/impeccable/`, `.github/agents/`, `.github/hooks/`
- `skills-lock.json`
- `.cursor-design-install-backup/pre-install-20260806/**`

**Not modified:** `app/`, `components/`, `lib/`, `prisma/`, `package.json`, lockfiles, DB.

---

## 9. Hooks installed

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "command": "[ ! -f \".cursor/skills/impeccable/scripts/hook-before-edit.mjs\" ] || node \".cursor/skills/impeccable/scripts/hook-before-edit.mjs\"",
        "timeout": 5
      }
    ]
  }
}
```

Local UI anti-pattern gate only. Does not upload secrets. Optional image-generation scripts under Impeccable call OpenAI **only if invoked** — not run during install.

---

## 10. Security observations

| Source | Assessment |
|--------|------------|
| anthropics/skills | skills.sh: Gen Safe / Socket 0 / Snyk Low |
| Leonxlnx/taste-skill | Same |
| emilkowalski/skills | Same |
| pbakaus/impeccable | Official repo; hook is local detector; live-server is local; `generate-image.mjs` can call OpenAI if used |
| uipro-cli | Official npm package; installs local Python search scripts + CSV data |

No install step deleted app files, modified git config, or changed ERP dependencies.

---

## 11. Failed or skipped installations

- Legacy impeccable flag syntax not used (CLI changed); equivalent project install succeeded.
- `prototype` intentionally not installed.
- ui-ux-pro-max Cursor copy lacks YAML frontmatter (template limitation).

---

## 12. Manual actions still required

1. **Reload Cursor** / restart the agent session so new skills and `.cursor/hooks.json` are picked up.
2. Enable Cursor **Hooks** if the IDE prompts for project hooks approval (`preToolUse` impeccable gate).
3. Optional: run `/impeccable init` later to create `PRODUCT.md` / `DESIGN.md` (not done during this install task).
4. Optional: add YAML frontmatter to ui-ux-pro-max `SKILL.md` if a harness requires it.

---

## 13. How to update each skill

```bash
npx impeccable update
npx skills@latest update -p -y
npx --yes uipro-cli update --ai cursor
```

---

## 14. How to remove each skill

```bash
npx skills@latest remove --skill <name> --agent cursor -y
# or delete directories under .agents/skills/<name> and .cursor/skills/<name>
npx impeccable  # use uninstall/docs; or remove .cursor/skills/impeccable + hooks.json entry
rm -rf .cursor/skills/ui-ux-pro-max
```

---

## 15. How to restore pre-installation configuration

```bash
# From project root
rm -rf .cursor .agents skills-lock.json
# Restore backup (adjusts Cursor/Claude skill dirs only)
cp -a .cursor-design-install-backup/pre-install-20260806/dot-cursor .cursor
cp -a .cursor-design-install-backup/pre-install-20260806/dot-claude/.claude-content-as-needed .
# Remove impeccable github agents if undesired:
rm -rf .github/agents .github/hooks .github/skills/impeccable
```

Also remove `.claude/skills/impeccable` if restoring Claude tree to pre-impeccable.

---

## 16. Recommended skill usage order for this ERP

1. **redesign-existing-projects** — audit existing ERP; preserve operational density  
2. **impeccable** — detect inconsistencies / anti-patterns (`Operate` mode for ERP)  
3. **ui-ux-pro-max** — research / reinforce design system (tables, density, a11y)  
4. **frontend-design** — implement polished components without generic AI look  
5. **design-taste-frontend** — **limited** typography / spacing / hierarchy / anti-generic review only — **do not** convert tables to marketing cards or reduce information density  
6. **emil-design-eng** — interaction and fine detail  
7. **find-animation-opportunities** — justified motion only  
8. **improve-animations** — improve existing motion  
9. **review-animations** — final strict motion review  

**ERP constraint:** Prefer `Operate` mode (Impeccable). Never let taste/redesign skills turn the ERP into a landing page.

---

## Verification command snapshot

```text
npx skills list --agent cursor
# Lists: animation-vocabulary, design-taste-frontend, emil-design-eng,
# find-animation-opportunities, frontend-design, improve-animations,
# pick-ui-library, redesign-existing-projects, review-animations
# (+ impeccable / ui-ux-pro-max under .cursor/skills and .claude/skills)
```

**Cursor reload required:** Yes  
**Manual settings:** Approve project hooks if prompted  
**This file:** `CURSOR_DESIGN_SKILLS_INSTALLATION.md` (project root)

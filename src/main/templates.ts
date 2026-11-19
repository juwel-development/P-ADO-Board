// Description templates stored as markdown files with a tiny front matter header:
//
//   ---
//   name: User story
//   types: User Story, Product Backlog Item
//   ---
//   ## Objective
//   …
//
// Pure Node (no Electron) so it can be tested in isolation; the folder is passed in.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DescriptionTemplate } from '@shared/ipc'

const ID = /^[a-z0-9][a-z0-9-]{0,80}\.md$/

export function parseTemplate(id: string, text: string): DescriptionTemplate {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  const header = m?.[1] ?? ''
  const field = (k: string) => header.match(new RegExp(`^${k}\\s*:\\s*(.*)$`, 'mi'))?.[1].trim() ?? ''
  return {
    id,
    name: field('name') || id.replace(/\.md$/, '').replace(/-/g, ' '),
    types: field('types')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    body: (m ? m[2] : text).replace(/^\r?\n/, '')
  }
}

export function serializeTemplate(t: Omit<DescriptionTemplate, 'id'>): string {
  const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()
  return `---\nname: ${oneLine(t.name)}\ntypes: ${t.types.map(oneLine).join(', ')}\n---\n${t.body.replace(/\s+$/, '')}\n`
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'template'

export function listTemplates(dir: string): DescriptionTemplate[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => ID.test(f))
    .map((f) => parseTemplate(f, readFileSync(join(dir, f), 'utf8')))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function saveTemplate(dir: string, t: Omit<DescriptionTemplate, 'id'> & { id?: string }): DescriptionTemplate {
  if (!t.name.trim()) throw new Error('A template needs a name.')
  mkdirSync(dir, { recursive: true })
  let id = t.id
  if (id !== undefined && !ID.test(id)) throw new Error('Invalid template id.')
  if (!id) {
    const base = slug(t.name)
    id = `${base}.md`
    for (let i = 2; existsSync(join(dir, id)); i++) id = `${base}-${i}.md`
  }
  writeFileSync(join(dir, id), serializeTemplate(t), 'utf8')
  return parseTemplate(id, readFileSync(join(dir, id), 'utf8'))
}

export function removeTemplate(dir: string, id: string): void {
  if (!ID.test(id)) throw new Error('Invalid template id.')
  rmSync(join(dir, id), { force: true })
}

/** Writes the starter templates the first time the folder is created. */
export function seedTemplates(dir: string): void {
  if (existsSync(dir)) return
  mkdirSync(dir, { recursive: true })
  for (const t of STARTERS) saveTemplate(dir, t)
}

const STARTERS: Omit<DescriptionTemplate, 'id'>[] = [
  {
    name: 'User story',
    types: ['User Story', 'Product Backlog Item'],
    body: `## Objective
As a **[role]**,
I want **[capability]**,
so that **[benefit]**.

## In Scope
- 

## Out of Scope
- 

## Preconditions
- 

## Technical hints
- 

## Non-functional requirements
- 

## Scenarios
**Scenario 1**
**GIVEN** [context]
**WHEN** [action]
**THEN** [outcome]

## Notes
- `
  },
  {
    name: 'Bug report',
    types: ['Bug'],
    body: `## Summary
[one sentence: what is broken]

## Steps to reproduce
1. 
2. 
3. 

## Expected
- 

## Actual
- 

## Environment
- Stage:
- Version:

## Logs / screenshots
`
  },
  {
    name: 'Spike',
    types: [],
    body: `## Question
[what do we need to find out?]

## Timebox
[e.g. 2 days]

## Approach
- 

## Outcome
_Fill in when done: findings, decision, follow-up items._
`
  }
]

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'

interface Element {
  type: string
  props: {
    id?: string
    type?: string
    children?: unknown
    disabled?: boolean
    checked?: boolean
    onChange?: (event: unknown) => void
    onClick?: () => void
  }
}
const preview = {
  createdAt: '2026-10-30T00:00:00Z',
  sourceProjectRef: 'source',
  targetProjectRef: 'target',
  counts: {},
  fileCount: 0,
  fileBytes: 0,
  confirmation: 'RESTORE target',
  token: 'signed-preview',
  adminMapping: {
    sourceId: 'source-admin',
    targetId: 'target-admin',
    email: 'admin@example.test'
  }
}
const code = ts.transpileModule(
  readFileSync('components/FullWebsiteBackup.tsx', 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    }
  }
).outputText

// Run actual JSX and handlers, replacing only hooks and network boundaries.
function harness(mapping = true) {
  const failures: Array<'network' | 'non-json'> = []
  const states: unknown[] = []
  const requests: FormData[] = []
  let cursor = 0
  const exports: { default?: () => Element } = {}
  const jsx = (type: string, props: Element['props']) => ({ type, props })
  runInNewContext(code, {
    exports,
    FormData,
    Date,
    Error,
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (name === 'react')
        return {
          useEffect() {},
          useState(initial: unknown) {
            const index = cursor++
            if (!(index in states))
              states[index] =
                index === 0
                  ? {
                      enabled: true,
                      sqlConfigured: true,
                      storageConfigured: true,
                      operatorConfigured: true,
                      maxBytes: 1024
                    }
                  : initial
            return [
              states[index],
              (value: unknown) => {
                states[index] = value
              }
            ]
          }
        }
      if (name === '@/lib/i18n/I18nProvider')
        return { useI18n: () => ({ locale: 'en' }) }
      if (name === 'lucide-react') return {}
      throw new Error(`Unexpected import: ${name}`)
    },
    fetch: async (_url: string, options: { body: FormData }) => {
      requests.push(options.body)
      const failure = failures.shift()
      if (failure === 'network') throw new Error('Failed to fetch')
      if (failure === 'non-json')
        return {
          ok: false,
          json: async () => {
            throw new Error('Unexpected token <')
          }
        }
      return {
        ok: true,
        json: async () =>
          options.body.get('action') === 'inspect'
            ? {
                ...preview,
                adminMapping: mapping ? preview.adminMapping : null
              }
            : { files: 0, users: 1, adminMapped: mapping, requiresLogin: false }
      }
    }
  })
  function elements() {
    cursor = 0
    const found: Element[] = []
    const visit = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object' && 'props' in value) {
        const element = value as Element
        found.push(element)
        visit(element.props.children)
      }
    }
    visit(exports.default!())
    return found
  }
  const byId = (id: string) => {
    const element = elements().find((node) => node.props.id === id)
    assert.ok(element, `Element ${id} exists`)
    return element
  }
  const button = (text: string) => {
    const element = elements().find(
      (node) =>
        node.type === 'button' &&
        JSON.stringify(node.props.children).includes(text)
    )
    assert.ok(element, `Button ${text} exists`)
    return element
  }
  const checkbox = () =>
    elements().find((node) => node.props.type === 'checkbox')
  const change = (id: string, value: unknown) =>
    byId(id).props.onChange!({ target: { value } })
  async function click(text: string) {
    button(text).props.onClick!()
    // Drain the handler's fetch/json continuations before the next render.
    for (let i = 0; i < 8; i++) await Promise.resolve()
  }
  async function inspect() {
    change('website-backup-password', 'fictional-passphrase')
    byId('website-backup-file').props.onChange!({
      target: { files: [new File(['archive'], 'fixture.ftbackup')] }
    })
    await click('Inspect file')
  }
  return {
    elements,
    byId,
    button,
    checkbox,
    change,
    click,
    inspect,
    requests,
    failures
  }
}

test('mapping checkbox and exact confirmation both gate restore, while ordinary restores need no checkbox', async () => {
  const ui = harness()
  await ui.inspect()
  assert.equal(ui.checkbox()?.props.checked, false)
  assert.ok(JSON.stringify(ui.elements()).includes('source-admin'))
  assert.ok(JSON.stringify(ui.elements()).includes('target-admin'))
  assert.ok(JSON.stringify(ui.elements()).includes('admin@example.test'))
  assert.equal(ui.button('Restore to this project').props.disabled, true)
  ui.change('website-backup-confirmation', preview.confirmation)
  assert.equal(ui.button('Restore to this project').props.disabled, true)
  ui.checkbox()!.props.onChange!({ target: { checked: true } })
  assert.equal(ui.button('Restore to this project').props.disabled, false)
  ui.change('website-backup-confirmation', `${preview.confirmation} `)
  assert.equal(ui.button('Restore to this project').props.disabled, true)
  ui.change('website-backup-confirmation', preview.confirmation)
  ui.checkbox()!.props.onChange!({ target: { checked: false } })
  assert.equal(ui.button('Restore to this project').props.disabled, true)

  const ordinary = harness(false)
  await ordinary.inspect()
  assert.equal(ordinary.checkbox(), undefined)
  ordinary.change('website-backup-confirmation', preview.confirmation)
  assert.equal(ordinary.button('Restore to this project').props.disabled, false)
})

test('restore request forwards explicit consent values with the inspected token and confirmation', async () => {
  for (const consent of [false, true]) {
    const ui = harness()
    await ui.inspect()
    ui.change('website-backup-confirmation', preview.confirmation)
    ui.checkbox()!.props.onChange!({ target: { checked: consent } })
    // Invoke the handler directly for false as well: the server must receive
    // false even if a caller bypasses the disabled browser button.
    await ui.click('Restore to this project')
    const request = ui.requests.at(-1)!
    assert.equal(request.get('action'), 'restore')
    assert.equal(request.get('acceptAdminMapping'), String(consent))
    assert.equal(request.get('token'), preview.token)
    assert.equal(request.get('confirmation'), preview.confirmation)
    assert.equal(request.get('password'), 'fictional-passphrase')
    assert.ok(request.get('file') instanceof File)
  }
})

test('new inspection, password and file changes clear prior mapping consent', async () => {
  const ui = harness()
  await ui.inspect()
  ui.checkbox()!.props.onChange!({ target: { checked: true } })
  await ui.click('Inspect file')
  assert.equal(ui.checkbox()?.props.checked, false)
  for (const field of ['website-backup-password', 'website-backup-file']) {
    ui.checkbox()!.props.onChange!({ target: { checked: true } })
    ui.change('website-backup-confirmation', preview.confirmation)
    ui.byId(field).props.onChange!({
      target: {
        value: 'new-fictional-passphrase',
        files: [new File(['new archive'], 'new.ftbackup')]
      }
    })
    assert.equal(ui.checkbox(), undefined)
    assert.equal(
      ui
        .elements()
        .some((node) => node.props.id === 'website-backup-confirmation'),
      false
    )
    await ui.click('Inspect file')
    assert.equal(ui.checkbox()?.props.checked, false)
    assert.equal(ui.button('Restore to this project').props.disabled, true)
  }
})

test('failed reinspection clears old preview and consent rather than leaving restore enabled', async () => {
  const ui = harness()
  await ui.inspect()
  ui.change('website-backup-confirmation', preview.confirmation)
  ui.checkbox()!.props.onChange!({ target: { checked: true } })
  ui.failures.push('network')
  await ui.click('Inspect file')
  assert.equal(ui.checkbox(), undefined)
  assert.equal(
    ui
      .elements()
      .some((node) => node.props.id === 'website-backup-confirmation'),
    false
  )
  assert.ok(JSON.stringify(ui.elements()).includes('Failed to fetch'))
})

test('lost or non-JSON restore responses warn about unknown COMMIT before any retry', async () => {
  for (const failure of ['network', 'non-json'] as const) {
    const ui = harness()
    await ui.inspect()
    ui.change('website-backup-confirmation', preview.confirmation)
    ui.checkbox()!.props.onChange!({ target: { checked: true } })
    ui.failures.push(failure)
    await ui.click('Restore to this project')
    assert.equal(ui.checkbox(), undefined)
    const output = JSON.stringify(ui.elements())
    assert.ok(output.includes('outcome is unconfirmed'))
    assert.ok(output.includes('before retrying'))
    assert.ok(output.includes('database may have committed'))
  }
})

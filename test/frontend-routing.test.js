import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { serveFrontend } from '../src/handlers/frontend.js'

const html = '<!doctype html><html><head><title>Monitor</title></head><body><div id="app"></div></body></html>'
const env = {
  ASSETS: {
    fetch: async (request) => new URL(request.url).pathname === '/dashboard.html'
      ? new Response(html)
      : new Response('Not Found', { status: 404 })
  }
}

for (const path of ['/', '/admin', '/admin?github_error=denied', '/server/node-1?apiIndex=1']) {
  test(`direct navigation and refresh serve the app at ${path}`, async () => {
    const response = await serveFrontend(new Request(`https://monitor.example${path}`), env, {})
    assert.equal(response.status, 200)
    assert.match(response.headers.get('Content-Type'), /text\/html/)
    assert.match(await response.text(), /id="app"/)
    assert.equal(response.headers.get('Location'), null)
  })
}

test('admin remains the built-in frontend when a custom theme is configured', async () => {
  const response = await serveFrontend(new Request('https://monitor.example/admin'), env, {
    theme_url: 'https://github.com/example/theme/tree/main'
  })
  assert.equal(response.status, 200)
  assert.match(await response.text(), /id="app"/)
})

test('Workers default to history routing; hash mode is opt-in for the standalone static build', async () => {
  const source = await readFile(new URL('../src/frontend/router/index.js', import.meta.url), 'utf8')
  assert.match(source, /VITE_ROUTER_MODE === 'hash'\s*\? createWebHashHistory\(\)\s*: createWebHistory\(import.meta.env.BASE_URL\)/)
})

test('UI links and startup no longer generate or translate legacy hash routes', async () => {
  for (const file of [
    'main.js', 'components/TerminalHeader.vue', 'views/Dashboard.vue',
    'views/admin/components/ServerTable.vue'
  ]) {
    const source = await readFile(new URL(`../src/frontend/${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /#\/|#admin(?:['"`?])|location\.hash|bridgeAdminPathToHashRoute/)
  }
})

test('admin trailing-slash redirect preserves the query without creating a hash', async () => {
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')
  const block = source.match(/if \(method === 'GET' && path === '\/admin\/'\) \{([\s\S]*?)\n    \}/)?.[1]
  assert.ok(block)
  // Run the exact redirect body without loading Workers-only Durable Objects in Node.
  const redirect = new Function('request', block)
  const response = redirect(new Request('https://monitor.example/admin/?github_error=denied'))
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('Location'), 'https://monitor.example/admin?github_error=denied')
})

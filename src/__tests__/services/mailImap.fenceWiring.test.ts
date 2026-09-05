import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// Source wiring checks complement JVM kernel tests. They do NOT execute
// SharedPreferences, two plugin instances, an APK or a physical device.
const java = readFileSync('android/app/src/main/java/com/arty/app/MailImapPlugin.java', 'utf8')
it('both persistent add/remove paths pass tickets captured before the executor', () => {
  for (const method of ['addAccount', 'removeAccount']) {
    const body = java.split(`public void ${method}(PluginCall call)`)[1]!.split('@PluginMethod')[0]!
    expect(body.indexOf('MailScopeWriteFence.capture(scope)')).toBeGreaterThan(0)
    expect(body.indexOf('MailScopeWriteFence.capture(scope)')).toBeLessThan(body.indexOf('executor.execute'))
    expect(body).toMatch(/saveAccounts\(scope, (?:accounts|kept), ticket\)/)
  }
  const save = java.split('private void saveAccounts(')[1]!.split('private JSONObject')[0]!
  expect(save).toContain('MailScopeWriteFence.write(scope, ticket,')
  expect(save).toContain('.commit()'); expect(save).not.toContain('.apply()')
})
it('old and versioned clear share the same persistent fenced path and retain the shared keystore alias', () => {
  expect(java).toContain('clearScope(call, false)'); expect(java).toContain('clearScope(call, true)')
  const clear = java.split('private void clearScope(')[1]!.split('@PluginMethod')[0]!
  expect(clear.indexOf('beginClear(scope, terminal)')).toBeLessThan(clear.indexOf('executor.execute'))
  expect(clear).toContain('MailScopeWriteFence.clear(scope, ticket, () -> prefs().edit().remove(scopeKey(scope)).commit())')
  expect(clear).toContain('ret.put("protocol", 1)')
  expect(java).not.toContain('deleteEntry(')
})

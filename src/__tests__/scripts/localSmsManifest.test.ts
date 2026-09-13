// @vitest-environment node
import { afterAll, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const dir = mkdtempSync(join(tmpdir(), 'arty-sms-manifest-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const source = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')
const base = [...source.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(m => m[1]).concat([
  'android.permission.ACCESS_NETWORK_STATE', 'android.permission.RECEIVE_BOOT_COMPLETED', 'android.permission.WAKE_LOCK',
  'com.arty.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION', 'com.google.android.c2dm.permission.RECEIVE',
])
function check(extra: string[], local = false) {
  const input = join(dir, 'permissions.txt')
  writeFileSync(input, [...new Set([...base, ...extra])].map(p => `uses-permission: name='${p}'`).join('\n'))
  return spawnSync(process.execPath, ['scripts/check-android-manifest.mjs', input, ...(local ? ['--local-sms'] : [])], { encoding: 'utf8' }).status
}
it('keeps Play/default builds SMS-free', () => { expect(check([])).toBe(0); expect(check(['android.permission.READ_SMS'])).toBe(1) })
it('requires READ_SMS in the opt-in APK', () => { expect(check([], true)).toBe(1); expect(check(['android.permission.READ_SMS'], true)).toBe(0) })
it('never permits sending or background SMS receivers', () => {
  for (const permission of ['SEND_SMS', 'RECEIVE_SMS']) expect(check(['android.permission.READ_SMS', `android.permission.${permission}`], true)).toBe(1)
})

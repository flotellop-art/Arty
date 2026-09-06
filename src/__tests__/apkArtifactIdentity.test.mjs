// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import {
  APK_CANDIDATE, APK_RECEIPT, APK_SOURCE, ASSET_LINKS, checkAssetLinks,
  checkedToolOutput, inspectApk, parseApkBadging, parseExpectedIdentity,
  parseSignerCertificate, resolveAndroidTools, runBoundedTool, verifyReleaseApk,
} from '../../scripts/verify-release-apk.mjs'

const CERT = '26'.repeat(32)
const OTHER = 'ab'.repeat(32)
const EXPECTED = { packageName: 'com.arty.app', versionCode: 100, versionName: '1.0.99' }
const GRADLE = 'applicationId "com.arty.app"\nversionCode 100\nversionName "1.0.99"\n'
const CAPACITOR = "appId: 'com.arty.app',\n"
const BADGING = "package: name='com.arty.app' versionCode='100' versionName='1.0.99' platformBuildVersionCode='36'\n"
const signature = (prefix = 'Signer #1', cert = CERT) => `Verifies\nNumber of signers: 1\n${prefix} certificate SHA-256 digest: ${cert}\n`
const assetEntries = () => [{ relation: ['delegate_permission/common.handle_all_urls'], target: {
  namespace: 'android_app', package_name: 'com.arty.app', sha256_cert_fingerprints: [CERT.match(/../g).join(':')],
} }]
const assets = () => JSON.stringify(assetEntries())
const owned = new Set()
const scratchParent = realpathSync(tmpdir())
afterEach(() => {
  for (const root of owned) {
    // Only unique test-owned children of the resolved system temp directory.
    if (dirname(resolve(root)) !== scratchParent || !resolve(root).startsWith(`${scratchParent}${sep}arty-apk-test-`)) throw new Error('Unsafe fixture cleanup')
    rmSync(root, { recursive: true, force: true })
  }
  owned.clear()
})

function fixture() {
  const root = mkdtempSync(join(scratchParent, 'arty-apk-test-')); owned.add(root)
  const write = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value) }
  write(APK_SOURCE, 'synthetic bytes, NOT a real signed APK')
  write('android/app/build.gradle', GRADLE)
  write('capacitor.config.ts', CAPACITOR)
  write(ASSET_LINKS, assets())
  write('sdk/build-tools/37.0.0/lib/apksigner.jar', 'synthetic-tool')
  write(`sdk/build-tools/37.0.0/${process.platform === 'win32' ? 'aapt2.exe' : 'aapt2'}`, 'synthetic-tool')
  write(`java/bin/${process.platform === 'win32' ? 'java.exe' : 'java'}`, 'synthetic-tool')
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'flotellop-art/Arty',
    GITHUB_SHA: 'c'.repeat(40), GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '2',
    ANDROID_HOME: join(root, 'sdk'), JAVA_HOME: join(root, 'java') }
  const runTool = vi.fn((_path, args) => args.includes('badging') ? BADGING : signature('V2 Signer:'))
  return { root, env, write, runTool }
}

describe('APK identity parsing refuses ambiguous or foreign evidence', () => {
  it('reads independent literal source declarations', () => {
    expect(parseExpectedIdentity(GRADLE, CAPACITOR)).toEqual(EXPECTED)
  })
  it.each([
    [GRADLE + 'applicationId dynamic()\n', CAPACITOR],
    [GRADLE, CAPACITOR + 'appId: computeId(),\n'],
    [GRADLE.replace('100', '2100000001'), CAPACITOR],
    [GRADLE.replace('com.arty.app', 'com.other.app'), CAPACITOR],
    [GRADLE.replace('100', 'currentVersion'), CAPACITOR],
  ])('rejects ambiguous/dynamic/divergent sources', (gradle, capacitor) => {
    expect(() => parseExpectedIdentity(gradle, capacitor)).toThrow()
  })
  it('reads compiled package and separate versions', () => expect(parseApkBadging(BADGING)).toEqual(EXPECTED))
  it.each([BADGING + BADGING, BADGING.replace("versionCode='100'", "versionCode='100' versionCode=''"), BADGING + 'application-debuggable\n', BADGING.replace('100', '0'), ''])('rejects incomplete/duplicate/debug badging', (text) => {
    expect(() => parseApkBadging(text)).toThrow()
  })
  it.each(['Signer #1', 'V2 Signer:', 'V3.1 Signer:'])('accepts explicit supported certificate format %s', (prefix) => {
    expect(parseSignerCertificate(signature(prefix))).toBe(CERT)
  })
  it('accepts the same certificate repeated for two verified schemes, not two identities', () => {
    expect(parseSignerCertificate(signature('V2 Signer:') + `V3 Signer: certificate SHA-256 digest: ${CERT}\n`)).toBe(CERT)
  })
  it.each([
    signature().replace('signers: 1', 'signers: 2'),
    signature() + `Signer #2 certificate SHA-256 digest: ${CERT}\n`,
    signature() + `V3 Signer: certificate SHA-256 digest: ${OTHER}\n`,
    signature().replace('certificate SHA-256', 'public key SHA-256'),
    signature('SourceStamp Signer:'),
    signature().replace(CERT, 'abcd'),
    signature().replace('Verifies\n', ''),
    signature() + 'Number of signers: 1\n',
  ])('rejects incomplete or ambiguous signing output', (text) => expect(() => parseSignerCertificate(text)).toThrow())
  it('matches only the checkout Android target and exact relation', () => expect(() => checkAssetLinks(assets(), 'com.arty.app', CERT)).not.toThrow())
  it.each(['foreign-cert', 'namespace', 'package', 'relation', 'malformed-hash', 'duplicate-target', 'duplicate-fingerprint'])('rejects bad assetlinks: %s', (kind) => {
    const entries = assetEntries()
    if (kind === 'namespace') entries[0].target.namespace = 'web'
    if (kind === 'package') entries[0].target.package_name = 'com.other.app'
    if (kind === 'relation') entries[0].relation = ['delegate_permission/common.get_login_creds']
    if (kind === 'malformed-hash') entries[0].target.sha256_cert_fingerprints = ['invalid']
    if (kind === 'duplicate-target') entries.push(entries[0])
    if (kind === 'duplicate-fingerprint') entries[0].target.sha256_cert_fingerprints.push(entries[0].target.sha256_cert_fingerprints[0])
    expect(() => checkAssetLinks(JSON.stringify(entries), 'com.arty.app', kind === 'foreign-cert' ? OTHER : CERT)).toThrow()
  })
})

describe('tool failures cannot be laundered into a valid signature', () => {
  it.each([
    { status: 1 }, { status: 0, signal: 'SIGTERM' }, { status: 0, error: new Error('ETIMEDOUT: PRIVATE DN') },
    { status: 0, stdout: 'x'.repeat(1024 * 1024 + 1) }, { status: 0, stderr: 'x'.repeat(1024 * 1024 + 1) },
  ])('rejects failure, timeout and truncation even with a valid digest', (override) => {
    expect(() => checkedToolOutput({ status: 0, stdout: signature(), stderr: '', ...override })).toThrow(/tool_(execution_failed|output_invalid)/)
  })
  it('executes a real failing process but exposes no stdout/stderr or certificate DN', () => {
    expect(() => runBoundedTool(process.execPath, ['-e', "console.log('PRIVATE DN'); console.error('PRIVATE STDERR'); process.exit(1)"])).toThrow('tool_execution_failed')
  })
  it('bounds output from a real subprocess', () => {
    expect(() => runBoundedTool(process.execPath, ['-e', "process.stdout.write('x'.repeat(2*1024*1024))"])).toThrow('tool_execution_failed')
  })
})

describe('candidate/receipt lifecycle (tools synthetic, no real distribution)', () => {
  it('copies and verifies exactly the candidate passed to Firebase; emits only allowlisted evidence', () => {
    const f = fixture()
    const receipt = verifyReleaseApk(f)
    expect(receipt.status).toBe('artifact-verified')
    expect(receipt.provenance).toMatchObject({ source: 'github-actions-checkout', commit: f.env.GITHUB_SHA, runId: '123456', runAttempt: '2' })
    expect(receipt.artifact).toMatchObject({ ...EXPECTED, path: APK_CANDIDATE, signatureVerified: true, signerSha256: CERT,
      assetLinks: { source: 'checkout-file', path: ASSET_LINKS, matches: true } })
    expect(readFileSync(join(f.root, APK_CANDIDATE))).toEqual(readFileSync(join(f.root, APK_SOURCE)))
    expect(f.runTool.mock.calls.every(([, args]) => args.at(-1) === join(f.root, APK_CANDIDATE))).toBe(true)
    const json = readFileSync(join(f.root, APK_RECEIPT), 'utf8')
    expect(JSON.parse(json)).toEqual(receipt)
    expect(json).not.toMatch(/private.key|DN|google-services|EMAIL|SECRET|PASSWORD|stdout|stderr/i)
  })
  it.each(['packageName', 'versionCode', 'versionName'])('rejects compiled %s mismatch and creates no receipt', (field) => {
    const f = fixture()
    f.runTool.mockImplementation((_path, args) => {
      if (!args.includes('badging')) return signature()
      return field === 'packageName' ? BADGING.replace('com.arty.app', 'com.other.app')
        : field === 'versionCode' ? BADGING.replace('100', '101') : BADGING.replace('1.0.99', '1.0.98')
    })
    expect(() => verifyReleaseApk(f)).toThrow(`apk_${field}_mismatch`)
    expect(existsSync(join(f.root, APK_RECEIPT))).toBe(false)
  })
  it('refuses altered candidate bytes between tools and final hash', () => {
    const f = fixture()
    f.runTool.mockImplementation((_path, args) => {
      if (args.includes('badging')) { writeFileSync(args.at(-1), 'changed'); return BADGING }
      return signature()
    })
    expect(() => verifyReleaseApk(f)).toThrow('apk_changed_during_verification')
    expect(existsSync(join(f.root, APK_RECEIPT))).toBe(false)
  })
  it('refuses an old receipt/candidate directory instead of reusing it', () => {
    const f = fixture(); f.write(APK_RECEIPT, '{"status":"old"}')
    expect(() => verifyReleaseApk(f)).toThrow('candidate_directory_already_exists')
    expect(f.runTool).not.toHaveBeenCalled()
    expect(readFileSync(join(f.root, APK_RECEIPT), 'utf8')).toBe('{"status":"old"}')
  })
  it('refuses invalid UTF-8 even in an unused JSON value; no text-normalized file hash', () => {
    const f = fixture()
    const [before, after] = JSON.stringify([{ ...assetEntries()[0], note: 'PLACEHOLDER' }]).split('PLACEHOLDER')
    f.write(ASSET_LINKS, Buffer.concat([Buffer.from(before), Buffer.from([255]), Buffer.from(after)]))
    expect(() => verifyReleaseApk(f)).toThrow('assetlinks_encoding_invalid')
    expect(f.runTool).not.toHaveBeenCalled()
    expect(existsSync(join(f.root, APK_RECEIPT))).toBe(false)
  })
  it('hashes exact valid assetlinks bytes including a UTF-8 BOM, not decoded text', () => {
    const f = fixture()
    const bytes = Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(JSON.stringify(assetEntries(), null, 2) + '\r\n')])
    f.write(ASSET_LINKS, bytes)
    const receipt = verifyReleaseApk(f)
    expect(receipt.artifact.assetLinks.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(receipt.artifact.assetLinks.sha256).not.toBe(createHash('sha256').update(new TextDecoder().decode(bytes)).digest('hex'))
  })
  it('does not claim current provenance for an arbitrary local invocation', () => {
    const f = fixture(); delete f.env.GITHUB_ACTIONS
    expect(() => verifyReleaseApk(f)).toThrow('ci_provenance_missing')
    expect(existsSync(join(f.root, APK_CANDIDATE))).toBe(false)
  })
  it('distinguishes APKs with identical displayed versions by their byte hashes', () => {
    const a = fixture(); const b = fixture(); b.write(APK_SOURCE, 'different synthetic APK bytes')
    const first = verifyReleaseApk(a); const second = verifyReleaseApk(b)
    expect(first.artifact.versionName).toBe(second.artifact.versionName)
    expect(first.artifact.versionCode).toBe(second.artifact.versionCode)
    expect(first.artifact.sha256).not.toBe(second.artifact.sha256)
  })
  it('refuses a symlink candidate directory even if its target is test-owned', () => {
    const f = fixture(); const other = fixture()
    symlinkSync(other.root, join(f.root, dirname(APK_CANDIDATE)), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => verifyReleaseApk(f)).toThrow('symlink_not_allowed')
    expect(f.runTool).not.toHaveBeenCalled()
  })
  it('chooses SDK directories numerically and refuses missing tools', () => {
    const f = fixture(); f.write('sdk/build-tools/9.0.0/placeholder', '')
    expect(resolveAndroidTools(f.env).buildToolsVersion).toBe('37.0.0')
    f.write('sdk/build-tools/38.0.0/placeholder', '')
    expect(() => resolveAndroidTools(f.env)).toThrow()
  })
  it('can inspect a candidate without inventing CI provenance', () => {
    const f = fixture()
    const result = inspectApk({ apk: join(f.root, APK_SOURCE), expected: EXPECTED, assetLinks: Buffer.from(assets()), tools: resolveAndroidTools(f.env), runTool: f.runTool })
    expect(result).not.toHaveProperty('commit')
    expect(result).not.toHaveProperty('provenance')
  })
})

describe('Firebase workflow evidence chain', () => {
  it('gates upload on successful verification, uses the same candidate and only publishes the JSON after Firebase', () => {
    const workflow = readFileSync('.github/workflows/android-firebase.yml', 'utf8')
    const steps = workflow.split(/\n      - /).slice(1)
    const build = steps.findIndex((step) => step.startsWith('name: Build signed release APK'))
    const verify = steps.findIndex((step) => step.startsWith('name: Verify exact APK candidate identity'))
    const distribute = steps.findIndex((step) => step.startsWith('name: Distribute to Firebase App Distribution'))
    const upload = steps.findIndex((step) => step.startsWith('name: Upload verified APK identity receipt'))
    for (const index of [build, verify, distribute, upload]) expect(index).toBeGreaterThanOrEqual(0)
    expect(verify).toBe(build + 1)
    expect(distribute).toBe(verify + 1)
    expect(upload).toBe(distribute + 1)
    expect(steps[verify]).toContain('run: node scripts/verify-release-apk.mjs')
    expect(steps[distribute].split(/\r?\n/).filter((line) => /^\s*file:/.test(line)).map((line) => line.trim())).toEqual([`file: ${APK_CANDIDATE}`])
    expect(steps[upload].split(/\r?\n/).filter((line) => /^\s*path:/.test(line)).map((line) => line.trim())).toEqual([`path: ${APK_RECEIPT}`])
    expect(steps[upload]).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02')
    expect(steps[upload]).toContain('if-no-files-found: error')
    for (const step of steps.slice(verify, upload + 1)) expect(step).not.toMatch(/continue-on-error|if:|always\(|cap sync|gradlew|assembleRelease|apksigner sign/)
    expect(steps[upload]).not.toMatch(/path:.*\*|\.apk\s*$|\.keystore|google-services\.json/m)
    expect(workflow).not.toContain('pull_request_target')
  })
})

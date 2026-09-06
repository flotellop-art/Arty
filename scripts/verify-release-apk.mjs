/** Verify the exact Firebase APK candidate; never signs, installs or uploads. */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync,
  readdirSync, realpathSync, writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const APK_SOURCE = 'android/app/build/outputs/apk/release/app-release.apk'
export const APK_CANDIDATE = 'android/app/build/outputs/verified-release/app-release.apk'
export const APK_RECEIPT = 'android/app/build/outputs/verified-release/identity-receipt.json'
export const ASSET_LINKS = 'public/.well-known/assetlinks.json'
const MAX_APK_BYTES = 256 * 1024 * 1024
const MAX_TOOL_OUTPUT = 1024 * 1024
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export class ApkVerificationError extends Error {
  constructor(code) { super(code); this.name = 'ApkVerificationError'; this.code = code }
}
const fail = (code) => { throw new ApkVerificationError(code) }

function uniqueCapture(text, pattern, code) {
  const matches = [...text.matchAll(pattern)]
  if (matches.length !== 1) fail(code)
  return matches[0][1]
}

export function parseExpectedIdentity(gradle, capacitor) {
  for (const field of ['applicationId', 'versionCode', 'versionName']) {
    if ([...gradle.matchAll(new RegExp(`^\\s*${field}\\b`, 'gm'))].length !== 1) fail('source_declaration_ambiguous')
  }
  if ([...capacitor.matchAll(/^\s*appId\s*:/gm)].length !== 1) fail('source_declaration_ambiguous')
  const packageName = uniqueCapture(gradle, /^\s*applicationId\s+["']([A-Za-z][A-Za-z0-9_.]+)["']\s*$/gm, 'gradle_package_ambiguous')
  const capacitorId = uniqueCapture(capacitor, /^\s*appId:\s*["']([A-Za-z][A-Za-z0-9_.]+)["'],?\s*$/gm, 'capacitor_package_ambiguous')
  if (packageName !== capacitorId) fail('source_package_mismatch')
  const versionCode = uniqueCapture(gradle, /^\s*versionCode\s+([1-9][0-9]*)\s*$/gm, 'source_version_code_ambiguous')
  if (!Number.isSafeInteger(Number(versionCode)) || Number(versionCode) > 2100000000) fail('source_version_code_invalid')
  const versionName = uniqueCapture(gradle, /^\s*versionName\s+["']([A-Za-z0-9.+_-]+)["']\s*$/gm, 'source_version_name_ambiguous')
  return { packageName, versionCode: Number(versionCode), versionName }
}

export function parseApkBadging(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.startsWith('package:'))
  if (lines.length !== 1) fail('apk_package_ambiguous')
  const line = lines[0]
  for (const field of ['name', 'versionCode', 'versionName']) {
    if ([...line.matchAll(new RegExp(`\\b${field}=`, 'g'))].length !== 1) fail('apk_package_ambiguous')
  }
  const packageName = uniqueCapture(line, /\bname='([A-Za-z][A-Za-z0-9_.]+)'/g, 'apk_package_invalid')
  const code = uniqueCapture(line, /\bversionCode='([1-9][0-9]*)'/g, 'apk_version_code_invalid')
  const versionName = uniqueCapture(line, /\bversionName='([A-Za-z0-9.+_-]+)'/g, 'apk_version_name_invalid')
  if (!Number.isSafeInteger(Number(code)) || Number(code) > 2100000000) fail('apk_version_code_invalid')
  if (/^application-debuggable\b/m.test(text)) fail('debuggable_apk')
  return { packageName, versionCode: Number(code), versionName }
}

export function parseSignerCertificate(text) {
  if (!/^Verifies\r?$/m.test(text)) fail('signature_output_invalid')
  const count = uniqueCapture(text, /^Number of signers: ([0-9]+)\r?$/gm, 'signer_count_ambiguous')
  if (count !== '1') fail('unsupported_signer_count')
  // SDK 35: "Signer #1 certificate ..."; SDK 37: "V2 Signer: certificate ...".
  // Never take a public-key digest or SourceStamp certificate as app identity.
  const lines = text.split(/\r?\n/).filter((line) => /certificate SHA-256 digest:/i.test(line))
  if (lines.length === 0) fail('signer_certificate_missing')
  const certificates = new Set(lines.map((line) => {
    const match = /^(?:Signer #1|V[1-4](?:\.[0-9]+)? Signer):? certificate SHA-256 digest: ([a-fA-F0-9]{64})$/.exec(line)
    if (!match) fail('signer_certificate_ambiguous')
    return match[1].toLowerCase()
  }))
  if (certificates.size !== 1) fail('signer_certificate_ambiguous')
  return [...certificates][0]
}

export function checkAssetLinks(text, packageName, signerSha256) {
  let entries
  try { entries = JSON.parse(text) } catch { fail('assetlinks_invalid') }
  if (!Array.isArray(entries)) fail('assetlinks_invalid')
  const matches = entries.filter((entry) => entry?.target?.namespace === 'android_app' && entry.target.package_name === packageName)
  if (matches.length !== 1) fail('assetlinks_target_ambiguous')
  const entry = matches[0]
  if (!Array.isArray(entry.relation) || !entry.relation.includes('delegate_permission/common.handle_all_urls')) fail('assetlinks_relation_missing')
  const hashes = entry.target.sha256_cert_fingerprints
  if (!Array.isArray(hashes) || hashes.length < 1 || hashes.length > 8 || hashes.some((hash) => typeof hash !== 'string' || !/^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/.test(hash))) fail('assetlinks_fingerprint_invalid')
  const normalized = hashes.map((hash) => hash.replaceAll(':', '').toLowerCase())
  if (new Set(normalized).size !== normalized.length) fail('assetlinks_fingerprint_ambiguous')
  if (!normalized.includes(signerSha256)) fail('assetlinks_signer_mismatch')
}

export function runBoundedTool(file, args) {
  // SDK tools only; caller supplies absolute paths. No shell, credentials,
  // signing operation, raw stdout/stderr in errors, or unbounded process.
  if (!isAbsolute(file)) fail('tool_path_not_absolute')
  const result = spawnSync(file, args, {
    shell: false, windowsHide: true, encoding: 'utf8', timeout: 30_000,
    maxBuffer: MAX_TOOL_OUTPUT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LC_ALL: 'C' },
  })
  return checkedToolOutput(result)
}

export function checkedToolOutput(result) {
  if (result.error || result.signal || result.status !== 0) fail('tool_execution_failed')
  if (typeof result.stdout !== 'string' || typeof result.stderr !== 'string'
    || Buffer.byteLength(result.stdout) > MAX_TOOL_OUTPUT || Buffer.byteLength(result.stderr) > MAX_TOOL_OUTPUT) fail('tool_output_invalid')
  return result.stdout
}

function regularFile(path) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isFile()) fail('file_not_regular')
  return stat
}

function ownedPath(root, path, allowMissingLast = false) {
  const absolute = resolve(root, path)
  const rel = relative(root, absolute)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('path_outside_workspace')
  const parts = rel.split(/[\\/]/)
  let cursor = root
  for (let index = 0; index < parts.length; index++) {
    cursor = join(cursor, parts[index])
    let stat
    try { stat = lstatSync(cursor) } catch (error) {
      if (error.code === 'ENOENT' && allowMissingLast && index === parts.length - 1) return absolute
      throw error
    }
    if (stat.isSymbolicLink()) fail('symlink_not_allowed')
    if (index < parts.length - 1 && !stat.isDirectory()) fail('parent_not_directory')
  }
  return absolute
}

export function resolveAndroidTools(env) {
  if (!env.ANDROID_HOME || !isAbsolute(env.ANDROID_HOME) || !env.JAVA_HOME || !isAbsolute(env.JAVA_HOME)) fail('sdk_paths_missing')
  const buildRoot = realpathSync(join(env.ANDROID_HOME, 'build-tools'))
  const versions = readdirSync(buildRoot).filter((version) => /^[0-9]+\.[0-9]+\.[0-9]+$/.test(version))
  versions.sort((a, b) => {
    const aa = a.split('.').map(Number); const bb = b.split('.').map(Number)
    return bb[0] - aa[0] || bb[1] - aa[1] || bb[2] - aa[2]
  })
  if (!versions.length) fail('build_tools_missing')
  const dir = ownedPath(buildRoot, versions[0])
  const apksignerJar = ownedPath(dir, 'lib/apksigner.jar')
  const aapt2 = ownedPath(dir, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2')
  const java = join(realpathSync(env.JAVA_HOME), 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  for (const path of [apksignerJar, aapt2, java]) regularFile(path)
  return { java, apksignerJar, aapt2, buildToolsVersion: versions[0] }
}

export function inspectApk({ apk, expected, assetLinks, tools, runTool = runBoundedTool }) {
  if (!Buffer.isBuffer(assetLinks)) fail('assetlinks_bytes_required')
  let assetLinksText
  try { assetLinksText = new TextDecoder('utf-8', { fatal: true }).decode(assetLinks) }
  catch { fail('assetlinks_encoding_invalid') }
  const beforeStat = regularFile(apk)
  if (beforeStat.size < 1 || beforeStat.size > MAX_APK_BYTES) fail('apk_size_invalid')
  const beforeHash = sha256(readFileSync(apk))
  const signatureOutput = runTool(tools.java, ['-Duser.language=en', '-Duser.country=US', '-jar', tools.apksignerJar, 'verify', '--verbose', '--print-certs', apk])
  const signerSha256 = parseSignerCertificate(signatureOutput)
  const identity = parseApkBadging(runTool(tools.aapt2, ['dump', 'badging', apk]))
  for (const key of ['packageName', 'versionCode', 'versionName']) {
    if (identity[key] !== expected[key]) fail(`apk_${key}_mismatch`)
  }
  checkAssetLinks(assetLinksText, identity.packageName, signerSha256)
  const afterStat = regularFile(apk)
  if (afterStat.size !== beforeStat.size || sha256(readFileSync(apk)) !== beforeHash) fail('apk_changed_during_verification')
  return { ...identity, bytes: afterStat.size, sha256: beforeHash, signerSha256, signatureVerified: true,
    androidBuildToolsVersion: tools.buildToolsVersion,
    assetLinks: { source: 'checkout-file', path: ASSET_LINKS, sha256: sha256(assetLinks), matches: true } }
}

export function verifyReleaseApk({ root, env, runTool = runBoundedTool }) {
  // Provenance is supplied by the trusted build workflow, NOT independently
  // inferred from the version strings or a stale local APK.
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_REPOSITORY !== 'flotellop-art/Arty'
    || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '')
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? '')) fail('ci_provenance_missing')
  const canonicalRoot = realpathSync(root)
  const source = ownedPath(canonicalRoot, APK_SOURCE)
  const folder = ownedPath(canonicalRoot, dirname(APK_CANDIDATE), true)
  // No stale candidate or receipt may be reused, even after an earlier failure.
  if (existsSync(folder)) fail('candidate_directory_already_exists')
  const sourceStat = regularFile(source)
  if (sourceStat.size < 1 || sourceStat.size > MAX_APK_BYTES) fail('apk_size_invalid')
  const expected = parseExpectedIdentity(
    readFileSync(ownedPath(canonicalRoot, 'android/app/build.gradle'), 'utf8'),
    readFileSync(ownedPath(canonicalRoot, 'capacitor.config.ts'), 'utf8'),
  )
  const assetLinks = readFileSync(ownedPath(canonicalRoot, ASSET_LINKS))
  const tools = resolveAndroidTools(env)
  mkdirSync(folder)
  const candidate = join(canonicalRoot, APK_CANDIDATE)
  copyFileSync(source, candidate, constants.COPYFILE_EXCL)
  const artifact = inspectApk({ apk: candidate, expected, assetLinks, tools, runTool })
  ownedPath(canonicalRoot, APK_CANDIDATE)
  const receipt = {
    schema: 'arty-apk-identity-v1', status: 'artifact-verified', verifiedAt: new Date().toISOString(),
    provenance: { source: 'github-actions-checkout', repository: env.GITHUB_REPOSITORY, commit: env.GITHUB_SHA,
      runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT },
    artifact: { path: APK_CANDIDATE, ...artifact },
    limits: ['Not a distribution receipt', 'Checkout assetlinks only, not served-domain or Android link verification',
      'No OAuth, Play ownership, physical installation or independent reproducible-build attestation'],
  }
  // Exclusive creation, only after every gate. Candidate is the exact file the
  // workflow passes to Firebase; no build/sync/sign step may follow this one.
  writeFileSync(join(canonicalRoot, APK_RECEIPT), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  return receipt
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const receipt = verifyReleaseApk({ root: fileURLToPath(new URL('..', import.meta.url)), env: process.env })
    console.log(`APK artifact verified: ${receipt.artifact.packageName} ${receipt.artifact.versionName} (${receipt.artifact.versionCode}), SHA-256 ${receipt.artifact.sha256}`)
  } catch (error) {
    // No subprocess error object, DN, stdout, stderr or environment in logs.
    console.error(error instanceof ApkVerificationError ? error.code : 'artifact_verification_failed')
    process.exitCode = 1
  }
}

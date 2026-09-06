#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { measurementSQL, parseAggregate, renderMeasurement } from './lib/walletMeasurement.mjs'
import { readBoundedText } from './lib/boundedTextFile.mjs'

const help = `Rapport opérateur de consommation technique wallet — aucun accès réseau.

Générer une seule requête SELECT, sans exécution :
  node scripts/wallet-measurement.mjs sql --from YYYY-MM-DD --to YYYY-MM-DD [--output rapport.sql]

Valider et rendre un agrégat importé (pas un export du registre brut) :
  node scripts/wallet-measurement.mjs render --input agregat.json --format html|csv|json [--output rapport.html]

Fenêtre UTC : début inclus, fin exclue, 1 à 31 jours. Le plafond de 100 000
lignes concerne le registre global, avant filtrage. Le rapport ne mesure ni
l'activation ni la rétention et ne calcule pas une marge commerciale.
--output crée un nouveau fichier uniquement ; aucun écrasement.
Sans --output, le résultat validé est écrit sur la sortie standard.
L'origine D1 d'un import n'est pas attestée par cet outil.
`

try {
  const [command, ...args] = process.argv.slice(2)
  if (command === '--help' && args.length === 0) process.stdout.write(help)
  else {
    const allowed = command === 'sql' ? ['from', 'to', 'output'] : command === 'render' ? ['input', 'format', 'output'] : []
    if (!allowed.length || args.length % 2) throw new Error('invalid arguments')
    const options = {}
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index].slice(2), value = args[index + 1]
      if (!args[index].startsWith('--') || !allowed.includes(key) || Object.hasOwn(options, key) || !value || value.startsWith('--')) throw new Error('invalid arguments')
      options[key] = value
    }
    let result
    if (command === 'sql') result = measurementSQL(options.from, options.to) + '\n'
    else {
      if (!options.input || !['html', 'csv', 'json'].includes(options.format)) throw new Error('invalid arguments')
      result = renderMeasurement(parseAggregate(readBoundedText(options.input)), options.format)
    }
    if (options.output) writeFileSync(options.output, result, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    else process.stdout.write(result)
  }
} catch {
  // Never echo SQL errors, paths, input fields or provider diagnostics to a report.
  process.stderr.write('Rapport indisponible : vérifier les arguments, le fichier agrégé, sa capacité et le chemin de sortie libre. Aucun résultat nul de remplacement. Voir --help.\n')
  process.exitCode = 1
}

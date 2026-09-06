#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { measurementSQL, parseAggregate, renderMeasurement } from './lib/productMeasurement.mjs'
import { readBoundedText } from './lib/boundedTextFile.mjs'

const help = `Rapport des déclarations facultatives reçues, Réponse client Web. Aucun réseau.
  node scripts/product-measurement.mjs sql --from YYYY-MM-DD --to YYYY-MM-DD [--output rapport.sql]
  node scripts/product-measurement.mjs render --input agregat.json --format html|csv|json [--locale fr|en] [--output rapport.html]
Fenêtre UTC : début inclus, fin exclue, 1 à 31 jours. Absence de déclaration ≠ absence d'usage.
Ni utilisateurs uniques, ni taux global, ni activation/D7/D30/conversion.
Table absente ou import invalide : indisponible, aucun faux zéro. Provenance non attestée.
--output crée un fichier neuf ; aucun écrasement. Sans --output : sortie standard.
`
try {
  const [command, ...args] = process.argv.slice(2)
  if (command === '--help' && !args.length) process.stdout.write(help)
  else {
    const allowed = command === 'sql' ? ['from', 'to', 'output'] : command === 'render' ? ['input', 'format', 'locale', 'output'] : []
    if (!allowed.length || args.length % 2) throw new Error('arguments')
    const options = {}
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index].slice(2), value = args[index + 1]
      if (!args[index].startsWith('--') || !allowed.includes(key) || Object.hasOwn(options, key) || !value || value.startsWith('--')) throw new Error('arguments')
      options[key] = value
    }
    const result = command === 'sql' ? measurementSQL(options.from, options.to) + '\n'
      : renderMeasurement(parseAggregate(readBoundedText(options.input)), options.format, options.locale ?? 'fr')
    if (options.output) writeFileSync(options.output, result, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    else process.stdout.write(result)
  }
} catch {
  process.stderr.write('Rapport indisponible : vérifier arguments, agrégat, capacité et chemin de sortie libre. Aucun faux zéro. Voir --help.\n')
  process.exitCode = 1
}

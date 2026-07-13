#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEPLOYMENT_TEMPLATE = path.join(HERE, 'deployment.template.json');
const CLOUDFLARE_TEMPLATE = path.join(HERE, 'cloudflare.vars.template.json');
const CONTEXT_CARD_TEMPLATE = path.join(HERE, 'context-card.template.json');

const BASE_PATH = '/api/workspace-addon/phase0';
const ALLOWED_SCOPES = [
  'https://www.googleapis.com/auth/gmail.addons.current.action.compose',
  'https://www.googleapis.com/auth/gmail.addons.current.message.action',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

function usage() {
  return `Usage:
  node render-manifest.mjs check-template
  node render-manifest.mjs render --base-url <https://host${BASE_PATH}> --logo-url <https://host/logo.png> [--out <file>]
  node render-manifest.mjs validate --file <deployment.json>
  node render-manifest.mjs render-card --base-url <https://host${BASE_PATH}> [--out <file>]
  node render-manifest.mjs validate-card --file <card.json>
  node render-manifest.mjs render-cloudflare --base-url <https://host${BASE_PATH}> --oauth-client-id <id> --service-account-email <email> [--enabled <true|false>] [--host-action-shape <rpc|legacy>] [--out <file>]
  node render-manifest.mjs validate-cloudflare --file <vars.json>

Sans --out, les commandes de rendu écrivent le JSON sur stdout. Un fichier de sortie
doit rester dans ${HERE}. Aucun appel réseau ni déploiement n'est effectué.`;
}

function die(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) die(message);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    die(`JSON invalide dans ${file}: ${error.message}`);
  }
}

function parseOptions(tokens) {
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    assert(token.startsWith('--'), `Option inattendue: ${token}`);
    const name = token.slice(2);
    assert(name.length > 0, 'Nom d’option vide.');
    assert(!(name in options), `Option répétée: --${name}`);
    const value = tokens[index + 1];
    assert(value && !value.startsWith('--'), `Valeur manquante pour --${name}`);
    options[name] = value;
    index += 1;
  }
  return options;
}

function assertOnlyOptions(options, allowed) {
  for (const name of Object.keys(options)) {
    assert(allowed.includes(name), `Option inconnue: --${name}`);
  }
}

function substitute(value, replacements) {
  if (Array.isArray(value)) return value.map((item) => substitute(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, replacements)]),
    );
  }
  if (typeof value !== 'string') return value;

  return Object.entries(replacements).reduce(
    (result, [placeholder, replacement]) => result.replaceAll(`{{${placeholder}}}`, replacement),
    value,
  );
}

function assertNoPlaceholders(value) {
  const serialized = JSON.stringify(value);
  assert(!/\{\{[A-Z0-9_]+\}\}/.test(serialized), 'Placeholder non résolu.');
}

function normalizeBaseUrl(raw) {
  assert(typeof raw === 'string' && raw.trim() === raw && raw.length > 0, 'BASE_URL manquante ou entourée d’espaces.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    die(`BASE_URL invalide: ${raw}`);
  }

  assert(url.protocol === 'https:', 'BASE_URL doit utiliser HTTPS.');
  assert(!url.username && !url.password, 'BASE_URL ne doit pas contenir d’identifiants.');
  assert(!url.search && !url.hash, 'BASE_URL ne doit contenir ni query string ni fragment.');
  assert(url.pathname.replace(/\/+$/, '') === BASE_PATH, `BASE_URL doit se terminer exactement par ${BASE_PATH}.`);
  return `${url.origin}${BASE_PATH}`;
}

function originFromBaseUrl(raw) {
  return new URL(normalizeBaseUrl(raw)).origin;
}

function normalizeOrigin(raw) {
  assert(typeof raw === 'string' && raw.trim() === raw && raw.length > 0, 'WORKSPACE_ADDON_PHASE0_BASE_URL manquante ou entourée d’espaces.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    die(`WORKSPACE_ADDON_PHASE0_BASE_URL invalide: ${raw}`);
  }
  assert(url.protocol === 'https:', 'WORKSPACE_ADDON_PHASE0_BASE_URL doit utiliser HTTPS.');
  assert(!url.username && !url.password, 'WORKSPACE_ADDON_PHASE0_BASE_URL ne doit pas contenir d’identifiants.');
  assert(url.pathname === '/', 'WORKSPACE_ADDON_PHASE0_BASE_URL doit être une origine sans chemin.');
  assert(!url.search && !url.hash, 'WORKSPACE_ADDON_PHASE0_BASE_URL ne doit contenir ni query string ni fragment.');
  return url.origin;
}

function validateHttpsUrl(raw, label) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    die(`${label} invalide: ${raw}`);
  }
  assert(url.protocol === 'https:', `${label} doit utiliser HTTPS.`);
  assert(!url.username && !url.password, `${label} ne doit pas contenir d’identifiants.`);
  assert(!url.hash, `${label} ne doit pas contenir de fragment.`);
  return url.toString();
}

function assertExactSet(actual, expected, label) {
  assert(Array.isArray(actual), `${label} doit être un tableau.`);
  assert(new Set(actual).size === actual.length, `${label} contient un doublon.`);
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  assert(
    JSON.stringify(actualSorted) === JSON.stringify(expectedSorted),
    `${label} doit contenir exactement: ${expected.join(', ')}`,
  );
}

function endpointBase(raw, suffix, label) {
  const normalized = validateHttpsUrl(raw, label).replace(/\/$/, '');
  const expectedSuffix = `/${suffix}`;
  assert(normalized.endsWith(expectedSuffix), `${label} doit se terminer par ${expectedSuffix}.`);
  return normalizeBaseUrl(normalized.slice(0, -expectedSuffix.length));
}

function validateDeployment(deployment) {
  assertNoPlaceholders(deployment);
  assert(deployment && typeof deployment === 'object' && !Array.isArray(deployment), 'Le deployment doit être un objet JSON.');
  assertExactSet(Object.keys(deployment), ['oauthScopes', 'addOns'], 'Les clés racine du deployment');
  assertExactSet(deployment.oauthScopes, ALLOWED_SCOPES, 'oauthScopes');

  const addOns = deployment.addOns;
  assert(addOns && typeof addOns === 'object' && !Array.isArray(addOns), 'addOns est requis.');
  assertExactSet(Object.keys(addOns), ['common', 'gmail', 'httpOptions'], 'Les clés addOns');

  const common = addOns.common;
  assert(common && typeof common === 'object', 'addOns.common est requis.');
  assertExactSet(Object.keys(common), ['name', 'logoUrl', 'homepageTrigger'], 'Les clés addOns.common');
  assert(typeof common.name === 'string' && common.name.trim().length > 0, 'addOns.common.name est requis.');
  validateHttpsUrl(common.logoUrl, 'addOns.common.logoUrl');
  assertExactSet(Object.keys(common.homepageTrigger ?? {}), ['runFunction', 'enabled'], 'Les clés homepageTrigger');
  assert(common.homepageTrigger?.enabled === true, 'Le homepageTrigger doit être activé.');
  const homeBase = endpointBase(common.homepageTrigger?.runFunction, 'home', 'homepageTrigger.runFunction');

  const gmail = addOns.gmail;
  assert(gmail && typeof gmail === 'object', 'addOns.gmail est requis.');
  assertExactSet(Object.keys(gmail), ['contextualTriggers'], 'Les clés addOns.gmail');
  assert(Array.isArray(gmail.contextualTriggers) && gmail.contextualTriggers.length === 1, 'Un unique contextualTrigger est requis.');
  const trigger = gmail.contextualTriggers[0];
  assert(trigger && typeof trigger === 'object', 'contextualTrigger invalide.');
  assertExactSet(Object.keys(trigger), ['unconditional', 'onTriggerFunction'], 'Les clés contextualTrigger');
  assert(
    trigger.unconditional && typeof trigger.unconditional === 'object' && Object.keys(trigger.unconditional).length === 0,
    'Le contextualTrigger doit être unconditional: {}.',
  );
  const contextBase = endpointBase(trigger.onTriggerFunction, 'context', 'contextualTrigger.onTriggerFunction');
  assert(homeBase === contextBase, 'Les endpoints home et context doivent partager la même BASE_URL.');

  const httpOptions = addOns.httpOptions;
  assertExactSet(Object.keys(httpOptions ?? {}), ['authorizationHeader', 'granularOauthPermissionSupport'], 'Les clés httpOptions');
  assert(httpOptions?.authorizationHeader === 'SYSTEM_ID_TOKEN', 'authorizationHeader doit valoir SYSTEM_ID_TOKEN.');
  assert(httpOptions?.granularOauthPermissionSupport === 'OPT_IN', 'granularOauthPermissionSupport doit valoir OPT_IN.');

  return { baseUrl: homeBase };
}

function validateContextCard(cardResponse) {
  assertNoPlaceholders(cardResponse);
  assert(cardResponse && typeof cardResponse === 'object' && !Array.isArray(cardResponse), 'La réponse de carte doit être un objet JSON.');
  assertExactSet(Object.keys(cardResponse), ['renderActions'], 'Les clés racine de la carte');
  assertExactSet(Object.keys(cardResponse.renderActions ?? {}), ['action'], 'Les clés renderActions');
  const navigations = cardResponse.renderActions?.action?.navigations;
  assert(Array.isArray(navigations) && navigations.length === 1, 'La carte doit contenir une unique navigation.');
  assertExactSet(Object.keys(navigations[0] ?? {}), ['pushCard'], 'Les clés navigation');

  const pushedCard = navigations[0].pushCard;
  assert(pushedCard?.header?.title === 'Message courant', 'Le titre de carte attendu est absent.');
  assert(Array.isArray(pushedCard.sections) && pushedCard.sections.length > 0, 'La carte doit contenir une section.');
  const widgets = pushedCard.sections.flatMap((section) => section.widgets ?? []);
  const buttonWidgets = widgets.filter((widget) => widget.buttonList);
  assert(buttonWidgets.length === 2, 'La carte doit séparer les actions lire et brouillon en deux buttonList.');
  const buttons = buttonWidgets.flatMap((widget) => widget.buttonList.buttons ?? []);
  assert(buttons.length === 2, 'La carte contextuelle doit contenir exactement deux boutons.');

  const replyInput = widgets.find((widget) => widget.textInput)?.textInput;
  assert(replyInput?.name === 'phase0_reply_body', 'Le champ phase0_reply_body est obligatoire.');
  assert(replyInput?.type === 'MULTIPLE_LINE', 'Le texte du brouillon doit être multiligne.');
  assert(replyInput?.validation?.characterLimit === 5000, 'Le texte du brouillon doit être borné à 5000 caractères.');

  const targets = buttons.map((button) => button?.onClick?.action?.function);
  const readBase = endpointBase(targets[0], 'read', 'Bouton Lire ce message');
  const draftBase = endpointBase(targets[1], 'create-draft', 'Bouton Créer un brouillon');
  assert(readBase === draftBase, 'Les deux boutons doivent partager la même BASE_URL.');
  assert(buttons[0].text === 'Lire le message courant', 'Le premier bouton doit lire le message courant.');
  assert(buttons[1].text === 'Tester le brouillon dans ce fil', 'Le second bouton doit créer le brouillon de test.');
  const draftParameters = buttons[1]?.onClick?.action?.parameters;
  assert(Array.isArray(draftParameters) && draftParameters.length === 1, 'Le bouton brouillon doit porter un nonce unique.');
  assertExactSet(Object.keys(draftParameters[0] ?? {}), ['key', 'value'], 'Les clés du paramètre nonce');
  assert(draftParameters[0].key === 'phase0_action_nonce', 'La clé du nonce doit être phase0_action_nonce.');
  assert(
    typeof draftParameters[0].value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(draftParameters[0].value),
    'Le nonce de la carte doit être opaque et contenir 16 à 128 caractères.',
  );
  for (const button of buttons) {
    assert(button.onClick.action.loadIndicator === 'SPINNER', `Le bouton ${button.text} doit afficher SPINNER.`);
  }
  assert(!JSON.stringify(cardResponse).includes('openLink'), 'La carte Phase 0 ne doit ouvrir aucun lien externe.');

  return { baseUrl: readBase };
}

function validateCloudflareConfig(config) {
  assertNoPlaceholders(config);
  assert(config && typeof config === 'object' && !Array.isArray(config), 'La configuration Cloudflare doit être un objet JSON.');
  assertExactSet(Object.keys(config), ['vars'], 'Les clés racine Cloudflare');
  assertExactSet(Object.keys(config.vars ?? {}), [
    'WORKSPACE_ADDON_PHASE0_ENABLED',
    'WORKSPACE_ADDON_PHASE0_BASE_URL',
    'WORKSPACE_ADDON_PHASE0_OAUTH_CLIENT_ID',
    'WORKSPACE_ADDON_PHASE0_SERVICE_ACCOUNT_EMAIL',
    'WORKSPACE_ADDON_PHASE0_HOST_ACTION_SHAPE',
  ], 'Les vars Cloudflare');

  const vars = config.vars;
  assert(
    vars.WORKSPACE_ADDON_PHASE0_ENABLED === 'true' || vars.WORKSPACE_ADDON_PHASE0_ENABLED === 'false',
    'WORKSPACE_ADDON_PHASE0_ENABLED doit être la chaîne true ou false.',
  );
  const origin = normalizeOrigin(vars.WORKSPACE_ADDON_PHASE0_BASE_URL);
  assert(
    typeof vars.WORKSPACE_ADDON_PHASE0_OAUTH_CLIENT_ID === 'string'
      && vars.WORKSPACE_ADDON_PHASE0_OAUTH_CLIENT_ID.trim().length > 10
      && !/\s/.test(vars.WORKSPACE_ADDON_PHASE0_OAUTH_CLIENT_ID),
    'WORKSPACE_ADDON_PHASE0_OAUTH_CLIENT_ID doit contenir le client OAuth exact du module.',
  );
  assert(
    typeof vars.WORKSPACE_ADDON_PHASE0_SERVICE_ACCOUNT_EMAIL === 'string'
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vars.WORKSPACE_ADDON_PHASE0_SERVICE_ACCOUNT_EMAIL),
    'WORKSPACE_ADDON_PHASE0_SERVICE_ACCOUNT_EMAIL doit être une adresse valide.',
  );
  assert(
    vars.WORKSPACE_ADDON_PHASE0_HOST_ACTION_SHAPE === 'rpc'
      || vars.WORKSPACE_ADDON_PHASE0_HOST_ACTION_SHAPE === 'legacy',
    'WORKSPACE_ADDON_PHASE0_HOST_ACTION_SHAPE doit valoir rpc ou legacy.',
  );

  return { baseUrl: `${origin}${BASE_PATH}` };
}

function resolveOutput(raw) {
  const target = path.resolve(process.cwd(), raw);
  const relative = path.relative(HERE, target);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Le fichier de sortie doit rester sous ${HERE}.`);
  assert(![DEPLOYMENT_TEMPLATE, CLOUDFLARE_TEMPLATE, CONTEXT_CARD_TEMPLATE, fileURLToPath(import.meta.url)].includes(target), 'Refus d’écraser un fichier source.');
  return target;
}

function emitJson(value, out) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (!out) {
    process.stdout.write(serialized);
    return;
  }
  const target = resolveOutput(out);
  writeFileSync(target, serialized, { encoding: 'utf8', flag: 'w' });
  process.stderr.write(`Écrit: ${target}\n`);
}

function renderDeployment(options) {
  assertOnlyOptions(options, ['base-url', 'logo-url', 'out']);
  assert(options['base-url'], '--base-url est requis.');
  assert(options['logo-url'], '--logo-url est requis.');
  const baseUrl = normalizeBaseUrl(options['base-url']);
  const logoUrl = validateHttpsUrl(options['logo-url'], 'LOGO_URL');
  const rendered = substitute(readJson(DEPLOYMENT_TEMPLATE), {
    BASE_URL: baseUrl,
    LOGO_URL: logoUrl,
  });
  validateDeployment(rendered);
  emitJson(rendered, options.out);
}

function renderCloudflare(options) {
  assertOnlyOptions(options, ['base-url', 'oauth-client-id', 'service-account-email', 'enabled', 'host-action-shape', 'out']);
  assert(options['base-url'], '--base-url est requis.');
  assert(options['oauth-client-id'], '--oauth-client-id est requis.');
  assert(options['service-account-email'], '--service-account-email est requis.');
  const enabled = options.enabled ?? 'false';
  assert(enabled === 'true' || enabled === 'false', '--enabled doit valoir true ou false.');
  const hostActionShape = options['host-action-shape'] ?? 'rpc';
  assert(hostActionShape === 'rpc' || hostActionShape === 'legacy', '--host-action-shape doit valoir rpc ou legacy.');
  const rendered = substitute(readJson(CLOUDFLARE_TEMPLATE), {
    ENABLED: enabled,
    ORIGIN: originFromBaseUrl(options['base-url']),
    GOOGLE_OAUTH_CLIENT_ID: options['oauth-client-id'],
    GOOGLE_SERVICE_ACCOUNT_EMAIL: options['service-account-email'],
    HOST_ACTION_SHAPE: hostActionShape,
  });
  validateCloudflareConfig(rendered);
  emitJson(rendered, options.out);
}

function renderContextCard(options) {
  assertOnlyOptions(options, ['base-url', 'out']);
  assert(options['base-url'], '--base-url est requis.');
  const rendered = substitute(readJson(CONTEXT_CARD_TEMPLATE), {
    BASE_URL: normalizeBaseUrl(options['base-url']),
    ACTION_NONCE: randomUUID(),
  });
  validateContextCard(rendered);
  emitJson(rendered, options.out);
}

function checkTemplates() {
  const baseUrl = 'https://phase0.example.test/api/workspace-addon/phase0';
  const deployment = substitute(readJson(DEPLOYMENT_TEMPLATE), {
    BASE_URL: baseUrl,
    LOGO_URL: 'https://phase0.example.test/assets/arty-addon-64.png',
  });
  const cloudflare = substitute(readJson(CLOUDFLARE_TEMPLATE), {
    ENABLED: 'false',
    ORIGIN: originFromBaseUrl(baseUrl),
    GOOGLE_OAUTH_CLIENT_ID: '000000000000-example.apps.googleusercontent.com',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service-account@example.iam.gserviceaccount.com',
    HOST_ACTION_SHAPE: 'rpc',
  });
  const contextCard = substitute(readJson(CONTEXT_CARD_TEMPLATE), {
    BASE_URL: baseUrl,
    ACTION_NONCE: 'phase0-template-nonce-0001',
  });
  validateDeployment(deployment);
  validateCloudflareConfig(cloudflare);
  validateContextCard(contextCard);
  process.stdout.write('PASS: templates JSON, scopes, cartes, endpoints, audiences et granular OAuth valides.\n');
}

function validateFile(options, validator) {
  assertOnlyOptions(options, ['file']);
  assert(options.file, '--file est requis.');
  const result = validator(readJson(path.resolve(process.cwd(), options.file)));
  process.stdout.write(`PASS: ${path.resolve(process.cwd(), options.file)} (${result.baseUrl})\n`);
}

function main() {
  const [command, ...tokens] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const options = parseOptions(tokens);
  switch (command) {
    case 'check-template':
      assertOnlyOptions(options, []);
      checkTemplates();
      break;
    case 'render':
      renderDeployment(options);
      break;
    case 'validate':
      validateFile(options, validateDeployment);
      break;
    case 'render-card':
      renderContextCard(options);
      break;
    case 'validate-card':
      validateFile(options, validateContextCard);
      break;
    case 'render-cloudflare':
      renderCloudflare(options);
      break;
    case 'validate-cloudflare':
      validateFile(options, validateCloudflareConfig);
      break;
    default:
      die(`Commande inconnue: ${command}\n\n${usage()}`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`FAIL: ${error.message}\n`);
  process.exitCode = 1;
}

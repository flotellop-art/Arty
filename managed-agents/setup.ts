// setup.ts — à exécuter UNE SEULE FOIS.
//
// Crée l'environnement, l'agent (réutilisable + versionné) et le vault qui
// porte le credential du serveur MCP GitHub. Imprime 3 lignes `export ...`
// à coller dans ton terminal — ce sont les IDs utilisés par run.ts.
//
// Prérequis :
//   export ANTHROPIC_API_KEY=sk-ant-...
//   export GITHUB_PAT=ghp_...            (ton PAT GitHub)
//
// Lancer :  npx tsx managed-agents/setup.ts

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// 1) Environnement : le conteneur sandboxé où s'exécutent les outils.
const env = await client.beta.environments.create({
  name: "research-env",
  config: { type: "cloud", networking: { type: "unrestricted" } },
});

// 2) Agent : modèle + prompt système + outils + skills. Créé une fois,
//    référencé par ID à chaque run.
const agent = await client.beta.agents.create({
  name: "Research Agent",
  model: "claude-opus-4-8",
  system: [
    "Tu es un agent de recherche. Tu produis des rapports factuels et cités.",
    "",
    "Méthode :",
    "- Pour toute question dont la réponse dépend d'infos récentes ou",
    "  spécifiques, lance web_search AVANT de répondre — ne réponds pas de mémoire.",
    "- Utilise web_fetch pour lire en profondeur les sources les plus pertinentes.",
    "- Quand la question porte sur du code, des dépôts, des issues ou des PR,",
    '  utilise les outils GitHub (serveur MCP "github").',
    "- Chaque affirmation clé ou chiffre DOIT être accompagné de sa source (URL).",
    "",
    "Livrable :",
    "- Rédige un rapport structuré (résumé, corps, sources, limites/incertitudes).",
    '- Génère le rapport final en PDF (skill "pdf") dans /mnt/session/outputs/.',
    "  Écris aussi une version Markdown à côté.",
  ].join("\n"),
  mcp_servers: [
    { type: "url", name: "github", url: "https://api.githubcopilot.com/mcp/" },
  ],
  tools: [
    { type: "agent_toolset_20260401" },
    { type: "mcp_toolset", mcp_server_name: "github" },
  ],
  skills: [{ type: "anthropic", skill_id: "pdf" }],
});

// 3) Vault : porte le credential MCP GitHub. PAT = access_token, SANS bloc
//    refresh (un PAT n'a pas de refresh_token). Le PAT n'entre jamais dans le
//    conteneur — Anthropic l'injecte côté proxy après la sortie du sandbox.
const vault = await client.beta.vaults.create({ name: "github-mcp" });
await client.beta.vaults.credentials.create(vault.id, {
  display_name: "GitHub MCP (PAT)",
  auth: {
    type: "mcp_oauth",
    mcp_server_url: "https://api.githubcopilot.com/mcp/", // doit matcher l'URL de l'agent
    access_token: process.env.GITHUB_PAT!,
    // Pas de refresh pour un PAT. expires_at = expiry réelle du PAT, ou
    // une date lointaine s'il n'expire pas (évite toute tentative de refresh).
    expires_at: process.env.GITHUB_PAT_EXPIRES_AT ?? "2099-12-31T00:00:00Z",
  },
});

console.log("export AGENT_ID=" + agent.id);
console.log("export ENV_ID=" + env.id);
console.log("export VAULT_ID=" + vault.id);

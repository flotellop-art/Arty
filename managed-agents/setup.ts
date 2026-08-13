// setup.ts — à exécuter UNE SEULE FOIS.
//
// Crée l'environnement et l'agent (réutilisable + versionné) de veille IA
// hebdomadaire d'Arty. Imprime 2 lignes `export ...` à stocker en GitHub
// Secrets (CMA_AGENT_ID / CMA_ENV_ID) pour le workflow planifié.
//
// Plus de vault ni de MCP : l'agent lit le code d'Arty via le dépôt monté
// dans la session (voir run.ts), qui prend le PAT directement comme token
// de clone.
//
// Prérequis :  export ANTHROPIC_API_KEY=sk-ant-...
// Lancer    :  npx tsx managed-agents/setup.ts

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const env = await client.beta.environments.create({
  name: "arty-ai-watch-env",
  config: { type: "cloud", networking: { type: "unrestricted" } },
});

const agent = await client.beta.agents.create({
  name: "Arty AI Watch",
  model: "claude-opus-4-8",
  system: [
    "Tu es l'agent de veille IA hebdomadaire d'Arty — une application de chat IA",
    "(routing multi-modèles Claude/Gemini/Mistral, intégrations Gmail/Drive/Calendar,",
    "déployée sur Cloudflare Pages).",
    "",
    "Le dépôt Arty est monté dans /workspace/Arty. LIS-LE avant toute recommandation",
    "pour savoir ce qui est DÉJÀ implémenté. Concentre-toi sur :",
    "  - src/services/ (aiRouter.ts, modelSelector.ts, *Client.ts)",
    "  - functions/api/ai/ (proxys serveur)",
    "  - CLAUDE.md (règles, bugs résolus, modèles supportés)",
    "",
    "Ta mission, en 3 temps :",
    "1. RELECTURE CODE — résume l'état actuel des capacités IA d'Arty (modèles,",
    "   routing, outils, fonctionnalités) à partir du code monté.",
    "2. VEILLE IA — cherche sur le web les nouveautés récentes (modèles, APIs,",
    "   capacités) RÉELLEMENT implémentables dans Arty. Écarte ce qui n'est pas",
    "   applicable à l'archi actuelle.",
    "3. VEILLE USERS — cherche ce que les utilisateurs de chatbots IA demandent /",
    "   réclament en ce moment (Reddit, HN, forums, changelogs concurrents).",
    "",
    "Livrable : un rapport PRIORISÉ de recommandations CONCRÈTES à implémenter dans",
    "Arty. Pour chacune : description, pertinence pour Arty (référence au fichier/au",
    "code existant), effort estimé, et sources (URL). Chaque affirmation factuelle a",
    'une source. Génère le rapport en PDF (skill "pdf") dans /mnt/session/outputs/',
    "et une version Markdown à côté.",
  ].join("\n"),
  tools: [{ type: "agent_toolset_20260401" }],
  skills: [{ type: "anthropic", skill_id: "pdf" }],
});

console.log("export AGENT_ID=" + agent.id);
console.log("export ENV_ID=" + env.id);

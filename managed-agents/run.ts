// run.ts — à exécuter à CHAQUE recherche.
//
// Utilise les 3 IDs imprimés par setup.ts (à avoir en variables d'env) :
//   export AGENT_ID=agent_...
//   export ENV_ID=env_...
//   export VAULT_ID=vlt_...
//   export ANTHROPIC_API_KEY=sk-ant-...
//
// Lancer :
//   npx tsx -e "import {runResearch} from './managed-agents/run.ts'; runResearch('ta question ici');"

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";

const client = new Anthropic();

const AGENT_ID = process.env.AGENT_ID!;
const ENV_ID = process.env.ENV_ID!;
const VAULT_ID = process.env.VAULT_ID!;

// La grille de notation : ta définition écrite de "bon travail". Le correcteur
// note chaque version contre ces critères et renvoie l'agent réviser tant que
// tout n'est pas coché.
const RESEARCH_RUBRIC = `
# Critères d'évaluation du rapport de recherche

Note chaque critère indépendamment. Le rapport est "satisfied" seulement si TOUS sont remplis.

1. PERTINENCE — Le rapport répond directement et complètement à la question posée.
2. SOURCES — Au moins 5 sources distinctes, fiables et vérifiables, chacune avec une URL complète. Aucune URL inventée ou inaccessible.
3. CITATIONS — Chaque affirmation factuelle clé et chaque chiffre est rattaché à une source. Aucun fait présenté sans source.
4. STRUCTURE — Le rapport contient : (a) un résumé exécutif, (b) un corps détaillé, (c) une liste des sources, (d) une section "Limites & incertitudes".
5. ACTUALITÉ — Quand le sujet est sensible au temps, les sources sont récentes et datées.
6. LIVRABLE — Un fichier PDF du rapport final existe dans /mnt/session/outputs/.
7. HONNÊTETÉ — Les zones d'incertitude ou de désaccord entre sources sont signalées explicitement.
`.trim();

export async function runResearch(question: string) {
  // sessions.create bloque jusqu'au montage des ressources → un mauvais montage
  // remonte ICI, avant toute dépense de tokens.
  const session = await client.beta.sessions.create({
    agent: AGENT_ID, // string = dernière version de l'agent
    environment_id: ENV_ID,
    vault_ids: [VAULT_ID], // credential GitHub MCP
    title: `Recherche: ${question.slice(0, 60)}`,
  });

  // Pratique pendant le dev : suivre la session en direct dans la Console.
  console.log(
    `Console: https://platform.claude.com/workspaces/default/sessions/${session.id}`,
  );

  // 1) Smoke-test : la connectivité MCP n'échoue qu'au 1er usage, pas à la
  //    création. Une sonde bon marché évite une session qui patine.
  await drive(
    session.id,
    "Confirme en une phrase que tu peux atteindre le serveur GitHub MCP (liste 1-2 outils dispo). Ne commence PAS la recherche.",
  );

  // 2) Kickoff par OUTCOME — pas de user.message ici, la description EST la tâche.
  await runOutcome(session.id, `Recherche approfondie et rapport cité sur : ${question}`);

  // 3) Récupère les sorties (PDF + .md) écrites dans /mnt/session/outputs/.
  await new Promise((r) => setTimeout(r, 2000)); // petit lag d'indexation
  const files = await client.beta.files.list({
    scope_id: session.id,
    betas: ["managed-agents-2026-04-01"], // requis en plus du header Files
  });
  for await (const f of files) {
    const resp = await client.beta.files.download(f.id);
    fs.writeFileSync(f.filename, Buffer.from(await resp.arrayBuffer()));
    console.log("Téléchargé:", f.filename);
  }

  return session.id;
}

// Tour conversationnel simple (utilisé pour le smoke-test).
async function drive(sessionId: string, text: string) {
  const stream = await client.beta.sessions.events.stream(sessionId);
  await client.beta.sessions.events.send(sessionId, {
    events: [{ type: "user.message", content: [{ type: "text", text }] }],
  });
  for await (const event of stream) {
    switch (event.type) {
      case "agent.message":
        for (const b of event.content) if (b.type === "text") process.stdout.write(b.text);
        break;
      case "session.error":
        console.error("\n[session.error]", (event as any).error?.message);
        break;
      case "session.status_terminated":
        return;
      case "session.status_idle":
        if (event.stop_reason?.type !== "requires_action") return;
        break;
    }
  }
}

// Envoie l'objectif + la grille, puis draine jusqu'à un état terminal.
async function runOutcome(sessionId: string, description: string) {
  const stream = await client.beta.sessions.events.stream(sessionId);
  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: "user.define_outcome",
        description,
        rubric: { type: "text", content: RESEARCH_RUBRIC },
        max_iterations: 5, // défaut 3, max 20
      },
    ],
  });

  for await (const event of stream) {
    switch (event.type) {
      case "agent.message":
        for (const b of event.content) if (b.type === "text") process.stdout.write(b.text);
        break;

      // Progression du correcteur (visibilité, PAS un signal de sortie :
      // sur needs_revision la session repart pour une itération).
      case "span.outcome_evaluation_end": {
        const e = event as any;
        console.log(`\n[grader itér.${e.iteration}] ${e.result} — ${e.explanation ?? ""}`);
        break;
      }

      case "session.error":
        console.error("\n[session.error]", (event as any).error?.message);
        break;

      case "session.status_terminated":
        return;

      case "session.status_idle":
        // Idle nu = transitoire. On sort seulement sur un stop_reason terminal.
        if (event.stop_reason?.type !== "requires_action") return;
        break;
    }
  }
}

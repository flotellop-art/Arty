// run.ts — la veille IA hebdomadaire. Lancé par le workflow GitHub Actions
// (.github/workflows/weekly-ai-watch.yml), ou à la main.
//
// Variables d'env requises :
//   ANTHROPIC_API_KEY=sk-ant-...
//   AGENT_ID=agent_...        (imprimé par setup.ts)
//   ENV_ID=env_...            (imprimé par setup.ts)
//   GITHUB_PAT=ghp_...        (PAT avec accès lecture au dépôt Arty)
//
// Lancer :  npx tsx managed-agents/run.ts
//
// Écrit le rapport (PDF + Markdown) dans ./reports-out/.

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

const client = new Anthropic();

const AGENT_ID = process.env.AGENT_ID!;
const ENV_ID = process.env.ENV_ID!;
const GITHUB_PAT = process.env.GITHUB_PAT!;
const ARTY_REPO = "https://github.com/flotellop-art/Arty";
const OUT_DIR = "reports-out";

const MISSION =
  "Veille IA hebdomadaire pour Arty. (1) Relis le code monté dans /workspace/Arty " +
  "et résume l'état actuel des capacités IA. (2) Identifie les nouveautés IA récentes " +
  "réellement implémentables dans Arty. (3) Fais la veille des demandes des utilisateurs " +
  "de chatbots IA. Produis un rapport priorisé de recommandations concrètes et cité.";

// Grille de notation : définition écrite de "bon rapport". Le correcteur note
// chaque version et renvoie l'agent réviser tant que tout n'est pas coché.
const RUBRIC = `
# Critères d'évaluation — rapport de veille IA Arty

Note chaque critère indépendamment. "satisfied" seulement si TOUS sont remplis.

1. CODE RELU — Le rapport résume l'état actuel des capacités IA d'Arty en s'appuyant
   explicitement sur des fichiers réels du dépôt monté (chemins cités).
2. RECOMMANDATIONS — Au moins 3 recommandations concrètes, chacune avec : description,
   pertinence pour Arty (référence au code existant), effort estimé.
3. VEILLE USERS — Une section dédiée aux demandes/attentes des utilisateurs de chatbots,
   appuyée sur des sources.
4. SOURCES — Au moins 5 sources distinctes, fiables, chacune avec URL complète. Aucune
   URL inventée. Chaque affirmation factuelle est sourcée.
5. PRIORISATION — Les recommandations sont classées par valeur/effort.
6. LIVRABLE — Un PDF du rapport existe dans /mnt/session/outputs/.
7. HONNÊTETÉ — Les incertitudes et les pistes écartées (non applicables à Arty) sont
   signalées explicitement.
`.trim();

async function runWeeklyWatch() {
  // sessions.create bloque jusqu'au montage des ressources → un mauvais montage
  // du dépôt (token invalide) remonte ICI, avant toute dépense de tokens.
  const session = await client.beta.sessions.create({
    agent: AGENT_ID,
    environment_id: ENV_ID,
    title: `Veille IA Arty — ${new Date().toISOString().slice(0, 10)}`,
    resources: [
      {
        type: "github_repository",
        url: ARTY_REPO,
        authorization_token: GITHUB_PAT, // token de clone, jamais exposé au conteneur
        checkout: { type: "branch", name: "main" },
      },
    ],
  });
  console.log(
    `Console: https://platform.claude.com/workspaces/default/sessions/${session.id}`,
  );

  await runOutcome(session.id, MISSION);

  // Récupère les sorties écrites dans /mnt/session/outputs/.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await new Promise((r) => setTimeout(r, 2000)); // petit lag d'indexation
  const files = await client.beta.files.list({
    scope_id: session.id,
    betas: ["managed-agents-2026-04-01"],
  });
  let count = 0;
  for await (const f of files) {
    const resp = await client.beta.files.download(f.id);
    const safe = path.basename(f.filename);
    fs.writeFileSync(path.join(OUT_DIR, safe), Buffer.from(await resp.arrayBuffer()));
    console.log("Téléchargé:", path.join(OUT_DIR, safe));
    count++;
  }
  if (count === 0) throw new Error("Aucun fichier produit dans /mnt/session/outputs/");
}

// Envoie l'objectif + la grille, puis draine jusqu'à un état terminal.
async function runOutcome(sessionId: string, description: string) {
  const stream = await client.beta.sessions.events.stream(sessionId);
  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: "user.define_outcome",
        description,
        rubric: { type: "text", content: RUBRIC },
        max_iterations: 4,
      },
    ],
  });

  for await (const event of stream) {
    switch (event.type) {
      case "agent.message":
        for (const b of event.content) if (b.type === "text") process.stdout.write(b.text);
        break;
      case "span.outcome_evaluation_end": {
        const e = event as any;
        console.log(`\n[grader itér.${e.iteration}] ${e.result} — ${e.explanation ?? ""}`);
        break; // pas un signal de sortie : sur needs_revision la session continue
      }
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

runWeeklyWatch().catch((e) => {
  console.error(e);
  process.exit(1);
});

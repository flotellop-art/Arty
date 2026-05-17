/// <reference types="@cloudflare/workers-types" />

/**
 * Arty Growth Orchestrator v2
 * --------------------------------
 * Cloudflare Worker qui orchestre une "equipe IA" pour Arty :
 *   1) Sub-agents : Growth FR, Content FR, Analytics (sessions Anthropic Managed Agents)
 *   2) Arty DG : agent qui consolide les 3 outputs et prend les decisions
 *   3) Interface Florent : Discord (canal #dg), pas d'email
 *
 * Cycle hebdo automatique : dimanche 18h UTC.
 * Cycle manuel : POST /trigger avec X-Trigger-Secret.
 * Interactions Discord : POST /discord/interactions (signature ed25519 verifiee).
 *
 * Audit secu (CLAUDE.md RÈGLE 6) :
 *  - /trigger : auth header X-Trigger-Secret (secret CF), pas d'IDOR, retour 404 si invalide.
 *  - /discord/interactions : signature Ed25519 verifiee via Web Crypto, secret cle = DISCORD_PUBLIC_KEY (publique).
 *    Sans verification, un attaquant pourrait faire executer des commandes DG en se faisant passer pour Discord.
 *  - Pas de leak d'info dans les reponses d'erreur.
 *  - Bot token Discord en secret CF, jamais en log.
 *  - Cle Anthropic en secret CF, jamais en log.
 *  - Aucun PII Florent dans les responses publiques.
 */

export interface Env {
  // Secrets
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_WEBHOOK_SIGNING_KEY: string;
  TRIGGER_SECRET: string;
  DISCORD_BOT_TOKEN: string;
  TALLY_API_KEY: string;
  GITHUB_TOKEN: string;
  RESEND_API_KEY?: string;

  // Vars publiques
  ANTHROPIC_WORKSPACE_ID: string;
  ANTHROPIC_ENV_ID: string;
  AGENT_DG_ID: string;
  AGENT_GROWTH_FR_ID: string;
  AGENT_CONTENT_FR_ID: string;
  AGENT_ANALYTICS_ID: string;
  MEMORY_STORE_ID: string;
  MEMORY_STORE_NAME: string;
  TALLY_FORM_ID: string;
  GITHUB_REPO_URL: string;
  GITHUB_REPO_MOUNT: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_GUILD_ID: string;
  DISCORD_CHANNEL_ID: string;
  SESSION_TIMEOUT_MS: string;
  SESSION_POLL_INTERVAL_MS: string;

  // KV pour le tracking des interactions Discord en attente
  INTERACTIONS: KVNamespace;

  // Legacy email (optionnel, garde-fou)
  DIGEST_TO_EMAIL?: string;
  DIGEST_FROM_EMAIL?: string;
  DIGEST_FROM_NAME?: string;
}

// Entry stockee en KV pour relier une session Anthropic a une action de delivery.
//  - adhoc            : reponse a un /dg sur Discord (PATCH du message Discord)
//  - weekly_subagent  : output d'un sub-agent dans le cycle hebdo (a accumuler)
//  - weekly_dg        : digest final du DG dans le cycle hebdo (a poster sur Discord)
interface PendingInteraction {
  type: "adhoc" | "weekly_subagent" | "weekly_dg";
  interactionToken?: string;                  // utilise pour adhoc
  role?: "analytics" | "growth" | "content" | "dg";
  cycleId?: string;                            // pour weekly_*
  createdAt: number;
}

// Metadata d'un cycle hebdo, stockee en KV `cycle:{cycleId}:meta`
interface CycleMeta {
  cycleId: string;
  cycleN: number;
  weekStart: string;
  weekEnd: string;
}

// ===========================================================================
// 1. ANTHROPIC MANAGED AGENTS
// ===========================================================================

const ANTHROPIC_BASE = "https://api.anthropic.com/v1";

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "managed-agents-2026-04-01",
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
}

interface GithubRepoMount {
  url: string;
  mountPath: string;
  token: string;
}

async function createSession(
  apiKey: string,
  agentId: string,
  envId: string,
  title: string,
  memoryStoreId?: string,
  githubRepo?: GithubRepoMount,
): Promise<{ ok: true; id: string } | { ok: false; err: string }> {
  const body: Record<string, unknown> = {
    agent: agentId,
    environment_id: envId,
    title,
  };
  const resources: Record<string, unknown>[] = [];
  if (memoryStoreId) {
    resources.push({ type: "memory_store", memory_store_id: memoryStoreId });
  }
  if (githubRepo) {
    resources.push({
      type: "github_repository",
      url: githubRepo.url,
      mount_path: githubRepo.mountPath,
      authorization_token: githubRepo.token,
    });
  }
  if (resources.length > 0) body.resources = resources;

  const res = await fetch(`${ANTHROPIC_BASE}/sessions`, {
    method: "POST",
    headers: anthropicHeaders(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return { ok: false, err: `Create session ${res.status}: ${(await res.text()).slice(0, 300)}` };
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) return { ok: false, err: "Missing session id" };
  return { ok: true, id: data.id };
}

async function sendUserMessage(
  apiKey: string,
  sessionId: string,
  text: string,
): Promise<{ ok: boolean; err?: string }> {
  const res = await fetch(`${ANTHROPIC_BASE}/sessions/${sessionId}/events`, {
    method: "POST",
    headers: anthropicHeaders(apiKey),
    body: JSON.stringify({
      events: [{ type: "user.message", content: [{ type: "text", text }] }],
    }),
  });
  if (!res.ok) {
    return { ok: false, err: `Send event ${res.status}: ${(await res.text()).slice(0, 300)}` };
  }
  return { ok: true };
}

async function getSessionStatus(
  apiKey: string,
  sessionId: string,
): Promise<{ status: string } | null> {
  const res = await fetch(`${ANTHROPIC_BASE}/sessions/${sessionId}`, {
    method: "GET",
    headers: anthropicHeaders(apiKey),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { status?: string };
  return { status: (data.status ?? "").toLowerCase() };
}

async function fetchAgentText(apiKey: string, sessionId: string): Promise<string> {
  const res = await fetch(`${ANTHROPIC_BASE}/sessions/${sessionId}/events?limit=500`, {
    method: "GET",
    headers: anthropicHeaders(apiKey),
  });
  if (!res.ok) return "";
  const data = (await res.json()) as {
    data?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  const texts: string[] = [];
  for (const ev of data.data ?? []) {
    if (ev.type !== "agent.message") continue;
    for (const b of ev.content ?? []) {
      if (b.type === "text" && b.text) texts.push(b.text);
    }
  }
  return texts.join("\n\n");
}

/**
 * Recupere le premier user.message d'une session (la question initiale de Florent).
 * Utilise pour memoriser le contexte d'une interaction /dg.
 */
async function getUserMessageFromSession(apiKey: string, sessionId: string): Promise<string> {
  const res = await fetch(`${ANTHROPIC_BASE}/sessions/${sessionId}/events?limit=20`, {
    method: "GET",
    headers: anthropicHeaders(apiKey),
  });
  if (!res.ok) return "";
  const data = (await res.json()) as {
    data?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  for (const ev of data.data ?? []) {
    if (ev.type !== "user.message") continue;
    for (const b of ev.content ?? []) {
      if (b.type === "text" && b.text) {
        // Le brief contient toujours "Message :\n<vrai message>\n\n---"
        // On extrait juste la partie utile
        const m = b.text.match(/## Message de Florent\n([\s\S]*?)\n\n---/);
        if (m) return m[1].trim();
        const m2 = b.text.match(/Message :\n([\s\S]*?)\n\n---/);
        if (m2) return m2[1].trim();
        return b.text.slice(0, 300);
      }
    }
  }
  return "";
}

/**
 * Lance une session pour un agent, envoie le brief, attend la fin, retourne le texte.
 * Polling reduit a 30s pour menager le CPU budget du Worker (3 sessions en parallele
 * sur des cycles de 5-10min = beaucoup de subrequests sinon).
 */
async function runAgent(
  env: Env,
  agentId: string,
  brief: string,
  title: string,
  pollOverrideMs?: number,
): Promise<{ ok: boolean; text: string; err?: string; sessionId?: string }> {
  const apiKey = env.ANTHROPIC_API_KEY;
  const timeoutMs = parseInt(env.SESSION_TIMEOUT_MS || "600000", 10);
  const pollMs = pollOverrideMs ?? parseInt(env.SESSION_POLL_INTERVAL_MS || "30000", 10);

  const created = await createSession(apiKey, agentId, env.ANTHROPIC_ENV_ID, title);
  if (!created.ok) return { ok: false, text: "", err: created.err };
  const sessionId = created.id;

  const sent = await sendUserMessage(apiKey, sessionId, brief);
  if (!sent.ok) return { ok: false, text: "", err: sent.err, sessionId };

  const start = Date.now();
  let sawRunning = false;
  while (Date.now() - start < timeoutMs) {
    await sleep(pollMs);
    const status = await getSessionStatus(apiKey, sessionId);
    if (!status) continue;
    if (status.status === "running" || status.status === "rescheduling") {
      sawRunning = true;
      continue;
    }
    if (status.status === "terminated") {
      return { ok: false, text: "", err: "Session terminated", sessionId };
    }
    if (status.status === "idle" && sawRunning) {
      const text = await fetchAgentText(apiKey, sessionId);
      return { ok: true, text, sessionId };
    }
  }
  return { ok: false, text: "", err: `Timeout ${timeoutMs / 1000}s`, sessionId };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ===========================================================================
// 1.5 TALLY (waitlist stats)
// ===========================================================================

/**
 * Recupere les submissions du formulaire waitlist Tally et calcule les stats
 * cles : total, cette semaine, hier, aujourd'hui, plus les 5 dernieres entrees
 * (date + email partiellement anonymise). Si l'API repond mal, on retourne
 * un message explicite plutot que de planter.
 *
 * Audit secu : les emails sont des PII. On les masque dans les briefs.
 */
async function fetchTallyStats(env: Env): Promise<string> {
  try {
    // Tally pagine par 50 max. Pour le MVP on prend la 1ere page (les 50 dernieres),
    // ce qui suffit pour calculer total approx, delta semaine et delta jour.
    // Si total > 50 plus tard, on paginera.
    const url = `https://api.tally.so/forms/${env.TALLY_FORM_ID}/submissions?limit=50&page=1`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.TALLY_API_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 200);
      console.error(`[tally] HTTP ${res.status}: ${errText}`);
      return `## Stats waitlist (Tally)\n\nNon disponibles cette execution. Erreur API : ${res.status}.\n`;
    }
    const data = (await res.json()) as {
      totalNumberOfSubmissionsPerFilter?: { all?: number; completed?: number };
      submissions?: Array<{
        id: string;
        submittedAt: string;
        isCompleted?: boolean;
        responses?: Array<{ question?: { title?: string }; answer?: { value?: string } }>;
      }>;
    };

    const totalAll = data.totalNumberOfSubmissionsPerFilter?.completed
      ?? data.totalNumberOfSubmissionsPerFilter?.all
      ?? (data.submissions?.length ?? 0);

    const now = Date.now();
    const oneDayMs = 86_400_000;
    const oneWeekMs = 7 * oneDayMs;
    let lastWeek = 0;
    let last24h = 0;
    let today = 0;
    const todayStartUtc = new Date();
    todayStartUtc.setUTCHours(0, 0, 0, 0);

    const recent: Array<{ when: string; preview: string }> = [];

    for (const s of data.submissions ?? []) {
      const ts = Date.parse(s.submittedAt);
      if (!Number.isFinite(ts)) continue;
      const delta = now - ts;
      if (delta < oneWeekMs) lastWeek++;
      if (delta < oneDayMs) last24h++;
      if (ts >= todayStartUtc.getTime()) today++;

      // Anonymiser l'email pour les 5 derniers (PII)
      if (recent.length < 5) {
        const emailField = (s.responses ?? []).find((r) => {
          const t = (r.question?.title ?? "").toLowerCase();
          return t.includes("email") || t.includes("mail") || t.includes("courriel");
        });
        const email = emailField?.answer?.value ?? "";
        const masked = maskEmail(email);
        recent.push({
          when: new Date(ts).toISOString().replace("T", " ").slice(0, 16),
          preview: masked,
        });
      }
    }

    const remaining = Math.max(0, 500 - totalAll);
    const daysToGoal = Math.max(0, Math.ceil((new Date("2026-06-30T23:59:59Z").getTime() - now) / oneDayMs));
    const rateRequired = daysToGoal > 0 ? (remaining / daysToGoal).toFixed(1) : "0";

    return [
      `## Stats waitlist (source : Tally, source de verite)`,
      ``,
      `- **Total inscrits** : ${totalAll}`,
      `- Cette semaine (7 derniers jours) : +${lastWeek}`,
      `- 24h : +${last24h}`,
      `- Aujourd hui (UTC) : +${today}`,
      `- Reste pour atteindre 500 au 30 juin : ${remaining} inscrits sur ${daysToGoal} jours = ~${rateRequired}/jour necessaires`,
      ``,
      `### 5 dernieres inscriptions (emails masques pour PII)`,
      ``,
      recent.length > 0
        ? recent.map((r) => `- ${r.when} : ${r.preview}`).join("\n")
        : "(aucune submission)",
      ``,
    ].join("\n");
  } catch (err) {
    console.error(`[tally] exception: ${err}`);
    return `## Stats waitlist (Tally)\n\nNon disponibles cette execution. Exception : ${String(err).slice(0, 200)}.\n`;
  }
}

function maskEmail(email: string): string {
  const m = email.match(/^([^@]+)@(.+)$/);
  if (!m) return "(email invalide)";
  const local = m[1];
  const domain = m[2];
  const maskedLocal = local.length <= 3 ? local[0] + "**" : local.slice(0, 3) + "***";
  return `${maskedLocal}@${domain}`;
}

// ===========================================================================
// 2. BRIEFS POUR LES SUB-AGENTS ET LE DG
// ===========================================================================

function fmtDate(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long" });
}

function getWeekRange(now: Date): { start: Date; end: Date; cycleN: number } {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - end.getUTCDay()); // dimanche
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6); // lundi -6j
  // cycle N : compter depuis le premier dimanche du 17 mai 2026
  const firstCycle = new Date("2026-05-17T00:00:00Z").getTime();
  const cycleN = Math.max(1, Math.floor((end.getTime() - firstCycle) / (7 * 86400_000)) + 1);
  return { start, end, cycleN };
}

function buildBriefSubAgent(
  role: "analytics" | "growth" | "content",
  weekStart: Date,
  weekEnd: Date,
  tallyBlock: string,
): string {
  const semaine = `du ${fmtDate(weekStart)} au ${fmtDate(weekEnd)}`;
  const common = [
    `Brief automatique de l'orchestrateur DG.`,
    `Semaine ${semaine}.`,
    ``,
    tallyBlock,
    ``,
    `## Memoire partagee`,
    ``,
    `Tu as acces au memory store partage monte a /mnt/memory/arty/. AVANT de produire ton livrable :`,
    `1. Lis /mnt/memory/arty/contexte/* (objectifs, audience, contraintes de style)`,
    `2. Lis /mnt/memory/arty/historique/cycles/ (tes cycles precedents)`,
    `3. Pour growth : aussi /mnt/memory/arty/outreach/cibles-s1.md`,
    ``,
    `APRES avoir produit ton livrable, ecris-le dans /mnt/memory/arty/historique/cycles/${weekEnd.toISOString().slice(0, 10)}-${role}.md pour que les futurs cycles puissent s'y referer.`,
    ``,
    `## Ton brief pour ce cycle`,
    ``,
  ].join("\n");

  if (role === "analytics") {
    return common + [
      `Produis le digest hebdo selon ton format strict.`,
      `Note : Google Sheet waitlist non encore acessible programmatiquement. Marque "donnee manquante" pour les compteurs et indique a Florent comment exposer le CSV public.`,
      `Inclus une section "Recommandations pour le DG" classees par impact/effort.`,
    ].join("\n");
  }
  if (role === "growth") {
    return common + [
      `Produis ton journal hebdo selon ton format strict.`,
      `Concentre-toi sur la veille communautes FR (3-5 conversations a engager) et l'etat des 5 cibles outreach S1.`,
      `Ne produis pas de contenu (carrousels, articles), c'est le job d'Arty Content FR.`,
    ].join("\n");
  }
  // content
  return common + [
    `Produis tes contenus prets a publier pour la semaine suivante.`,
    `Cycle hebdo : 3 publications dont au moins 1 carrousel Insta, 1 slideshow TikTok, 1 article blog SEO (tryarty.com/blog). FACEBOOK EXCLU depuis le 17/05/2026, voir /mnt/memory/arty/contexte/objectifs.md.`,
    `Respect strict : zero tiret cadratin, voix founder, CTA tryarty.com/waitlist, "Arty arrive en juillet" jamais "dispo".`,
  ].join("\n");
}

function buildBriefDG(
  weekStart: Date,
  weekEnd: Date,
  cycleN: number,
  outputs: { analytics: string; growth: string; content: string },
  tallyBlock: string,
): string {
  const aujourd = new Date().toISOString().slice(0, 10);
  const sem = `du ${fmtDate(weekStart)} au ${fmtDate(weekEnd)}`;

  // On previent le DG si un sub-agent a echoue
  const status = (s: string) => (s && s.length > 200 ? "OK" : "VIDE OU TRES COURT");

  return [
    `# Brief DG - Cycle hebdo #${cycleN} - ${aujourd}`,
    ``,
    `Tu recois les 3 livraisons de tes employes (Growth FR, Content FR, Analytics) pour la semaine ${sem}.`,
    `Date d'aujourd'hui : ${aujourd}.`,
    `Objectif rappel : 500 inscrits waitlist au 30 juin 2026.`,
    ``,
    tallyBlock,
    ``,
    `## Memoire partagee`,
    ``,
    `Avant de produire le digest, lis /mnt/memory/arty/contexte/* (objectifs, audience, contraintes) ET /mnt/memory/arty/historique/cycles/ (les digests passes) pour suivre ce qui a deja ete decide et evite la repetition.`,
    ``,
    `A la fin, ecris le digest final dans /mnt/memory/arty/historique/cycles/${weekEnd.toISOString().slice(0, 10)}-dg-digest.md pour que les futurs cycles s'y referent.`,
    ``,
    `Si tu prends une decision strategique notable, ajoute-la a /mnt/memory/arty/decisions/registre.md (append, ne pas ecraser).`,
    ``,
    `---`,
    ``,
    `## Status des 3 sous-agents`,
    `- Analytics : ${status(outputs.analytics)}`,
    `- Growth FR : ${status(outputs.growth)}`,
    `- Content FR : ${status(outputs.content)}`,
    ``,
    `## Livrable 1 - Arty Analytics`,
    ``,
    outputs.analytics || "Pas d'output disponible. Marque ce gap dans tes alertes.",
    ``,
    `---`,
    ``,
    `## Livrable 2 - Arty Growth FR`,
    ``,
    outputs.growth || "Pas d'output disponible. Marque ce gap dans tes alertes.",
    ``,
    `---`,
    ``,
    `## Livrable 3 - Arty Content FR`,
    ``,
    outputs.content || "Pas d'output disponible. Marque ce gap dans tes alertes.",
    ``,
    `---`,
    ``,
    `# Ton job maintenant`,
    ``,
    `Produis le digest hebdo selon ton format strict (Markdown), pret a etre poste sur Discord pour Florent.`,
    `Rappels critiques :`,
    `- Zero tiret cadratin.`,
    `- Voix DG operationnelle, tutoiement, contractions.`,
    `- Decisions chiffrees ou "donnee manquante".`,
    `- Toute publication = preview + validation Florent (jamais d'auto-post).`,
    `- Toute action budget/argent = validation Florent.`,
    `- CTA = tryarty.com/waitlist. "Arty arrive en juillet" jamais "dispo".`,
    ``,
    `Inclus ton TL;DR en haut, le plan de la semaine, les items a valider, la synthese par sub-agent (3-5 lignes chaque, pas de copier-coller), les alertes, et les decisions strategiques en attente.`,
    `Lance-toi.`,
  ].join("\n");
}

// ===========================================================================
// 2.5 SCREENSHOTS via memory store
// ===========================================================================

/**
 * Recupere le contenu d'une memory par son path. Renvoie null si introuvable.
 */
async function fetchMemoryByPath(env: Env, path: string): Promise<string | null> {
  const normalized = path.startsWith("/") ? path : "/" + path;
  // Limite KV/Anthropic : on liste 100 max. Pour la v1 on suppose < 100 memories.
  const listRes = await fetch(
    `${ANTHROPIC_BASE}/memory_stores/${env.MEMORY_STORE_ID}/memories?limit=100`,
    { headers: anthropicHeaders(env.ANTHROPIC_API_KEY) },
  );
  if (!listRes.ok) return null;
  const list = (await listRes.json()) as { data?: Array<{ path?: string; id?: string }> };
  const found = list.data?.find((m) => m.path === normalized);
  if (!found?.id) return null;
  const memRes = await fetch(
    `${ANTHROPIC_BASE}/memory_stores/${env.MEMORY_STORE_ID}/memories/${found.id}`,
    { headers: anthropicHeaders(env.ANTHROPIC_API_KEY) },
  );
  if (!memRes.ok) return null;
  const mem = (await memRes.json()) as { content?: string };
  return mem.content || null;
}

interface ScreenshotAttachment {
  filename: string;
  data: Uint8Array;
  caption: string;
}

/**
 * Parse le texte d'un agent pour extraire les marqueurs <screenshot path="..." caption="..."/>.
 * Pour chaque marqueur : recupere le contenu en base64 depuis le memory store, decode,
 * et le prepare comme attachment Discord. Le texte est nettoye (marqueurs remplaces par une legende lisible).
 */
async function extractScreenshots(
  text: string,
  env: Env,
): Promise<{ cleanText: string; attachments: ScreenshotAttachment[] }> {
  const attachments: ScreenshotAttachment[] = [];
  const regex = /<screenshot\s+path="([^"]+)"(?:\s+caption="([^"]*)")?\s*\/?>/g;
  const replacements: Array<[string, string]> = [];
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = regex.exec(text)) !== null) {
    const path = match[1];
    const caption = (match[2] || "").trim();
    const full = match[0];
    idx++;

    try {
      const b64Content = await fetchMemoryByPath(env, path);
      if (!b64Content) {
        replacements.push([full, `[screenshot ${idx} : fichier introuvable ${path}]`]);
        continue;
      }
      // Le contenu peut avoir des espaces / newlines, on nettoie
      const clean = b64Content.replace(/\s/g, "");
      const binary = atob(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const baseName = path.split("/").pop() || `screenshot-${idx}`;
      const filename = baseName.replace(/\.b64$/, "").endsWith(".png")
        ? baseName.replace(/\.b64$/, "")
        : `${baseName.replace(/\.b64$/, "")}.png`;

      attachments.push({ filename, data: bytes, caption });
      replacements.push([full, caption ? `📸 ${caption}` : `📸 (piece jointe ${filename})`]);
    } catch (err) {
      console.error(`[screenshot] decode err for ${path}: ${err}`);
      replacements.push([full, `[screenshot ${idx} : erreur decode]`]);
    }
  }

  let cleanText = text;
  for (const [from, to] of replacements) {
    cleanText = cleanText.replace(from, to);
  }
  return { cleanText, attachments };
}

// ===========================================================================
// 3. DISCORD POSTING
// ===========================================================================

const DISCORD_API = "https://discord.com/api/v10";

async function discordPostMessage(env: Env, content: string): Promise<void> {
  // Limite Discord : 2000 chars / message. On split intelligemment sur les sauts de ligne.
  const chunks = splitForDiscord(content, 1900);
  for (const chunk of chunks) {
    const res = await fetch(`${DISCORD_API}/channels/${env.DISCORD_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: chunk }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[discord] post failed ${res.status}: ${err.slice(0, 200)}`);
      // On continue quand meme les chunks suivants
    }
    // Petite pause pour respecter le rate limit Discord (5 req/sec channel)
    await sleep(300);
  }
}

function splitForDiscord(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";
  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length > max) {
      if (current) chunks.push(current);
      // Si un paragraphe lui-meme depasse, on split sur les lignes
      if (p.length > max) {
        const lines = p.split("\n");
        let buf = "";
        for (const line of lines) {
          if ((buf + "\n" + line).length > max) {
            if (buf) chunks.push(buf);
            buf = line.length > max ? line.slice(0, max) : line;
          } else {
            buf = buf ? buf + "\n" + line : line;
          }
        }
        if (buf) {
          current = buf;
        } else {
          current = "";
        }
      } else {
        current = p;
      }
    } else {
      current = current ? current + "\n\n" + p : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ===========================================================================
// 4. DISCORD INTERACTION SIGNATURE VERIFICATION (Ed25519)
// ===========================================================================

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function verifyDiscordRequest(request: Request, body: string, publicKeyHex: string): Promise<boolean> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(timestamp + body);
    const sigBytes = hexToBytes(signature);
    return await crypto.subtle.verify("Ed25519", key, sigBytes, signed);
  } catch (err) {
    console.error(`[discord-sig] error: ${err}`);
    return false;
  }
}

// ===========================================================================
// 5. CYCLE PRINCIPAL
// ===========================================================================

/**
 * Lance le cycle hebdo en mode webhook-driven.
 *
 * Flow :
 *  1. Initialise le cycle state en KV (`cycle:{date}:meta`)
 *  2. Cree 3 sessions Anthropic en parallele (analytics, growth, content), envoie les briefs
 *  3. Stocke chaque session -> {type: weekly_subagent, role, cycleId} en KV
 *  4. RETURN (fin de l'invocation Worker, < 5s typique)
 *  5. Anthropic ping notre webhook quand chaque sub-agent est idle
 *  6. handleSubAgentDone accumule les outputs, declenche le DG quand les 3 sont la
 *  7. Anthropic ping pour le DG idle -> handleWeeklyDgDone post le digest sur Discord
 */
async function runWeeklyCycle(env: Env): Promise<void> {
  const now = new Date();
  const { start, end, cycleN } = getWeekRange(now);
  const cycleId = end.toISOString().slice(0, 10);
  console.log(`[cycle] launching #${cycleN} (id=${cycleId})`);

  // 1. Init cycle meta
  const meta: CycleMeta = {
    cycleId,
    cycleN,
    weekStart: start.toISOString(),
    weekEnd: end.toISOString(),
  };
  await env.INTERACTIONS.put(`cycle:${cycleId}:meta`, JSON.stringify(meta), {
    expirationTtl: 4 * 3600,
  });

  // 2. Lance les 3 sub-agents en parallele
  const roleAgentMap: Record<string, string> = {
    analytics: env.AGENT_ANALYTICS_ID,
    growth: env.AGENT_GROWTH_FR_ID,
    content: env.AGENT_CONTENT_FR_ID,
  };

  // Fetch les stats Tally UNE fois pour l'ensemble du cycle (les 3 sub-agents partagent)
  const tallyBlock = await fetchTallyStats(env);
  // Stocker les stats dans la cycle meta pour les re-injecter dans le brief DG plus tard
  await env.INTERACTIONS.put(`cycle:${cycleId}:tally`, tallyBlock, { expirationTtl: 4 * 3600 });

  await Promise.all(
    (Object.entries(roleAgentMap) as Array<["analytics" | "growth" | "content", string]>).map(
      async ([role, agentId]) => {
        const brief = buildBriefSubAgent(role, start, end, tallyBlock);
        const title = `${role} - cycle #${cycleN}`;

        const created = await createSession(env.ANTHROPIC_API_KEY, agentId, env.ANTHROPIC_ENV_ID, title, env.MEMORY_STORE_ID);
        if (!created.ok) {
          console.error(`[cycle] create ${role} failed: ${created.err}`);
          return;
        }
        const sent = await sendUserMessage(env.ANTHROPIC_API_KEY, created.id, brief);
        if (!sent.ok) {
          console.error(`[cycle] send ${role} failed: ${sent.err}`);
          return;
        }
        const pending: PendingInteraction = {
          type: "weekly_subagent",
          role,
          cycleId,
          createdAt: Date.now(),
        };
        await env.INTERACTIONS.put(`sess:${created.id}`, JSON.stringify(pending), {
          expirationTtl: 4 * 3600,
        });
        console.log(`[cycle] ${role} session ${created.id} launched`);
      },
    ),
  );

  console.log(`[cycle] 3 sub-agents launched. Waiting for webhooks.`);
}

/**
 * Une session sub-agent est terminee : on stocke son output, on check si tous les 3
 * roles sont la, et si oui on declenche la session DG.
 */
async function handleSubAgentDone(env: Env, pending: PendingInteraction, sessionId: string): Promise<void> {
  if (!pending.role || !pending.cycleId) {
    console.error(`[cycle] sub-agent webhook with missing role/cycleId`);
    return;
  }
  const cycleId = pending.cycleId;
  const role = pending.role;

  // 1. Recuperer le texte de la session
  const text = await fetchAgentText(env.ANTHROPIC_API_KEY, sessionId);

  // Stocker l'output (pour ce cycle, court TTL). Le sub-agent l'a aussi ecrit
  // dans /mnt/memory/arty/historique/cycles/ pour la memoire long terme.
  await env.INTERACTIONS.put(`cycle:${cycleId}:${role}`, text, { expirationTtl: 4 * 3600 });
  console.log(`[cycle] ${role} output stored (${text.length} chars) for cycle ${cycleId}`);

  // 3. Check si les 3 sub-agents sont tous done
  const expected = ["analytics", "growth", "content"];
  const results = await Promise.all(
    expected.map((r) => env.INTERACTIONS.get(`cycle:${cycleId}:${r}`)),
  );
  const present = results.filter((r) => r !== null && r !== undefined);
  if (present.length < expected.length) {
    console.log(`[cycle] ${role} done, ${present.length}/${expected.length} sub-agents received`);
    return;
  }

  // 4. Lock pour eviter le double-lancement du DG (race possible si 2 webhooks arrivent en parallele)
  const lockKey = `cycle:${cycleId}:dg-lock`;
  const lockExisting = await env.INTERACTIONS.get(lockKey);
  if (lockExisting) {
    console.log(`[cycle] DG already launched by another handler, skipping`);
    return;
  }
  await env.INTERACTIONS.put(lockKey, new Date().toISOString(), { expirationTtl: 4 * 3600 });

  // 5. Recuperer la meta + lancer le DG
  const metaStr = await env.INTERACTIONS.get(`cycle:${cycleId}:meta`);
  if (!metaStr) {
    console.error(`[cycle] meta missing for ${cycleId}`);
    return;
  }
  const meta: CycleMeta = JSON.parse(metaStr);
  const [analytics, growth, content] = results;
  // Recuperer les stats Tally stockees au lancement du cycle (ou re-fetch si manquant)
  const tallyStored = await env.INTERACTIONS.get(`cycle:${cycleId}:tally`);
  const tallyBlock = tallyStored || (await fetchTallyStats(env));

  const dgBrief = buildBriefDG(
    new Date(meta.weekStart),
    new Date(meta.weekEnd),
    meta.cycleN,
    { analytics: analytics || "", growth: growth || "", content: content || "" },
    tallyBlock,
  );

  const created = await createSession(
    env.ANTHROPIC_API_KEY,
    env.AGENT_DG_ID,
    env.ANTHROPIC_ENV_ID,
    `DG - cycle #${meta.cycleN}`,
    env.MEMORY_STORE_ID,
    {
      url: env.GITHUB_REPO_URL,
      mountPath: env.GITHUB_REPO_MOUNT,
      token: env.GITHUB_TOKEN,
    },
  );
  if (!created.ok) {
    console.error(`[cycle] DG create failed: ${created.err}`);
    await discordPostMessage(env, `Erreur cycle #${meta.cycleN} : impossible de creer la session DG (${created.err.slice(0, 200)}).`);
    return;
  }
  const sent = await sendUserMessage(env.ANTHROPIC_API_KEY, created.id, dgBrief);
  if (!sent.ok) {
    console.error(`[cycle] DG send failed: ${sent.err}`);
    return;
  }

  const dgPending: PendingInteraction = {
    type: "weekly_dg",
    cycleId,
    role: "dg",
    createdAt: Date.now(),
  };
  await env.INTERACTIONS.put(`sess:${created.id}`, JSON.stringify(dgPending), { expirationTtl: 4 * 3600 });
  console.log(`[cycle] DG session ${created.id} launched for cycle ${cycleId}`);
}

/**
 * La session DG du cycle hebdo est terminee : on poste le digest sur le canal Discord.
 */
async function handleWeeklyDgDone(env: Env, pending: PendingInteraction, sessionId: string): Promise<void> {
  if (!pending.cycleId) {
    console.error(`[cycle] DG webhook with missing cycleId`);
    return;
  }
  const cycleId = pending.cycleId;
  const text = await fetchAgentText(env.ANTHROPIC_API_KEY, sessionId);
  const metaStr = await env.INTERACTIONS.get(`cycle:${cycleId}:meta`);
  const meta: CycleMeta | null = metaStr ? JSON.parse(metaStr) : null;

  const start = meta ? new Date(meta.weekStart) : new Date();
  const end = meta ? new Date(meta.weekEnd) : new Date();
  const cycleN = meta?.cycleN ?? "?";

  // Memoire long terme : geree par le memory store Anthropic (le DG ecrit lui-meme
  // dans /mnt/memory/arty/historique/cycles/ pendant sa session).

  const header = `# Digest Arty - cycle #${cycleN} (${fmtDate(start)} au ${fmtDate(end)})\n_Genere automatiquement le ${new Date().toLocaleString("fr-FR")} par Arty DG._\n\n---\n\n`;
  await discordPostMessage(env, header + (text || "Le DG a fini sa session mais n'a renvoye aucun texte."));
  console.log(`[cycle] digest poste sur Discord pour cycle ${cycleId}`);

  // Cleanup : supprimer les outputs sub-agents et la meta (laisser le lock expirer naturellement)
  await Promise.all([
    env.INTERACTIONS.delete(`cycle:${cycleId}:analytics`),
    env.INTERACTIONS.delete(`cycle:${cycleId}:growth`),
    env.INTERACTIONS.delete(`cycle:${cycleId}:content`),
    env.INTERACTIONS.delete(`cycle:${cycleId}:meta`),
  ]);
}

// ===========================================================================
// 6. INTERACTION DISCORD (slash command /dg + boutons)
// ===========================================================================

interface DiscordInteraction {
  type: number; // 1=PING, 2=APPLICATION_COMMAND, 3=MESSAGE_COMPONENT
  token: string; // pour les follow-ups webhook
  data?: {
    name?: string;
    options?: Array<{ name: string; value: string }>;
    custom_id?: string;
  };
  member?: { user?: { id: string; username: string } };
  user?: { id: string; username: string };
  channel_id?: string;
}

async function registerDiscordCommands(env: Env): Promise<{ ok: boolean; detail: string }> {
  // Slash command /dg <message>
  const commands = [
    {
      name: "dg",
      description: "Parle au DG d'Arty Growth Inc.",
      options: [
        {
          name: "message",
          description: "Ton message ou ta question pour Arty DG",
          type: 3, // STRING
          required: true,
        },
      ],
    },
  ];
  // Enregistre sur le guild (instantane, vs commands globales = 1h de cache)
  const url = `${DISCORD_API}/applications/${env.DISCORD_APPLICATION_ID}/guilds/${env.DISCORD_GUILD_ID}/commands`;
  const res = await fetch(url, {
    method: "PUT", // PUT remplace toutes les commands du guild en une fois
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, detail: `${res.status}: ${text.slice(0, 300)}` };
  }
  return { ok: true, detail: `Registered ${commands.length} command(s)` };
}

async function handleDiscordInteraction(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // PING : echange pour activer l'endpoint
  if (interaction.type === 1) {
    return new Response(JSON.stringify({ type: 1 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Slash command /dg <texte>
  if (interaction.type === 2 && interaction.data?.name === "dg") {
    const userMessage = interaction.data.options?.find((o) => o.name === "message")?.value || "";

    // Reponse differee (le DG peut prendre 30s a 3 min) : on repond type 5 (DEFERRED_CHANNEL_MESSAGE)
    // et on travaille en background
    ctx.waitUntil(handleDGAdhoc(env, userMessage, interaction));

    return new Response(
      JSON.stringify({ type: 5 }), // ACK avec "thinking..." visible cote Florent
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Commande inconnue
  return new Response(
    JSON.stringify({
      type: 4,
      data: { content: "Commande non reconnue. Essaye `/dg <ton message>`.", flags: 64 },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Cree la session DG, envoie le brief, stocke le mapping session->interaction en KV.
 * NE BLOQUE PAS sur la fin de la session : Anthropic notifiera via webhook quand idle.
 * Cette fonction doit retourner en < 1 seconde pour respecter les limites CPU Workers.
 */
async function handleDGAdhoc(env: Env, userMessage: string, interaction: DiscordInteraction): Promise<void> {
  const aujourd = new Date().toISOString().slice(0, 10);
  const username = interaction.member?.user?.username || interaction.user?.username || "Florent";
  console.log(`[adhoc] start, user=${username}, msg="${userMessage.slice(0, 80)}"`);

  // Stats waitlist en temps reel via Tally
  const tallyBlock = await fetchTallyStats(env);

  const brief = [
    `# Message ad-hoc de Florent`,
    ``,
    `Date : ${aujourd}`,
    `Utilisateur Discord : ${username}`,
    ``,
    tallyBlock,
    ``,
    `## Memoire partagee`,
    ``,
    `Tu as acces a /mnt/memory/arty/. Avant de repondre :`,
    `- Si la question implique un contexte produit / strategie : consulte /mnt/memory/arty/contexte/*`,
    `- Si la question fait reference a un truc passe : consulte /mnt/memory/arty/historique/adhoc/ et /mnt/memory/arty/historique/cycles/`,
    ``,
    `Apres ta reponse, ecris un resume de l'echange dans /mnt/memory/arty/historique/adhoc/${new Date().toISOString().replace(/[:.]/g, "-")}.md (1 fichier = 1 interaction).`,
    ``,
    `Si Florent t'apprend un fait stable qu'il faudra retenir longtemps (ex: une preference, une contrainte), append dans /mnt/memory/arty/contexte/notes-florent.md.`,
    ``,
    `## Capacite screenshot (NEW)`,
    ``,
    `Tu as Chromium pre-installe dans ton container. Si Florent te demande un screenshot d'une page web, lis /mnt/memory/arty/contexte/howto-screenshot.md pour la procedure complete. Tu ecris le PNG en base64 dans /mnt/memory/arty/livraisons/, et tu inclus un marqueur \`<screenshot path="/livraisons/xxx.b64" caption="..."/>\` dans ta reponse. Le Worker convertira automatiquement en piece jointe Discord.`,
    ``,
    `## Acces au code source Arty (NEW)`,
    ``,
    `Le repo prive \`flotellop-art/Arty\` est clone dans ton container a \`/workspace/arty/\`. Tu peux donc explorer le code, les commits, le CLAUDE.md de Florent, etc. via bash (cat, grep, find, git log...). Lis /mnt/memory/arty/contexte/acces-repo-github.md pour les bonnes pratiques. Read-only, pas de push possible.`,
    ``,
    `## Message de Florent`,
    userMessage,
    ``,
    `---`,
    ``,
    `Reponds-lui directement, court et actionnable. Format Discord (3-15 lignes, pas de TL;DR si reponse courte).`,
    `Si la question demande l'avis des sub-agents, dis ce que tu ferais en attendant le prochain cycle dominical.`,
    `Si l'action sort de tes pouvoirs (budget, publication directe, code), explique brievement et propose les boutons de validation.`,
  ].join("\n");

  // 1. Creer la session DG
  const created = await createSession(
    env.ANTHROPIC_API_KEY,
    env.AGENT_DG_ID,
    env.ANTHROPIC_ENV_ID,
    `DG ad-hoc - ${aujourd}`,
    env.MEMORY_STORE_ID,
    {
      url: env.GITHUB_REPO_URL,
      mountPath: env.GITHUB_REPO_MOUNT,
      token: env.GITHUB_TOKEN,
    },
  );
  if (!created.ok) {
    console.error(`[adhoc] create session failed: ${created.err}`);
    await patchDiscordOriginal(env, interaction.token, `Erreur creation session DG : ${created.err.slice(0, 200)}`);
    return;
  }
  const sessionId = created.id;
  console.log(`[adhoc] session created: ${sessionId}`);

  // 2. Envoyer le brief
  const sent = await sendUserMessage(env.ANTHROPIC_API_KEY, sessionId, brief);
  if (!sent.ok) {
    console.error(`[adhoc] send message failed: ${sent.err}`);
    await patchDiscordOriginal(env, interaction.token, `Erreur envoi brief : ${sent.err?.slice(0, 200)}`);
    return;
  }

  // 3. Stocker le mapping session -> interaction en KV (TTL 14 min)
  // Token Discord d'interaction = 15 min valide.
  const pending: PendingInteraction = {
    interactionToken: interaction.token,
    type: "adhoc",
    role: "dg",
    createdAt: Date.now(),
  };
  await env.INTERACTIONS.put(`sess:${sessionId}`, JSON.stringify(pending), {
    expirationTtl: 14 * 60, // 14 minutes
  });
  console.log(`[adhoc] stored in KV: sess:${sessionId}`);

  // 4. Fin de l'invocation. Le webhook Anthropic ping notre /anthropic/webhook
  //    quand la session passe en idle. handleAnthropicWebhook fera le PATCH Discord.
}

/**
 * PATCH le message d'origine d'une interaction Discord avec un nouveau contenu.
 * Si attachments fournis : utilise multipart/form-data pour les inclure en pieces jointes.
 */
async function patchDiscordOriginal(
  env: Env,
  interactionToken: string,
  content: string,
  attachments: ScreenshotAttachment[] = [],
): Promise<void> {
  const chunks = splitForDiscord(content, 1900);
  const url = `${DISCORD_API}/webhooks/${env.DISCORD_APPLICATION_ID}/${interactionToken}/messages/@original`;

  if (attachments.length === 0) {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: chunks[0] }),
    });
    if (!res.ok) {
      console.error(`[discord] PATCH @original ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  } else {
    // PATCH multipart avec les pieces jointes sur le 1er chunk
    const form = new FormData();
    form.append(
      "payload_json",
      JSON.stringify({
        content: chunks[0],
        attachments: attachments.map((a, i) => ({ id: i, filename: a.filename })),
      }),
    );
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i];
      const blob = new Blob([a.data], { type: "image/png" });
      form.append(`files[${i}]`, blob, a.filename);
    }
    const res = await fetch(url, { method: "PATCH", body: form });
    if (!res.ok) {
      console.error(`[discord] PATCH @original (with attachments) ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } else {
      console.log(`[discord] PATCH @original OK avec ${attachments.length} piece(s) jointe(s)`);
    }
  }

  for (let i = 1; i < chunks.length; i++) {
    await fetch(`${DISCORD_API}/webhooks/${env.DISCORD_APPLICATION_ID}/${interactionToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: chunks[i] }),
    });
    await sleep(200);
  }
}

// ===========================================================================
// 6.5 ANTHROPIC WEBHOOK (signature HMAC SHA256)
// ===========================================================================

/**
 * Verifie la signature d'un webhook Anthropic (format Standard Webhooks).
 *
 * Headers Anthropic :
 *  - webhook-id        : "whe_..."
 *  - webhook-timestamp : unix timestamp en secondes
 *  - webhook-signature : "v1,BASE64_SIG" (peut etre plusieurs separes par espaces)
 *
 * Verification :
 *  - signed_payload = `${webhook-id}.${webhook-timestamp}.${body}`
 *  - HMAC-SHA256 avec key = base64-decoded(secret apres prefix "whsec_")
 *  - Compare en base64
 *  - Rejette si timestamp > 5 min dans le passe (anti-replay)
 *
 * Spec : https://www.standardwebhooks.com/
 */
async function verifyAnthropicWebhook(
  body: string,
  webhookId: string | null,
  webhookTimestamp: string | null,
  signatureHeader: string | null,
  signingKey: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!signatureHeader) return { ok: false, reason: "missing webhook-signature header" };
  if (!webhookId) return { ok: false, reason: "missing webhook-id header" };
  if (!webhookTimestamp) return { ok: false, reason: "missing webhook-timestamp header" };
  if (!signingKey) return { ok: false, reason: "ANTHROPIC_WEBHOOK_SIGNING_KEY non configure" };

  // Anti-replay : timestamp < 5 min de tolerance
  const tsSec = parseInt(webhookTimestamp, 10);
  if (!Number.isFinite(tsSec)) return { ok: false, reason: "invalid webhook-timestamp" };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsSec) > 300) {
    return { ok: false, reason: `stale timestamp (delta=${nowSec - tsSec}s)` };
  }

  // Extraire la cle binaire depuis "whsec_BASE64_KEY"
  const cleanKey = signingKey.startsWith("whsec_") ? signingKey.slice(6) : signingKey;
  let keyBytes: Uint8Array;
  try {
    const bin = atob(cleanKey);
    keyBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) keyBytes[i] = bin.charCodeAt(i);
  } catch {
    return { ok: false, reason: "invalid base64 signing key" };
  }

  // Construire le payload signe
  const signedPayload = `${webhookId}.${webhookTimestamp}.${body}`;

  // Calculer la signature attendue
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(signedPayload));
  const sigBytes = new Uint8Array(sigBuf);
  const expectedB64 = btoa(String.fromCharCode(...sigBytes));

  // Le header peut contenir plusieurs versions separees par espaces : "v1,SIG1 v1,SIG2"
  const parts = signatureHeader.trim().split(/\s+/);
  for (const part of parts) {
    const m = part.match(/^v1,(.+)$/);
    if (!m) continue;
    const provided = m[1];
    if (provided === expectedB64) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "signature mismatch" };
}

/**
 * Webhook Anthropic. Audit secu :
 *  - Authentification : signature HMAC SHA256 verifiee avec ANTHROPIC_WEBHOOK_SIGNING_KEY.
 *  - Autorisation : on filtre que sur les sessions trackees en KV (creees par nous).
 *    Session inconnue -> 200 silent (pas de leak d'info).
 *  - Abus : retry de Anthropic est at-least-once, on dedup via le KV (delete apres delivery).
 *  - Leak : reponses 200/400 sans details.
 *  - Stocke en KV : juste interactionToken + type, pas de PII.
 */
async function handleAnthropicWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await request.text();
  const webhookId = request.headers.get("webhook-id");
  const webhookTs = request.headers.get("webhook-timestamp");
  const webhookSig = request.headers.get("webhook-signature");

  const verif = await verifyAnthropicWebhook(
    body,
    webhookId,
    webhookTs,
    webhookSig,
    env.ANTHROPIC_WEBHOOK_SIGNING_KEY,
  );
  if (!verif.ok) {
    console.warn(`[webhook] sig FAIL: ${verif.reason}`);
    return new Response(`signature error: ${verif.reason}`, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const eventType = event?.data?.type;
  const sessionId = event?.data?.id;
  console.log(`[webhook] event=${eventType} session=${sessionId}`);

  // On ne traite que les session.status_idled et session.status_terminated
  if (eventType !== "session.status_idled" && eventType !== "session.status_terminated") {
    return new Response("ignored", { status: 200 });
  }
  if (!sessionId) return new Response("no session id", { status: 200 });

  // Lookup KV
  const kvKey = `sess:${sessionId}`;
  const stored = await env.INTERACTIONS.get(kvKey);
  if (!stored) {
    console.log(`[webhook] session ${sessionId} non trackee, ignore`);
    return new Response("not tracked", { status: 200 });
  }
  const pending: PendingInteraction = JSON.parse(stored);

  // Delete tout de suite pour eviter les double-delivery (Anthropic retries at-least-once)
  await env.INTERACTIONS.delete(kvKey);

  // Faire le travail Discord en background pour acquitter Anthropic en < 1s
  ctx.waitUntil(deliverSessionResultToDiscord(env, pending, sessionId, eventType));

  return new Response(null, { status: 204 });
}

async function deliverSessionResultToDiscord(
  env: Env,
  pending: PendingInteraction,
  sessionId: string,
  eventType: string,
): Promise<void> {
  try {
    // Cas terminated : notifier l'erreur selon le type
    if (eventType === "session.status_terminated") {
      const msg = `Erreur : la session s'est terminee anormalement cote Anthropic. Type=${pending.type}, role=${pending.role ?? "?"}, session=${sessionId}.`;
      console.error(`[webhook] terminated: ${msg}`);
      if (pending.type === "adhoc" && pending.interactionToken) {
        await patchDiscordOriginal(env, pending.interactionToken, msg);
      } else {
        await discordPostMessage(env, msg);
      }
      return;
    }

    // Dispatch sur le type
    if (pending.type === "adhoc") {
      if (!pending.interactionToken) {
        console.error(`[webhook] adhoc without interactionToken`);
        return;
      }
      const rawText = await fetchAgentText(env.ANTHROPIC_API_KEY, sessionId);
      const baseText = rawText && rawText.trim().length > 0
        ? rawText
        : "Le DG a fini la session mais n'a rien renvoye comme texte.";

      // Parser les marqueurs <screenshot path="..."/> et recuperer les images en pieces jointes
      const { cleanText, attachments } = await extractScreenshots(baseText, env);
      console.log(`[webhook] adhoc : ${attachments.length} screenshot(s) extrait(s)`);

      await patchDiscordOriginal(env, pending.interactionToken, cleanText, attachments);
      console.log(`[webhook] adhoc delivered to Discord (sess=${sessionId}, attachments=${attachments.length})`);
      return;
    }

    if (pending.type === "weekly_subagent") {
      await handleSubAgentDone(env, pending, sessionId);
      return;
    }

    if (pending.type === "weekly_dg") {
      await handleWeeklyDgDone(env, pending, sessionId);
      return;
    }

    console.warn(`[webhook] unknown pending type: ${pending.type}`);
  } catch (err) {
    console.error(`[webhook] deliver error: ${err}`);
  }
}

// ===========================================================================
// 7. EXPORT HANDLERS
// ===========================================================================

export default {
  /**
   * Cron : tous les dimanches 18h UTC.
   */
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runWeeklyCycle(env);
  },

  /**
   * HTTP : 3 routes.
   *   POST /trigger : run manuel (auth X-Trigger-Secret)
   *   POST /discord/interactions : webhook Discord (auth Ed25519)
   *   GET  /        : healthcheck
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Healthcheck
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(
        JSON.stringify({
          service: "arty-growth-orchestrator",
          version: "2.0",
          ts: new Date().toISOString(),
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // /trigger : run manuel
    if (url.pathname === "/trigger" && request.method === "POST") {
      const auth = request.headers.get("X-Trigger-Secret");
      if (!env.TRIGGER_SECRET || !auth || auth !== env.TRIGGER_SECRET) {
        return new Response("Not Found", { status: 404 });
      }
      ctx.waitUntil(runWeeklyCycle(env));
      return new Response(JSON.stringify({ status: "triggered", at: new Date().toISOString() }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }

    // /admin/register-commands : enregistre la slash command /dg sur le guild Discord
    if (url.pathname === "/admin/register-commands" && request.method === "POST") {
      const auth = request.headers.get("X-Trigger-Secret");
      if (!env.TRIGGER_SECRET || !auth || auth !== env.TRIGGER_SECRET) {
        return new Response("Not Found", { status: 404 });
      }
      const result = await registerDiscordCommands(env);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // /admin/post-test : poste un message de test sur Discord pour valider le canal/bot
    if (url.pathname === "/admin/post-test" && request.method === "POST") {
      const auth = request.headers.get("X-Trigger-Secret");
      if (!env.TRIGGER_SECRET || !auth || auth !== env.TRIGGER_SECRET) {
        return new Response("Not Found", { status: 404 });
      }
      try {
        await discordPostMessage(env, `Test de connexion bot - ${new Date().toISOString()}\n\nSi tu vois ce message, le bot Discord est correctement connecte au canal #dg.`);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, err: String(err) }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // /anthropic/webhook : reception des events Anthropic (session.status_idled)
    if (url.pathname === "/anthropic/webhook" && request.method === "POST") {
      return handleAnthropicWebhook(request, env, ctx);
    }

    // /discord/interactions : webhook Discord
    if (url.pathname === "/discord/interactions" && request.method === "POST") {
      const body = await request.text();
      const valid = await verifyDiscordRequest(request, body, env.DISCORD_PUBLIC_KEY);
      if (!valid) {
        return new Response("invalid request signature", { status: 401 });
      }
      let interaction: DiscordInteraction;
      try {
        interaction = JSON.parse(body);
      } catch {
        return new Response("invalid json", { status: 400 });
      }
      return handleDiscordInteraction(interaction, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },
};

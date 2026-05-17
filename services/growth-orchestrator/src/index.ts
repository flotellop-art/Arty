/**
 * Arty Growth Orchestrator
 *
 * Cron Worker qui s'execute chaque dimanche 18h UTC.
 * - Lance les 3 agents (Growth FR v6, Content FR, Analytics) en parallele
 *   sur platform.claude.com via l'API Anthropic Agents.
 * - Attend leurs livrables.
 * - Consolide en un digest hebdo Markdown puis HTML.
 * - Envoie le digest par email a Florent via Resend.
 *
 * SECURITE (cf CLAUDE.md du repo, RÈGLES 1, 2, 6) :
 * - Endpoint cron uniquement, pas exposé aux users -> pas de checkAllowedUser
 *   nécessaire (le cron est triggered par Cloudflare lui-meme).
 * - Cle API Anthropic et Resend stockees comme SECRETS (jamais en clair).
 * - Pas de route fetch publique exposee (uniquement scheduled).
 * - Logs : OK pour observabilite, mais ne PAS logger les API keys ni le
 *   contenu des emails recus en clair.
 */

export interface Env {
  // Secrets (wrangler secret put ...)
  ANTHROPIC_API_KEY: string;
  RESEND_API_KEY: string;

  // Variables non sensibles (vars dans wrangler.toml)
  DIGEST_TO_EMAIL: string;
  DIGEST_FROM_EMAIL: string;
  DIGEST_FROM_NAME: string;
  AGENT_GROWTH_FR_ID: string;
  AGENT_CONTENT_FR_ID: string;
  AGENT_ANALYTICS_ID: string;
  ANTHROPIC_WORKSPACE_ID: string;
  ANTHROPIC_ENV_ID: string;
  SESSION_TIMEOUT_MS: string;
  SESSION_POLL_INTERVAL_MS: string;
}

// Le brief envoye a chaque agent depend de son role.
// L'orchestrateur passe le contexte du week-end (date, semaine ecoulee, hypotheses
// de la semaine precedente quand on aura un journal persistant).
function buildBriefForAgent(
  agentRole: "growth" | "content" | "analytics",
  weekStart: Date,
  weekEnd: Date,
): string {
  const fmt = (d: Date) => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long" });
  const semaine = `${fmt(weekStart)} au ${fmt(weekEnd)}`;

  if (agentRole === "growth") {
    return [
      `Bonjour. Tu es invoque par l'orchestrateur DG dans le cycle hebdo du dimanche.`,
      ``,
      `Semaine ecoulee : ${semaine}.`,
      ``,
      `Mission de cette session :`,
      `1. Veille communautes FR : identifie 3 a 5 conversations recentes (< 14 jours) ou Arty apporterait une vraie valeur, avec drafts a la 1re personne pour Florent.`,
      `2. Suivi outreach : etat des 5 cibles S1 (Korben, Pauline Ebel, Ninon Bajard, Ludo Salenne, Louis Graffeuil) - signale si une cible attend une relance a J+10, propose 3-5 nouvelles cibles S2 si pertinent.`,
      `3. Journal cumulatif : ajoute une entree pour cette semaine.`,
      `4. Suggestions pour Arty Content FR : si tu identifies un theme qui revient dans les conversations, propose-le comme angle pour le prochain contenu.`,
      ``,
      `Contexte : pre-launch (lancement juillet 2026), CTA = tryarty.com/waitlist, voix founder 1re personne, zero cadratin, ton humain parle.`,
      ``,
      `Pour la boucle de feedback Florent : indique en haut "Reponses attendues de Florent au prochain cycle" puis les 3 questions standard.`,
      ``,
      `Lance-toi.`,
    ].join("\n");
  }

  if (agentRole === "content") {
    return [
      `Bonjour. Tu es invoque par l'orchestrateur DG dans le cycle hebdo du dimanche.`,
      ``,
      `Semaine a venir : lundi a vendredi suivant.`,
      ``,
      `Brief de production cette semaine :`,
      `- LUNDI : carrousel Instagram 10 slides. Angle : a determiner selon ce que Growth FR remonte de la veille (theme dominant des conversations FR). Si tu n'as pas de signal fort, prends l'angle "building in public" generique (ce que j'ai construit cette semaine, ou j'en suis).`,
      `- MERCREDI : alterner. Si pair semaine = slideshow TikTok photo. Si impair = post Facebook texte long building in public.`,
      `- VENDREDI : article de blog SEO pour tryarty.com (longue traine non encore exploitee). 1 article sur 4 doit etre un "building in public update" personnel.`,
      ``,
      `Marqueurs [A PERSONNALISER] obligatoires aux endroits ou Florent doit injecter une histoire vraie.`,
      ``,
      `Contexte : pre-launch (lancement juillet 2026), CTA = tryarty.com/waitlist, voix founder 1re personne, zero cadratin, ton humain parle, jamais "Arty est dispo".`,
      ``,
      `Rends les 3 contenus (lundi + mercredi + vendredi) dans un seul livrable structure.`,
      ``,
      `Lance-toi.`,
    ].join("\n");
  }

  // analytics
  return [
    `Bonjour. Tu es invoque par l'orchestrateur DG dans le cycle hebdo du dimanche.`,
    ``,
    `Semaine ecoulee : ${semaine}.`,
    ``,
    `Mission :`,
    `1. Lire le Google Sheet "Arty Waitlist" (https://docs.google.com/spreadsheets/d/1P0eoGiM2gF3LNvFvwBvqJPImtWscV80h-vNUufwCVO0/edit) -- si l'acces n'est pas possible, marque "non accessible cette semaine" et explique comment l'obtenir au prochain cycle.`,
    `2. Compteur waitlist : combien d'inscriptions cumulees ? Combien cette semaine ? Vs objectif hebdo (80/semaine, cible 500 au 30 juin) ?`,
    `3. Si Florent a fourni des chiffres de publication (vues, likes, saves, commentaires des contenus publies cette semaine), les inclure dans le digest. Sinon "donnee manquante - a demander dans le feedback".`,
    `4. Outreach : etat des 5 cibles S1. Taux de reponse vs benchmark sain (15-25%).`,
    `5. Hypotheses : valide/invalide celles formulees la semaine precedente, propose 1-2 nouvelles hypotheses testables.`,
    `6. Recommandations classees impact/effort pour la semaine suivante.`,
    `7. Alerte cadence : OK / RETARD / AVANCE par rapport a l'objectif 500 au 30 juin.`,
    ``,
    `Rends le digest dans le format strict defini dans ton system prompt.`,
    ``,
    `Lance-toi.`,
  ].join("\n");
}

// API Anthropic Agents : creer une session puis envoyer un message.
// Note : l'API publique exacte peut evoluer. On encapsule pour faciliter
// les corrections.
async function runAgentSession(
  apiKey: string,
  workspaceId: string,
  envId: string,
  agentId: string,
  brief: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<{ ok: boolean; output: string; errorMsg?: string; sessionId?: string }> {
  const base = "https://api.anthropic.com/v1";
  const headers = {
    "anthropic-version": "2023-06-01",
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };

  // 1. Creer la session
  let sessionId: string | undefined;
  try {
    const createRes = await fetch(`${base}/agents/${agentId}/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: `Digest hebdo ${new Date().toISOString().slice(0, 10)}`,
        environment: envId,
        workspace_id: workspaceId,
      }),
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      return {
        ok: false,
        output: "",
        errorMsg: `Create session failed: ${createRes.status} ${errText.slice(0, 500)}`,
      };
    }
    const sessionData = (await createRes.json()) as { id?: string; session?: { id?: string } };
    sessionId = sessionData.id ?? sessionData.session?.id;
    if (!sessionId) {
      return { ok: false, output: "", errorMsg: "Session id missing in response" };
    }
  } catch (err) {
    return { ok: false, output: "", errorMsg: `Create session exception: ${err}` };
  }

  // 2. Envoyer le brief
  try {
    const sendRes = await fetch(`${base}/agents/${agentId}/sessions/${sessionId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: brief }),
    });
    if (!sendRes.ok) {
      const errText = await sendRes.text();
      return {
        ok: false,
        output: "",
        sessionId,
        errorMsg: `Send message failed: ${sendRes.status} ${errText.slice(0, 500)}`,
      };
    }
  } catch (err) {
    return { ok: false, output: "", sessionId, errorMsg: `Send message exception: ${err}` };
  }

  // 3. Poll jusqu'a completion ou timeout
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    await sleep(pollIntervalMs);
    try {
      const statusRes = await fetch(`${base}/agents/${agentId}/sessions/${sessionId}`, {
        method: "GET",
        headers,
      });
      if (!statusRes.ok) continue;
      const data = (await statusRes.json()) as {
        status?: string;
        last_message?: { content?: string };
        messages?: Array<{ role?: string; content?: string }>;
      };
      // Conventions possibles selon l'API : status = "inactive" / "completed" / "succeeded"
      const status = (data.status ?? "").toLowerCase();
      if (status === "inactive" || status === "completed" || status === "succeeded") {
        // Recuperer la derniere reponse de l'agent
        const lastFromAgent = data.messages
          ?.filter((m) => m.role === "agent" || m.role === "assistant")
          ?.slice(-1)[0];
        const output = lastFromAgent?.content ?? data.last_message?.content ?? "";
        return { ok: true, output, sessionId };
      }
    } catch {
      // Continue polling
    }
  }

  return {
    ok: false,
    output: "",
    sessionId,
    errorMsg: `Session timeout apres ${timeoutMs / 1000}s`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getWeekRange(now: Date): { start: Date; end: Date } {
  // Semaine ecoulee = lundi au dimanche precedent
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  // Reculer jusqu'au dimanche
  const dayOfWeek = end.getUTCDay(); // 0 = dimanche
  end.setUTCDate(end.getUTCDate() - dayOfWeek);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { start, end };
}

// Consolidation des 3 outputs en un digest markdown unique.
function buildDigestMarkdown(parts: {
  weekStart: Date;
  weekEnd: Date;
  analytics: { ok: boolean; output: string; errorMsg?: string };
  growth: { ok: boolean; output: string; errorMsg?: string };
  content: { ok: boolean; output: string; errorMsg?: string };
}): string {
  const fmt = (d: Date) => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long" });
  const semaine = `${fmt(parts.weekStart)} au ${fmt(parts.weekEnd)}`;

  const block = (title: string, res: { ok: boolean; output: string; errorMsg?: string }) => {
    if (res.ok && res.output) return `## ${title}\n\n${res.output}\n`;
    return `## ${title}\n\nEchec session. Detail : ${res.errorMsg ?? "inconnu"}\n`;
  };

  return [
    `# Digest hebdo Arty Growth Inc.`,
    `Semaine du ${semaine}`,
    `Genere automatiquement par l'orchestrateur Cloudflare le ${new Date().toLocaleString("fr-FR")}.`,
    ``,
    `> 30 minutes lundi matin suffisent pour valider en bloc.`,
    `> Une fois valide, repondre a l'email avec "OK" et tes 3 retours de feedback (qu'as-tu poste / reactions / inscriptions waitlist).`,
    ``,
    `---`,
    ``,
    block("1. Analytics (chiffres + recommandations)", parts.analytics),
    ``,
    `---`,
    ``,
    block("2. Veille communautes + outreach (Growth FR)", parts.growth),
    ``,
    `---`,
    ``,
    block("3. Contenus prets a publier (Content FR)", parts.content),
    ``,
    `---`,
    ``,
    `## Notes du DG`,
    ``,
    `Cycle execute automatiquement par le Worker arty-growth-orchestrator.`,
    `Erreurs eventuelles : voir logs Cloudflare (wrangler tail).`,
    ``,
    `Prochain cycle : dimanche prochain a 18h00 UTC.`,
  ].join("\n");
}

// Conversion minimale Markdown -> HTML pour l'email.
// On reste sobre, pas de librairie tierce dans le Worker.
function markdownToHtml(md: string): string {
  const escaped = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let html = escaped;
  html = html.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.*)$/gm, "<h1>$1</h1>");
  html = html.replace(/^---$/gm, "<hr/>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/^> (.*)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/\n\n/g, "</p><p>");
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:680px;margin:24px auto;padding:0 16px;color:#0D0D0D;line-height:1.5;"><p>${html}</p></body></html>`;
}

async function sendDigestEmail(env: Env, markdown: string): Promise<{ ok: boolean; errorMsg?: string }> {
  const html = markdownToHtml(markdown);
  const subject = `[Arty Growth] Digest hebdo - ${new Date().toLocaleDateString("fr-FR")}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${env.DIGEST_FROM_NAME} <${env.DIGEST_FROM_EMAIL}>`,
      to: [env.DIGEST_TO_EMAIL],
      subject,
      html,
      text: markdown,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { ok: false, errorMsg: `Resend failed: ${res.status} ${errText.slice(0, 500)}` };
  }
  return { ok: true };
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date();
    const { start: weekStart, end: weekEnd } = getWeekRange(now);

    console.log(`[orchestrator] Cycle demarre ${now.toISOString()}`);

    const timeoutMs = parseInt(env.SESSION_TIMEOUT_MS || "600000", 10);
    const pollMs = parseInt(env.SESSION_POLL_INTERVAL_MS || "10000", 10);

    // Lancer les 3 sessions en parallele
    const briefs = {
      analytics: buildBriefForAgent("analytics", weekStart, weekEnd),
      growth: buildBriefForAgent("growth", weekStart, weekEnd),
      content: buildBriefForAgent("content", weekStart, weekEnd),
    };

    const [analyticsRes, growthRes, contentRes] = await Promise.all([
      runAgentSession(
        env.ANTHROPIC_API_KEY,
        env.ANTHROPIC_WORKSPACE_ID,
        env.ANTHROPIC_ENV_ID,
        env.AGENT_ANALYTICS_ID,
        briefs.analytics,
        timeoutMs,
        pollMs,
      ),
      runAgentSession(
        env.ANTHROPIC_API_KEY,
        env.ANTHROPIC_WORKSPACE_ID,
        env.ANTHROPIC_ENV_ID,
        env.AGENT_GROWTH_FR_ID,
        briefs.growth,
        timeoutMs,
        pollMs,
      ),
      runAgentSession(
        env.ANTHROPIC_API_KEY,
        env.ANTHROPIC_WORKSPACE_ID,
        env.ANTHROPIC_ENV_ID,
        env.AGENT_CONTENT_FR_ID,
        briefs.content,
        timeoutMs,
        pollMs,
      ),
    ]);

    console.log(
      `[orchestrator] Sessions completes - analytics:${analyticsRes.ok}, growth:${growthRes.ok}, content:${contentRes.ok}`,
    );

    const markdown = buildDigestMarkdown({
      weekStart,
      weekEnd,
      analytics: analyticsRes,
      growth: growthRes,
      content: contentRes,
    });

    const emailRes = await sendDigestEmail(env, markdown);
    if (!emailRes.ok) {
      console.error(`[orchestrator] Email send failed: ${emailRes.errorMsg}`);
      // En cas d'echec email on garde au moins une trace dans les logs
      console.log(`[orchestrator] Digest content (fallback log):\n${markdown.slice(0, 2000)}`);
      return;
    }

    console.log(`[orchestrator] Digest envoye a ${env.DIGEST_TO_EMAIL}`);
  },

  // Pas de handler fetch public expose. Le Worker ne repond qu'aux scheduled events.
  // Si on veut un trigger manuel pour tester, on l'ajoutera derriere une auth dans une v2.
};

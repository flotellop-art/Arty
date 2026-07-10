/// <reference types="@cloudflare/workers-types" />

import {
  classifyIdleDisposition,
  type AnthropicSessionStatus,
  type SessionStatusIdleEvent,
} from "./anthropic-session";
import {
  BodyTooLargeError,
  readJsonBodyLimited,
  readTextBodyLimited,
} from "./bounded-body";
import { discordFetchOrThrow } from "./discord-http";
import {
  appendReference,
  buildRfc2822Message,
  encodeBase64UrlUtf8,
  GmailMessageValidationError,
} from "./gmail-message";
import { fetchWithTimeout } from "./http-timeout";

/**
 * Arty Growth Orchestrator v2
 * --------------------------------
 * Cloudflare Worker qui orchestre une "equipe IA" pour Arty :
 *   1) Sub-agents : Growth FR, Content FR, Analytics (sessions Anthropic Managed Agents)
 *   2) Arty DG : agent qui consolide les 3 outputs et prend les decisions
 *   3) Interface Florent : Discord (canal #dg), pas d'email
 *
 * Cycle hebdo growth : cron dimanche 18h UTC.
 * Cycles hebdo veille (4 slots, 10 watchers au total — voir WATCHERS_CONFIG) :
 *   mercredi 12h UTC : 7 watchers outils/infra (slot wed).
 *   jeudi    12h UTC : 2 watchers marche/voix users (slot thu).
 *   vendredi 12h UTC : 1 watcher recherche docs/tutos (slot fri).
 *   samedi   12h UTC : 1 watcher manager qui meta-synthetise la semaine (slot sat).
 * System prompts dans agents/watcher-*.md, liste topics research dans
 * agents/watch-topics.md.
 * Cycle manuel : POST /trigger (growth) ou /admin/trigger-watch?slot=wed|thu|fri|sat.
 *
 * 9 routes HTTP (voir le handler fetch en bas de fichier) :
 *   GET  /                        healthcheck public
 *   POST /trigger                 run manuel growth  - header X-Trigger-Secret
 *   POST /admin/trigger-watch     run manuel veille  - header X-Trigger-Secret
 *   POST /admin/register-commands enregistre /dg     - header X-Trigger-Secret
 *   POST /admin/post-test         test bot Discord   - header X-Trigger-Secret
 *   POST /anthropic/webhook       events de session  - signature HMAC SHA256
 *   POST /oauth/google/start      setup OAuth (1x)   - header X-Trigger-Secret
 *   GET  /oauth/google/callback   retour Google      - state nonce anti-CSRF
 *   POST /mcp/gmail               MCP server Gmail   - header Authorization: Bearer
 *   POST /discord/interactions    slash command /dg  - signature Ed25519
 *
 * Audit secu (CLAUDE.md RÈGLE 6) :
 *  - Aucun secret en query string (BUG 7) : tous les secrets transitent par header.
 *  - Comparaisons de secrets constant-time (timingSafeEqual).
 *  - /dg : allowlist d'IDs Discord (DISCORD_ALLOWED_USER_IDS) + canal verifie.
 *  - IDs Gmail valides par regex avant toute URL d'API (BUG 32).
 *  - Reponses d'erreur uniformes, sans leak du motif (motif garde en console.warn).
 *  - Tous les secrets en secret CF, jamais en log.
 */

export interface Env {
  // Secrets
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_WEBHOOK_SIGNING_KEY: string;
  TRIGGER_SECRET: string;
  // Token dedie au seul endpoint /mcp/gmail. Isole de TRIGGER_SECRET car il est
  // necessairement partage avec la config mcp_servers de l'agent Anthropic.
  MCP_AUTH_TOKEN: string;
  DISCORD_BOT_TOKEN: string;
  TALLY_API_KEY: string;
  GITHUB_TOKEN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  // Resend : envoie chaque digest (growth + 4 cycles veille) par email a Florent,
  // version vulgarisee par Haiku. Optionnel : si vide, on poste seulement sur Discord.
  RESEND_API_KEY?: string;

  // Vars publiques
  ANTHROPIC_WORKSPACE_ID: string;
  ANTHROPIC_ENV_ID: string;
  // Vault Anthropic contenant le credential static_bearer du MCP Gmail.
  ANTHROPIC_GMAIL_VAULT_ID?: string;
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
  // CSV d'IDs utilisateur Discord autorises a lancer la slash command /dg.
  DISCORD_ALLOWED_USER_IDS: string;
  // Destinataire et expediteur des emails recap (RESEND_API_KEY). Si vides,
  // l'envoi email est skip et seul Discord est utilise.
  EMAIL_TO: string;
  EMAIL_FROM: string;
  EMAIL_FROM_NAME: string;
  // Les brouillons restent desactives tant qu'un flux d'approbation humaine
  // n'est pas branche. La valeur doit etre explicitement "true" pour les exposer.
  GMAIL_DRAFTS_ENABLED?: string;
  // Agents de veille (4 crons : mer outils/infra, jeu users, ven research, sam manager).
  // Vides au depart ; une fois crees sur la console Anthropic, coller les IDs dans wrangler.toml.
  // Liste complete et leur slot defini dans WATCHERS_CONFIG (src/index.ts).
  AGENT_WATCHER_MCP_TUNNELS_ID: string;
  AGENT_WATCHER_SHS_ID: string;
  AGENT_WATCHER_AI_MODELS_ID: string;
  AGENT_WATCHER_CLOUDFLARE_ID: string;
  AGENT_WATCHER_GOOGLE_APIS_ID: string;
  AGENT_WATCHER_MOBILE_ID: string;
  AGENT_WATCHER_COMMS_ID: string;
  AGENT_WATCHER_MARKET_ID: string;
  AGENT_WATCHER_USERS_VOICE_ID: string;
  AGENT_WATCHER_RESEARCH_ID: string;
  AGENT_WATCHER_MANAGER_ID: string;

  // KV pour le tracking des interactions Discord en attente
  INTERACTIONS: KVNamespace;
}

// Entry stockee en KV pour relier une session Anthropic a une action de delivery.
//  - adhoc            : reponse a un /dg sur Discord (PATCH du message Discord)
//  - weekly_subagent  : output d'un sub-agent dans le cycle hebdo (a accumuler)
//  - weekly_dg        : digest final du DG dans le cycle hebdo (a poster sur Discord)
//  - infra_watch      : output d'un agent de veille infra (cron mercredi)
interface PendingInteraction {
  type: "adhoc" | "weekly_subagent" | "weekly_dg" | "infra_watch";
  interactionToken?: string;                  // utilise pour adhoc
  role?: "analytics" | "growth" | "content" | "dg";
  // Cle du watcher pour infra_watch. Valeurs valides dans WATCHERS_CONFIG.
  // Type string (pas union) car la liste est config-driven et croit avec le temps.
  watcher?: string;
  cycleId?: string;                            // pour weekly_* et infra_watch
  createdAt: number;
  phase?: "created" | "message_sent" | "send_unknown";
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
const ANTHROPIC_HTTP_TIMEOUT_MS = 8_000;

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

function gmailVaultIds(env: Env): string[] | undefined {
  const vaultId = env.ANTHROPIC_GMAIL_VAULT_ID?.trim();
  if (!vaultId) {
    console.warn("[anthropic] ANTHROPIC_GMAIL_VAULT_ID absent: MCP Gmail indisponible pour cette session DG");
    return undefined;
  }
  if (!/^vlt_[a-zA-Z0-9_-]+$/.test(vaultId)) {
    throw new Error("ANTHROPIC_GMAIL_VAULT_ID invalide");
  }
  return [vaultId];
}

async function createSession(
  apiKey: string,
  agentId: string,
  envId: string,
  title: string,
  memoryStoreId?: string,
  githubRepo?: GithubRepoMount,
  vaultIds?: string[],
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
  if (vaultIds?.length) body.vault_ids = vaultIds;

  const res = await fetchWithTimeout(`${ANTHROPIC_BASE}/sessions`, {
    method: "POST",
    headers: anthropicHeaders(apiKey),
    body: JSON.stringify(body),
  }, ANTHROPIC_HTTP_TIMEOUT_MS);
  if (!res.ok) {
    return { ok: false, err: `Create session ${res.status}: ${await responseErrorSnippet(res)}` };
  }
  const data = await readJsonBodyLimited<{ id?: string }>(res, 256 * 1024);
  if (!data.id) return { ok: false, err: "Missing session id" };
  return { ok: true, id: data.id };
}

async function sendUserMessage(
  apiKey: string,
  sessionId: string,
  text: string,
): Promise<{ ok: boolean; err?: string }> {
  const res = await fetchWithTimeout(`${ANTHROPIC_BASE}/sessions/${sessionId}/events`, {
    method: "POST",
    headers: anthropicHeaders(apiKey),
    body: JSON.stringify({
      events: [{ type: "user.message", content: [{ type: "text", text }] }],
    }),
  }, ANTHROPIC_HTTP_TIMEOUT_MS);
  if (!res.ok) {
    return { ok: false, err: `Send event ${res.status}: ${await responseErrorSnippet(res)}` };
  }
  return { ok: true };
}

/** Enregistre la session avant l'envoi pour qu'un tour tres rapide ne soit pas perdu. */
type TrackedSendResult =
  | { ok: true; ambiguous: false }
  | { ok: false; ambiguous: boolean; err: string };

async function trackAndSendUserMessage(
  env: Env,
  sessionId: string,
  text: string,
  pending: PendingInteraction,
  expirationTtl: number,
): Promise<TrackedSendResult> {
  const key = `sess:${sessionId}`;
  await env.INTERACTIONS.put(key, JSON.stringify({ ...pending, phase: "created" }), { expirationTtl });

  let sent: { ok: boolean; err?: string };
  try {
    sent = await sendUserMessage(env.ANTHROPIC_API_KEY, sessionId, text);
  } catch (error) {
    // Un timeout est ambigu : Anthropic a peut-etre accepte le message. Garder
    // le suivi permet au webhook final de livrer malgre l'erreur cote appelant.
    try {
      await env.INTERACTIONS.put(
        key,
        JSON.stringify({ ...pending, phase: "send_unknown" }),
        { expirationTtl },
      );
    } catch (stateError) {
      console.error(`[anthropic] unable to persist ambiguous send state for ${sessionId}: ${stateError}`);
    }
    return { ok: false, ambiguous: true, err: `Anthropic send outcome unknown: ${String(error)}` };
  }
  if (!sent.ok) {
    try {
      await env.INTERACTIONS.delete(key);
    } catch (cleanupError) {
      console.error(`[anthropic] cleanup after send failure failed for ${sessionId}: ${cleanupError}`);
    }
    return { ok: false, ambiguous: false, err: sent.err ?? "Anthropic rejected the message" };
  }

  try {
    await env.INTERACTIONS.put(key, JSON.stringify({ ...pending, phase: "message_sent" }), { expirationTtl });
  } catch (error) {
    try {
      await env.INTERACTIONS.put(
        key,
        JSON.stringify({ ...pending, phase: "send_unknown" }),
        { expirationTtl },
      );
    } catch (stateError) {
      console.error(`[anthropic] unable to persist sent state for ${sessionId}: ${stateError}`);
    }
    return { ok: false, ambiguous: true, err: `Anthropic send state unknown: ${String(error)}` };
  }
  return { ok: true, ambiguous: false };
}

async function denyPendingToolActions(
  apiKey: string,
  sessionId: string,
  eventIds: string[],
): Promise<void> {
  const res = await fetchWithTimeout(`${ANTHROPIC_BASE}/sessions/${sessionId}/events`, {
    method: "POST",
    headers: anthropicHeaders(apiKey),
    body: JSON.stringify({
      events: eventIds.map((eventId) => ({
        type: "user.tool_confirmation",
        tool_use_id: eventId,
        result: "deny",
        deny_message: "Aucun flux d'approbation humaine n'est configure. Continue sans cet outil.",
      })),
    }),
  }, ANTHROPIC_HTTP_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`Deny tool confirmations failed (${res.status})`);
  }
}

async function fetchAgentText(apiKey: string, sessionId: string, limit = 500): Promise<string> {
  // order=desc : l'API renvoie les events les plus RECENTS en premier. C'est
  // crucial quand la session a > limit events : sans ce param, on recupere les
  // PREMIERS events et on perd le dernier agent.message (qui contient les
  // marqueurs DISCORD_SUMMARY pour les watchers, ou la reponse finale pour le
  // DG). L'API plafonne limit a 1000 (HTTP 400 sinon), donc on doit choisir
  // quelle fenetre prendre. On veut toujours la fenetre la plus recente.
  //
  // On inverse ensuite cote code (data.data.reverse()) pour retrouver l'ordre
  // chronologique dans le texte concatene, ce qui preserve la lisibilite pour
  // les usages /dg ou un long raisonnement multi-message est restitue dans
  // l'ordre naturel.
  const res = await fetchWithTimeout(`${ANTHROPIC_BASE}/sessions/${sessionId}/events?limit=${limit}&order=desc`, {
    method: "GET",
    headers: anthropicHeaders(apiKey),
  }, ANTHROPIC_HTTP_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`Fetch session events ${res.status}: ${await responseErrorSnippet(res)}`);
  }
  const data = await readJsonBodyLimited<{
    data?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  }>(res, 2 * 1024 * 1024);
  const events = (data.data ?? []).slice().reverse();
  const texts: string[] = [];
  for (const ev of events) {
    if (ev.type !== "agent.message") continue;
    for (const b of ev.content ?? []) {
      if (b.type === "text" && b.text) texts.push(b.text);
    }
  }
  return texts.join("\n\n");
}

interface AnthropicSessionSnapshot {
  status?: AnthropicSessionStatus;
}

async function retrieveAnthropicSession(
  apiKey: string,
  sessionId: string,
): Promise<AnthropicSessionSnapshot> {
  const res = await fetchWithTimeout(`${ANTHROPIC_BASE}/sessions/${sessionId}`, {
    method: "GET",
    headers: anthropicHeaders(apiKey),
  }, ANTHROPIC_HTTP_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`Retrieve session ${res.status}: ${await responseErrorSnippet(res)}`);
  }
  return readJsonBodyLimited<AnthropicSessionSnapshot>(res, 256 * 1024);
}

async function fetchLatestIdleEvent(
  apiKey: string,
  sessionId: string,
): Promise<SessionStatusIdleEvent | null> {
  const params = new URLSearchParams({ order: "desc", limit: "1" });
  params.append("types[]", "session.status_idle");
  const res = await fetchWithTimeout(`${ANTHROPIC_BASE}/sessions/${sessionId}/events?${params}`, {
    method: "GET",
    headers: anthropicHeaders(apiKey),
  }, ANTHROPIC_HTTP_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`Fetch idle event ${res.status}: ${await responseErrorSnippet(res)}`);
  }
  const data = await readJsonBodyLimited<{ data?: SessionStatusIdleEvent[] }>(res, 256 * 1024);
  return data.data?.[0] ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ===========================================================================
// 0. UTILS — secrets, parsing, decodage
// ===========================================================================

// TTL des cles KV du cycle hebdo. Une session Anthropic peut etre lente ou
// re-schedulee ; 24h laisse une marge confortable avant expiration (le cycle
// dure normalement < 30 min). Les cles `sess:` ad-hoc gardent un TTL court
// distinct (lie a l'expiration du token d'interaction Discord, 15 min).
const WEEKLY_KV_TTL = 24 * 3600;

/**
 * Comparaison de secrets constant-time. On HMAC les deux valeurs avec une cle
 * aleatoire par appel : comparer les digests (longueur fixe) ne revele aucune
 * info de timing sur les entrees. Evite les timing attacks sur les `===`.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const keyData = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const ha = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(a)));
  const hb = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(b)));
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i]! ^ hb[i]!;
  return diff === 0;
}

/** Verifie un secret fourni (header) contre le secret attendu, constant-time. */
async function checkSecret(provided: string | null, expected: string | undefined): Promise<boolean> {
  if (!expected || !provided) return false;
  return timingSafeEqual(provided, expected);
}

/** Extrait le token d'un header `Authorization: Bearer xxx`. */
function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
}

/** JSON.parse defensif : retourne null au lieu de throw sur entree corrompue. */
function safeParse<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** Un id Gmail valide ne contient que [a-zA-Z0-9_-] (BUG 32 : anti-injection d'URL). */
function isValidGmailId(id: string): boolean {
  return id.length > 0 && id.length <= 256 && /^[a-zA-Z0-9_-]+$/.test(id);
}

/** base64url -> bytes (Workers' Buffer ne gere pas toujours 'base64url'). */
function decodeBase64Url(data: string): Uint8Array {
  if (data.length > 512 * 1024) {
    throw new Error("Gmail MIME part too large");
  }
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Charset declare dans le header Content-Type d'une part MIME (defaut utf-8). */
function charsetOfPart(part: { headers?: Array<{ name?: string; value?: string }> }): string {
  const ct =
    (part.headers ?? []).find((h) => (h.name ?? "").toLowerCase() === "content-type")?.value ?? "";
  const m = /charset\s*=\s*"?([^";]+)"?/i.exec(ct);
  return (m?.[1] ?? "utf-8").toLowerCase();
}

/**
 * Decode le body d'une part MIME en respectant le charset annonce (BUG 36/49 :
 * `atob()` seul casse l'UTF-8 et ignore windows-1252/ISO-8859-1 des mails Outlook).
 */
function decodePartBody(part: {
  body?: { data?: string };
  headers?: Array<{ name?: string; value?: string }>;
}): string {
  if (!part.body?.data) return "";
  const bytes = decodeBase64Url(part.body.data);
  const charset = charsetOfPart(part);
  // TextDecoder est non-fatal par defaut (les octets invalides -> U+FFFD).
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    // Charset inconnu (label non reconnu) : fallback utf-8.
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Code point -> string, sans truncation silencieuse (anti data-smuggling). */
function safeFromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

/**
 * HTML -> texte lisible. Drop les blocs <head>/<style>/<script> AVANT de
 * retirer les tags (sinon le CSS Outlook pollue le texte extrait — BUG 49).
 */
function htmlToText(html: string): string {
  return html
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|td|th|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => safeFromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeFromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
    const res = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${env.TALLY_API_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const errText = await responseErrorSnippet(res);
      console.error(`[tally] HTTP ${res.status}: ${errText}`);
      return `## Stats waitlist (Tally)\n\nNon disponibles cette execution. Erreur API : ${res.status}.\n`;
    }
    const data = await readJsonBodyLimited<{
      totalNumberOfSubmissionsPerFilter?: { all?: number; completed?: number };
      submissions?: Array<{
        id: string;
        submittedAt: string;
        isCompleted?: boolean;
        responses?: Array<{ question?: { title?: string }; answer?: { value?: string } }>;
      }>;
    }>(res, 2 * 1024 * 1024);

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
  const listRes = await fetchWithTimeout(
    `${ANTHROPIC_BASE}/memory_stores/${env.MEMORY_STORE_ID}/memories?limit=100`,
    { headers: anthropicHeaders(env.ANTHROPIC_API_KEY) },
    ANTHROPIC_HTTP_TIMEOUT_MS,
  );
  if (!listRes.ok) return null;
  const list = await readJsonBodyLimited<{ data?: Array<{ path?: string; id?: string }> }>(
    listRes,
    2 * 1024 * 1024,
  );
  const found = list.data?.find((m) => m.path === normalized);
  if (!found?.id) return null;
  const memRes = await fetchWithTimeout(
    `${ANTHROPIC_BASE}/memory_stores/${env.MEMORY_STORE_ID}/memories/${found.id}`,
    { headers: anthropicHeaders(env.ANTHROPIC_API_KEY) },
    ANTHROPIC_HTTP_TIMEOUT_MS,
  );
  if (!memRes.ok) return null;
  const mem = await readJsonBodyLimited<{ content?: string }>(memRes, 5 * 1024 * 1024);
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
  // Format : <screenshot path="..." [parts="3"] [caption="..."] [type="jpeg|png"] />
  const regex = /<screenshot\s+([^>]+?)\s*\/?>/g;
  const replacements: Array<[string, string]> = [];
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = regex.exec(text)) !== null) {
    const attrs = match[1];
    const full = match[0];
    idx++;

    // Parser les attributs
    const path = (attrs.match(/path="([^"]+)"/) || [])[1];
    const caption = ((attrs.match(/caption="([^"]*)"/) || [])[1] || "").trim();
    const partsAttr = (attrs.match(/parts="(\d+)"/) || [])[1];
    const partsCount = partsAttr ? parseInt(partsAttr, 10) : 1;
    const typeHint = ((attrs.match(/type="([^"]+)"/) || [])[1] || "png").toLowerCase();

    if (!path) {
      replacements.push([full, `[screenshot ${idx} : path manquant]`]);
      continue;
    }
    // Anti path-traversal : `path` vient du texte de l'agent, potentiellement
    // influence par du contenu lu (ex : un mail). On le restreint au dossier
    // /livraisons/ et a un charset sur. Empeche de lire d'autres memories.
    if (path.includes("..") || !/^\/?livraisons\/[a-zA-Z0-9._/-]+$/.test(path)) {
      replacements.push([full, `[screenshot ${idx} : path refuse]`]);
      continue;
    }

    try {
      let b64Content = "";

      if (partsCount > 1) {
        // Multi-part : recuperer chaque part {base}-part-{a,b,c...}
        const dot = path.lastIndexOf(".");
        const base = dot > 0 ? path.slice(0, dot) : path;
        const ext = dot > 0 ? path.slice(dot) : "";
        const letters = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
        const parts: string[] = [];
        for (let i = 0; i < partsCount; i++) {
          const partPath = `${base}-part-${letters[i]}${ext}`;
          const partContent = await fetchMemoryByPath(env, partPath);
          if (partContent === null) {
            console.error(`[screenshot] part ${i + 1}/${partsCount} introuvable : ${partPath}`);
            break;
          }
          parts.push(partContent.replace(/\s/g, ""));
        }
        if (parts.length !== partsCount) {
          replacements.push([full, `[screenshot ${idx} : ${parts.length}/${partsCount} parts trouvees]`]);
          continue;
        }
        b64Content = parts.join("");
      } else {
        const fetched = await fetchMemoryByPath(env, path);
        if (!fetched) {
          replacements.push([full, `[screenshot ${idx} : fichier introuvable ${path}]`]);
          continue;
        }
        b64Content = fetched.replace(/\s/g, "");
      }

      const binary = atob(b64Content);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const baseName = path.split("/").pop() || `screenshot-${idx}`;
      const stripped = baseName.replace(/\.b64$/, "");
      const ext = typeHint === "jpeg" || typeHint === "jpg" ? ".jpg" : ".png";
      const filename = stripped.endsWith(".png") || stripped.endsWith(".jpg") || stripped.endsWith(".jpeg")
        ? stripped
        : `${stripped}${ext}`;

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

async function discordPostMessage(
  env: Env,
  content: string,
  attachments: ScreenshotAttachment[] = [],
): Promise<void> {
  // Limite Discord : 2000 chars / message. On split intelligemment sur les sauts de ligne.
  const chunks = splitForDiscord(content, 1900);
  const url = `${DISCORD_API}/channels/${env.DISCORD_CHANNEL_ID}/messages`;

  // 1er chunk : avec attachments si applicable (multipart)
  if (attachments.length > 0) {
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
      form.append(`files[${i}]`, new Blob([a.data], { type: "image/png" }), a.filename);
    }
    await discordFetchOrThrow(url, {
      method: "POST",
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
      body: form,
    }, "Discord post with attachments");
    console.log(`[discord] post OK avec ${attachments.length} piece(s) jointe(s)`);
  } else {
    await discordFetchOrThrow(url, {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: chunks[0] }),
    }, "Discord post");
  }
  await sleep(300);

  // Chunks suivants : POST text only
  for (let i = 1; i < chunks.length; i++) {
    await discordFetchOrThrow(url, {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: chunks[i] }),
    }, `Discord post chunk ${i + 1}/${chunks.length}`);
    await sleep(300);
  }
}

async function responseErrorSnippet(response: Response): Promise<string> {
  try {
    return (await readTextBodyLimited(response, 64 * 1024, 4_000)).slice(0, 300);
  } catch {
    return "response body unavailable";
  }
}

interface GmailMimePart {
  mimeType?: string;
  body?: { data?: string };
  headers?: Array<{ name?: string; value?: string }>;
  parts?: GmailMimePart[];
}

/** Parcours MIME iteratif et borne : pas de recursion ni d'arbre hostile infini. */
function findGmailMimePart(root: GmailMimePart | undefined, wantedMime: string): GmailMimePart | null {
  if (!root) return null;
  const stack: Array<{ node: GmailMimePart; depth: number }> = [{ node: root, depth: 0 }];
  let visited = 0;

  while (stack.length) {
    const current = stack.pop()!;
    visited += 1;
    if (visited > 200 || current.depth > 20) {
      throw new Error("Gmail MIME structure too complex");
    }
    if ((current.node.mimeType ?? "").toLowerCase() === wantedMime && current.node.body?.data) {
      return current.node;
    }
    const children = current.node.parts ?? [];
    if (children.length > 200) throw new Error("Gmail MIME structure too complex");
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ node: children[i]!, depth: current.depth + 1 });
    }
  }

  return null;
}

function splitForDiscord(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let current = "";

  // Decoupe dure d'une chaine trop longue en morceaux <= max (aucune perte).
  const hardSplit = (s: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
    return out;
  };
  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };

  for (const p of text.split(/\n\n+/)) {
    if ((current + "\n\n" + p).length <= max) {
      current = current ? current + "\n\n" + p : p;
      continue;
    }
    flush();
    if (p.length <= max) {
      current = p;
      continue;
    }
    // Paragraphe trop long : on split ligne par ligne.
    for (const line of p.split("\n")) {
      if ((current + "\n" + line).length <= max) {
        current = current ? current + "\n" + line : line;
        continue;
      }
      flush();
      if (line.length <= max) {
        current = line;
        continue;
      }
      // Ligne unique trop longue : decoupe dure, le reste n'est pas perdu.
      const pieces = hardSplit(line);
      for (let i = 0; i < pieces.length - 1; i++) chunks.push(pieces[i]!);
      current = pieces[pieces.length - 1]!;
    }
  }
  flush();
  return chunks;
}

// ===========================================================================
// 3.5 EMAIL RECAP (Resend + vulgarisation Haiku synchrone)
// ===========================================================================

/**
 * Transforme un digest Discord (technique, jargonneux) en HTML simple destine
 * a un novice (pas de termes tech, phrases courtes). Appel synchrone a Haiku
 * via l'API Anthropic Messages (pas une session managed agent : moins cher,
 * pas de webhook a attendre, ~5-10s par appel).
 */
async function translateForNovice(env: Env, technicalContent: string): Promise<string> {
  const systemPrompt = [
    "Tu recois un rapport technique en francais destine a des developpeurs.",
    "Tu le reecris en francais simple pour un novice qui ne connait rien a la tech.",
    "",
    "Regles strictes :",
    "- Aucun jargon : pas de 'API', 'endpoint', 'watcher', 'cycle', 'KV', 'webhook', 'agent', 'workflow', 'session', noms d'outils techniques inconnus du grand public.",
    "- Phrases courtes, vocabulaire du quotidien.",
    "- Structure : 1 paragraphe d'intro qui resume la semaine, puis 2 a 4 points cles en bullets simples.",
    "- Ton : amical, comme a un ami non-tech qui demande 'alors quoi de neuf cette semaine ?'.",
    "- Longueur max : 250 mots.",
    "- Sortie en HTML simple uniquement : <h2>, <p>, <ul>, <li>, <strong>, <em>. Pas de markdown, pas de code, pas de liens.",
    "- Si tu cites une entreprise tres connue (Anthropic, Google, Cloudflare, Discord, Apple, Microsoft, OpenAI), tu peux la nommer mais ajoute une mini-glose entre parentheses la 1ere fois : 'Anthropic (le createur de Claude)', 'Cloudflare (l'hebergeur du site)', etc.",
    "- Si rien d'important cette semaine, dis-le clairement : 'Semaine calme cote veille, rien de notable.'",
    "- Pas de tirets cadratins.",
    "- Pas de questions retoriques.",
    "- Pas d'emoji.",
  ].join("\n");

  try {
    const res = await fetchWithTimeout(`${ANTHROPIC_BASE}/messages`, {
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: technicalContent }],
      }),
    });
    if (!res.ok) {
      console.error(`[email] translate failed ${res.status}: ${await responseErrorSnippet(res)}`);
      return "";
    }
    const data = await readJsonBodyLimited<{
      content?: Array<{ type?: string; text?: string }>;
    }>(res, 512 * 1024);
    const text = (data.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n");
    return text.trim();
  } catch (err) {
    console.error(`[email] translate exception: ${err}`);
    return "";
  }
}

/**
 * Envoie un email via Resend (free tier 100/jour, 3000/mois — largement
 * suffisant a notre volume de 5 emails/semaine). Echec silencieux : si Resend
 * pete, le digest Discord est deja parti, on log et on continue.
 */
async function sendEmail(env: Env, subject: string, htmlBody: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.EMAIL_TO || !env.EMAIL_FROM) {
    console.log(`[email] config incomplete (RESEND_API_KEY / EMAIL_TO / EMAIL_FROM), skip`);
    return;
  }
  try {
    const from = env.EMAIL_FROM_NAME
      ? `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM}>`
      : env.EMAIL_FROM;
    const res = await fetchWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: env.EMAIL_TO,
        subject,
        html: htmlBody,
      }),
    });
    if (!res.ok) {
      console.error(`[email] send failed ${res.status}: ${await responseErrorSnippet(res)}`);
      return;
    }
    console.log(`[email] sent "${subject}" to ${env.EMAIL_TO}`);
  } catch (err) {
    console.error(`[email] send exception: ${err}`);
  }
}

/**
 * Helper combine : vulgarise le contenu Discord avec Haiku, l'enveloppe dans
 * un HTML simple, envoie via Resend. Echec silencieux a chaque etape.
 */
async function sendNoviceEmail(env: Env, subject: string, technicalContent: string): Promise<void> {
  const novice = await translateForNovice(env, technicalContent);
  if (!novice) {
    console.warn(`[email] translation vide, email "${subject}" non envoye`);
    return;
  }
  const html = [
    `<!DOCTYPE html>`,
    `<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:24px auto;padding:0 16px;color:#222;line-height:1.5;">`,
    novice,
    `<hr style="border:none;border-top:1px solid #eee;margin:32px 0 16px;">`,
    `<p style="color:#888;font-size:12px;">Recap genere automatiquement par l'equipe IA d'Arty. Le detail technique est sur Discord #dg.</p>`,
    `</body></html>`,
  ].join("\n");
  await sendEmail(env, subject, html);
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
    expirationTtl: WEEKLY_KV_TTL,
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
  await env.INTERACTIONS.put(`cycle:${cycleId}:tally`, tallyBlock, { expirationTtl: WEEKLY_KV_TTL });

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
        const pending: PendingInteraction = {
          type: "weekly_subagent",
          role,
          cycleId,
          createdAt: Date.now(),
        };
        const sent = await trackAndSendUserMessage(env, created.id, brief, pending, WEEKLY_KV_TTL);
        if (!sent.ok) {
          console.error(`[cycle] send ${role} failed: ${sent.err}`);
          return;
        }
        console.log(`[cycle] ${role} session ${created.id} launched`);
      },
    ),
  );

  console.log(`[cycle] 3 sub-agents launched. Waiting for webhooks.`);
}

/**
 * Une session sub-agent est terminee (idle ou terminated) : on stocke son output
 * — ou un placeholder d'erreur si elle a echoue — puis on tente de lancer le DG.
 * `overrideText` sert au cas `terminated` : sans lui, fetchAgentText renverrait ""
 * et le cycle pourrait se figer faute d'atteindre les 3 sub-agents.
 */
async function handleSubAgentDone(
  env: Env,
  pending: PendingInteraction,
  sessionId: string,
  overrideText?: string,
): Promise<void> {
  if (!pending.role || !pending.cycleId) {
    console.error(`[cycle] sub-agent webhook with missing role/cycleId`);
    return;
  }
  const cycleId = pending.cycleId;
  const role = pending.role;

  // Texte de la session, ou placeholder fourni (cas session terminated). Le
  // sub-agent a aussi ecrit dans /mnt/memory/arty/historique/cycles/ si OK.
  const text = overrideText ?? (await fetchAgentText(env.ANTHROPIC_API_KEY, sessionId));
  await env.INTERACTIONS.put(`cycle:${cycleId}:${role}`, text, { expirationTtl: WEEKLY_KV_TTL });
  console.log(`[cycle] ${role} output stored (${text.length} chars) for cycle ${cycleId}`);

  await maybeLaunchDG(env, cycleId);
}

/**
 * Verifie si les 3 sub-agents ont livre ; si oui, lance la session DG.
 * Lock best-effort : KV n'a pas de compare-and-set, donc deux webhooks
 * quasi-simultanes peuvent en theorie lancer 2 sessions DG. Le garde
 * d'idempotence `cycle:{id}:digest-posted` (handleWeeklyDgDone) borne l'impact
 * a une session DG en trop, jamais a deux digests postes.
 */
async function maybeLaunchDG(env: Env, cycleId: string): Promise<void> {
  const expected: Array<"analytics" | "growth" | "content"> = ["analytics", "growth", "content"];
  const results = await Promise.all(
    expected.map((r) => env.INTERACTIONS.get(`cycle:${cycleId}:${r}`)),
  );
  const present = results.filter((r) => r !== null && r !== undefined);
  if (present.length < expected.length) {
    console.log(`[cycle] ${present.length}/${expected.length} sub-agents recus pour ${cycleId}`);
    return;
  }

  // Lock best-effort anti double-lancement du DG.
  const lockKey = `cycle:${cycleId}:dg-lock`;
  if (await env.INTERACTIONS.get(lockKey)) {
    console.log(`[cycle] DG deja lance par un autre handler, skip`);
    return;
  }
  await env.INTERACTIONS.put(lockKey, new Date().toISOString(), { expirationTtl: WEEKLY_KV_TTL });

  let launched = false;
  try {
    const meta = safeParse<CycleMeta>(await env.INTERACTIONS.get(`cycle:${cycleId}:meta`));
    if (!meta) {
      console.error(`[cycle] meta manquante/corrompue pour ${cycleId}`);
      throw new Error(`Cycle metadata unavailable for ${cycleId}`);
    }
    const [analytics, growth, content] = results;
    const tallyBlock =
      (await env.INTERACTIONS.get(`cycle:${cycleId}:tally`)) || (await fetchTallyStats(env));

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
      gmailVaultIds(env),
    );
    if (!created.ok) {
      console.error(`[cycle] DG create failed: ${created.err}`);
      throw new Error(`Unable to create DG session for ${cycleId}`);
    }
    const dgPending: PendingInteraction = {
      type: "weekly_dg",
      cycleId,
      role: "dg",
      createdAt: Date.now(),
    };
    const sent = await trackAndSendUserMessage(env, created.id, dgBrief, dgPending, WEEKLY_KV_TTL);
    if (!sent.ok) {
      console.error(`[cycle] DG send failed: ${sent.err}`);
      if (sent.ambiguous) {
        // La session peut deja tourner : conserver le lock evite d'en creer une seconde.
        launched = true;
        return;
      }
      throw new Error(`Unable to send DG brief for ${cycleId}`);
    }
    launched = true;
    console.log(`[cycle] DG session ${created.id} launched for cycle ${cycleId}`);
  } finally {
    if (!launched) {
      try {
        await env.INTERACTIONS.delete(lockKey);
      } catch (unlockError) {
        console.error(`[cycle] impossible de liberer ${lockKey}: ${unlockError}`);
      }
    }
  }
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

  // Idempotence : si le digest a deja ete poste (race double-DG), ne pas reposter.
  if (await env.INTERACTIONS.get(`cycle:${cycleId}:digest-posted`)) {
    console.log(`[cycle] digest deja poste pour ${cycleId}, skip`);
    return;
  }
  const text = await fetchAgentText(env.ANTHROPIC_API_KEY, sessionId);
  const meta = safeParse<CycleMeta>(await env.INTERACTIONS.get(`cycle:${cycleId}:meta`));

  const start = meta ? new Date(meta.weekStart) : new Date();
  const end = meta ? new Date(meta.weekEnd) : new Date();
  const cycleN = meta?.cycleN ?? "?";

  // Memoire long terme : geree par le memory store Anthropic (le DG ecrit lui-meme
  // dans /mnt/memory/arty/historique/cycles/ pendant sa session).

  const header = `# Digest Arty - cycle #${cycleN} (${fmtDate(start)} au ${fmtDate(end)})\n_Genere automatiquement le ${new Date().toLocaleString("fr-FR")} par Arty DG._\n\n---\n\n`;
  const fullDigest = header + (text || "Le DG a fini sa session mais n'a renvoye aucun texte.");
  await discordPostMessage(env, fullDigest);
  // Marquer livre uniquement APRES confirmation de tous les chunks Discord.
  await env.INTERACTIONS.put(`cycle:${cycleId}:digest-posted`, new Date().toISOString(), {
    expirationTtl: WEEKLY_KV_TTL,
  });
  console.log(`[cycle] digest poste sur Discord pour cycle ${cycleId}`);

  // Email recap vulgarise (echec silencieux, ne bloque pas le cleanup).
  await sendNoviceEmail(env, `Recap growth — cycle #${cycleN} (${fmtDate(end)})`, fullDigest);

  // Cleanup : supprimer les outputs sub-agents et la meta (laisser le lock expirer naturellement)
  await Promise.all([
    env.INTERACTIONS.delete(`cycle:${cycleId}:analytics`),
    env.INTERACTIONS.delete(`cycle:${cycleId}:growth`),
    env.INTERACTIONS.delete(`cycle:${cycleId}:content`),
    env.INTERACTIONS.delete(`cycle:${cycleId}:meta`),
  ]);
}

// ===========================================================================
// 5.5 CYCLES DE VEILLE (4 slots : mer outils/infra, jeu users, ven research, sam manager)
// ===========================================================================
//
// 10 watchers au total, repartis sur 4 crons. Chaque cron filtre WATCHERS_CONFIG
// par cycleSlot et lance le sous-ensemble. Quand tous les watchers du slot ont
// livre, un digest specifique au slot est poste sur Discord. Le manager (samedi)
// lit les journaux memory store des 9 autres watchers pour produire un meta-digest.
//
// Pattern webhook-driven identique au cycle growth (Anthropic notifie l'idle, le
// Worker collecte et delivre). Idempotence via watch:{cycleId}:digest-posted.
// KV n'a pas de CAS atomique : double-post theorique possible sur webhooks
// strictement simultanes (acceptable au volume, sinon migration Durable Object).

type CycleSlot = "wed" | "thu" | "fri" | "sat";
type BriefTemplate = "verdict" | "users" | "research" | "manager";

interface WatcherConfig {
  key: string;
  envVar: keyof Env;
  label: string;
  cycleSlot: CycleSlot;
  mountRepo: boolean;      // false pour les watchers qui n'ont pas besoin du code Arty
  briefTemplate: BriefTemplate;
}

const WATCHERS_CONFIG: readonly WatcherConfig[] = [
  // --- mercredi : outils & infra (7 watchers, dont les 2 existants) ---
  { key: "mcp-tunnels",         envVar: "AGENT_WATCHER_MCP_TUNNELS_ID", label: "MCP Tunnels",                            cycleSlot: "wed", mountRepo: true,  briefTemplate: "verdict" },
  { key: "self-hosted-sandbox", envVar: "AGENT_WATCHER_SHS_ID",         label: "Self-Hosted Sandboxes",                  cycleSlot: "wed", mountRepo: true,  briefTemplate: "verdict" },
  { key: "ai-models",           envVar: "AGENT_WATCHER_AI_MODELS_ID",   label: "Veille IA (Claude/Gemini/Mistral/GPT)",  cycleSlot: "wed", mountRepo: false, briefTemplate: "verdict" },
  { key: "cloudflare",          envVar: "AGENT_WATCHER_CLOUDFLARE_ID",  label: "Veille Cloudflare",                      cycleSlot: "wed", mountRepo: false, briefTemplate: "verdict" },
  { key: "google-apis",         envVar: "AGENT_WATCHER_GOOGLE_APIS_ID", label: "Veille Google APIs",                     cycleSlot: "wed", mountRepo: false, briefTemplate: "verdict" },
  { key: "mobile-native",       envVar: "AGENT_WATCHER_MOBILE_ID",      label: "Veille Mobile (Capacitor + OS)",         cycleSlot: "wed", mountRepo: false, briefTemplate: "verdict" },
  { key: "comms-growth",        envVar: "AGENT_WATCHER_COMMS_ID",       label: "Veille Comms/Growth/Payments",           cycleSlot: "wed", mountRepo: false, briefTemplate: "verdict" },
  // --- jeudi : marche & voix users (2 watchers) ---
  { key: "market-competitors",  envVar: "AGENT_WATCHER_MARKET_ID",      label: "Veille marche concurrents",              cycleSlot: "thu", mountRepo: false, briefTemplate: "users" },
  { key: "users-voice",         envVar: "AGENT_WATCHER_USERS_VOICE_ID", label: "Voix users (Reddit, HN, PH)",            cycleSlot: "thu", mountRepo: false, briefTemplate: "users" },
  // --- vendredi : recherche docs/tutos (1 watcher) ---
  { key: "research",            envVar: "AGENT_WATCHER_RESEARCH_ID",    label: "Recherche docs & tutos",                 cycleSlot: "fri", mountRepo: true,  briefTemplate: "research" },
  // --- samedi : meta-digest manager (1 watcher) ---
  { key: "manager",             envVar: "AGENT_WATCHER_MANAGER_ID",     label: "Manager veille",                         cycleSlot: "sat", mountRepo: true,  briefTemplate: "manager" },
];

function watchersForSlot(slot: CycleSlot): WatcherConfig[] {
  return WATCHERS_CONFIG.filter((w) => w.cycleSlot === slot);
}

function findWatcher(key: string): WatcherConfig | undefined {
  return WATCHERS_CONFIG.find((w) => w.key === key);
}

/**
 * Dates des 3 cycles sous-watchers de la SEMAINE courante (vue depuis samedi).
 * Utilise pour le brief du manager : il lit les journaux du mer/jeu/ven.
 */
function getCurrentWeekWatchDates(saturday: Date): { wed: string; thu: string; fri: string } {
  // saturday = 6 (UTC). mercredi = 3 -> -3 jours.
  const wed = new Date(saturday);
  wed.setUTCDate(saturday.getUTCDate() - 3);
  const thu = new Date(wed);
  thu.setUTCDate(wed.getUTCDate() + 1);
  const fri = new Date(thu);
  fri.setUTCDate(thu.getUTCDate() + 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { wed: iso(wed), thu: iso(thu), fri: iso(fri) };
}

/**
 * Brief envoye a un watcher classique (verdict / users / research). Tres court :
 * tout le detail (sources, format) vit dans le system prompt sur la console.
 */
function buildBriefWatcher(w: WatcherConfig, today: string): string {
  const baseLines = [
    `# Cycle de veille — ${w.label} — ${today}`,
    ``,
    `C'est ton cycle hebdo. Suis ton system prompt :`,
    `1. Lis /mnt/memory/arty/watch/${w.key}/etat.md + les 3 derniers journaux.`,
  ];
  if (w.briefTemplate === "research") {
    baseLines.push(
      `2. Lis aussi /workspace/arty/services/growth-orchestrator/agents/watch-topics.md (la liste des sujets a suivre, editee par PR).`,
      `3. Pour chaque sujet, verifie tes sources (8 fetch web max au total), produis ton entry de format research.`,
    );
  } else {
    baseLines.push(
      `2. Visite tes sources officielles (8 fetch web max), identifie les nouveautes depuis le dernier journal.`,
    );
  }
  baseLines.push(
    `${w.briefTemplate === "research" ? "4" : "3"}. Ecris le journal du jour dans /mnt/memory/arty/watch/${w.key}/journal/${today}.md, mets a jour etat.md et verdict.md uniquement si necessaire.`,
    `${w.briefTemplate === "research" ? "5" : "4"}. Renvoie ton resume Discord entre les marqueurs === DISCORD_SUMMARY === et === END ===.`,
    ``,
    `Date d'aujourd'hui : ${today}. Cycle id : watch-${today}.`,
  );
  return baseLines.join("\n");
}

/**
 * Brief specifique du manager (samedi). Il liste explicitement les fichiers
 * journaux a lire pour les 9 sous-watchers de la semaine courante. Pas de fetch
 * web (web access doit etre desactive cote console pour cet agent).
 */
function buildBriefManager(today: string): string {
  const dates = getCurrentWeekWatchDates(new Date(today + "T12:00:00Z"));
  const subs = WATCHERS_CONFIG.filter((w) => w.cycleSlot !== "sat");
  const journalLines = subs.map((w) => {
    const date = w.cycleSlot === "wed" ? dates.wed : w.cycleSlot === "thu" ? dates.thu : dates.fri;
    return `- ${w.label} : /mnt/memory/arty/watch/${w.key}/journal/${date}.md (+ verdict.md si applicable)`;
  });
  return [
    `# Cycle de synthese manager — ${today}`,
    ``,
    `Tu es le manager de l'equipe veille. Tu lis les journaux de la semaine ` +
      `(mer ${dates.wed}, jeu ${dates.thu}, ven ${dates.fri}) et tu produis un ` +
      `meta-digest executif pour Florent. Tu ne fais AUCUN fetch web.`,
    ``,
    `## Journaux a lire`,
    ``,
    ...journalLines,
    ``,
    `Si un fichier est introuvable, note "watcher non lance cette semaine" dans tes Alertes qualite.`,
    ``,
    `## Cycle de travail`,
    `1. Lis tous les journaux ci-dessus. Lis aussi les verdict.md pour les watchers de type verdict (W1, W2, W3-W6).`,
    `2. Identifie les croisements (signal user qui matche une feature observee par un watcher techno, etc.).`,
    `3. Produis le meta-digest selon ton system prompt (TL;DR, Signaux forts, Verdicts a action, Voix users prioritaires, Alertes qualite, Topics suggeres).`,
    `4. Renvoie le digest entre les marqueurs === DISCORD_SUMMARY === et === END ===.`,
    ``,
    `Date d'aujourd'hui : ${today}. Cycle id : watch-${today}.`,
  ].join("\n");
}

/**
 * Lance un cycle de veille pour un slot donne en mode webhook-driven.
 *  1. Cree N sessions Anthropic (une par watcher du slot), envoie les briefs.
 *  2. Stocke chaque session -> {type: infra_watch, watcher, cycleId} en KV.
 *  3. Retourne. Anthropic ping le webhook quand chaque watcher est idle ;
 *     handleWatchDone extrait le resume entre les marqueurs et stocke en KV.
 *  4. Quand tous les watchers du slot ont livre, maybePostWatchDigest poste
 *     le digest specifique au slot sur Discord et cleanup les cles.
 */
async function runWatchCycle(env: Env, slot: CycleSlot): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const cycleId = `watch-${today}`;
  const slotWatchers = watchersForSlot(slot);
  console.log(`[watch:${slot}] launching cycle ${cycleId} (${slotWatchers.length} watcher(s))`);

  // Reset des cles KV du slot avant relance. Le cleanup en fin de cycle
  // (maybePostWatchDigest) garde le drapeau `digest-posted:{slot}` pendant 24h
  // pour bloquer les double-posts cause webhook livre en double. Mais en cas de
  // re-trigger manuel via /admin (ou de cron + manuel le meme jour), ce drapeau
  // empechait le nouveau cycle de poster (bug observe le 2026-05-20). On nettoie
  // donc les cles du slot ici, en debut de cycle. Pas de risque pour le cron
  // normal : a 12h UTC, aucun cycle precedent ne tourne plus.
  await Promise.all([
    env.INTERACTIONS.delete(`watch:${cycleId}:digest-posted:${slot}`),
    ...slotWatchers.map((w) => env.INTERACTIONS.delete(`watch:${cycleId}:${w.key}`)),
  ]);

  await env.INTERACTIONS.put(
    `watch:${cycleId}:meta`,
    JSON.stringify({ cycleId, date: today, slot }),
    { expirationTtl: WEEKLY_KV_TTL },
  );

  await Promise.all(
    slotWatchers.map(async (w) => {
      const agentId = (env as unknown as Record<string, string>)[w.envVar] || "";
      if (!agentId) {
        console.error(`[watch:${slot}] ${w.key} : agent_id manquant (configure ${w.envVar} dans wrangler.toml)`);
        return;
      }
      const brief = w.briefTemplate === "manager" ? buildBriefManager(today) : buildBriefWatcher(w, today);
      const repo = w.mountRepo
        ? { url: env.GITHUB_REPO_URL, mountPath: env.GITHUB_REPO_MOUNT, token: env.GITHUB_TOKEN }
        : undefined;
      const created = await createSession(
        env.ANTHROPIC_API_KEY,
        agentId,
        env.ANTHROPIC_ENV_ID,
        `Watch ${w.label} ${today}`,
        env.MEMORY_STORE_ID,
        repo,
      );
      if (!created.ok) {
        console.error(`[watch:${slot}] create ${w.key} failed: ${created.err}`);
        return;
      }
      const pending: PendingInteraction = {
        type: "infra_watch",
        watcher: w.key,
        cycleId,
        createdAt: Date.now(),
      };
      const sent = await trackAndSendUserMessage(env, created.id, brief, pending, WEEKLY_KV_TTL);
      if (!sent.ok) {
        console.error(`[watch:${slot}] send ${w.key} failed: ${sent.err}`);
        return;
      }
      console.log(`[watch:${slot}] ${w.key} session ${created.id} launched`);
    }),
  );

  console.log(`[watch:${slot}] watchers launched. Waiting for webhooks.`);
}

/**
 * Extrait le bloc entre `=== DISCORD_SUMMARY ===` et `=== END ===` produit par
 * un watcher. Sans marqueurs, on retourne "" pour que l'appelant decide d'un
 * fallback (snippet du brut, ou message d'erreur explicite).
 */
function extractDiscordSummary(text: string): string {
  const m = text.match(/===\s*DISCORD_SUMMARY\s*===\s*([\s\S]*?)\s*===\s*END\s*===/);
  return m ? m[1]!.trim() : "";
}

/**
 * Un watcher est idle (ou terminated) : on extrait son resume, on stocke en KV,
 * et on tente de poster le digest si tous les watchers du slot sont la.
 */
async function handleWatchDone(
  env: Env,
  pending: PendingInteraction,
  sessionId: string,
  overrideSummary?: string,
): Promise<void> {
  if (!pending.cycleId || !pending.watcher) {
    console.error(`[watch] webhook missing cycleId/watcher`);
    return;
  }
  const cycleId = pending.cycleId;
  const watcherKey = pending.watcher;
  const watcher = findWatcher(watcherKey);
  if (!watcher) {
    console.error(`[watch] watcher inconnu : ${watcherKey}`);
    return;
  }

  let summary: string;
  if (overrideSummary !== undefined) {
    summary = overrideSummary;
  } else {
    // limit=1000 (max API ; vs 500 par defaut) : les watchers font plus de tool
    // calls (fetch web + memory store I/O) que les agents adhoc, donc plus
    // d'events. L'API rejette > 1000 avec HTTP 400 ("limit: ... less than or
    // equal to 1000"), ce qui faisait remonter un snippet vide sur tous les
    // watchers au premier deploy (BUG fix 2026-05-20).
    const rawText = await fetchAgentText(env.ANTHROPIC_API_KEY, sessionId, 1000);
    const parsed = extractDiscordSummary(rawText);
    if (parsed) {
      summary = parsed;
    } else {
      const snippet = rawText.trim().slice(0, 400);
      summary = `(${watcherKey} — resume sans marqueurs DISCORD_SUMMARY ; snippet brut : ${snippet || "vide"}…)`;
    }
  }

  await env.INTERACTIONS.put(`watch:${cycleId}:${watcherKey}`, summary, {
    expirationTtl: WEEKLY_KV_TTL,
  });
  console.log(`[watch:${watcher.cycleSlot}] ${watcherKey} summary stored (${summary.length} chars) for ${cycleId}`);

  await maybePostWatchDigest(env, cycleId, watcher.cycleSlot);
}

/**
 * Header du digest specifique au slot. Reflete l'intention de chaque cycle.
 */
function watchDigestHeader(slot: CycleSlot, dateStr: string): string {
  switch (slot) {
    case "wed":
      return `# Veille infra & outils — ${dateStr}\n_Anthropic + IA + Cloudflare + Google APIs + Mobile + Comms._\n\n---\n\n`;
    case "thu":
      return `# Veille marche & users — ${dateStr}\n_Concurrents IA personnels + voix users._\n\n---\n\n`;
    case "fri":
      return `# Veille recherche docs/tutos — ${dateStr}\n_Suivi de sujets pre-definis (watch-topics.md)._\n\n---\n\n`;
    case "sat":
      return `# Synthese manager veille — ${dateStr}\n_Meta-digest executif de la semaine de veille._\n\n---\n\n`;
  }
}

/**
 * Verifie si tous les watchers du slot ont livre ; si oui, poste le digest
 * sur Discord (idempotent via watch:{cycleId}:digest-posted:{slot}) puis cleanup.
 */
async function maybePostWatchDigest(env: Env, cycleId: string, slot: CycleSlot): Promise<void> {
  const slotWatchers = watchersForSlot(slot);
  const expected = slotWatchers.map((w) => w.key);
  const results = await Promise.all(
    expected.map((key) => env.INTERACTIONS.get(`watch:${cycleId}:${key}`)),
  );
  const got = results.filter((r) => r !== null && r !== undefined).length;
  if (got < expected.length) {
    console.log(`[watch:${slot}] ${got}/${expected.length} watchers recus pour ${cycleId}`);
    return;
  }

  // Idempotence anti double-post. Clef incluant le slot car un meme cycleId
  // peut servir plusieurs slots de la meme date si triggers manuels overlap.
  const postedKey = `watch:${cycleId}:digest-posted:${slot}`;
  if (await env.INTERACTIONS.get(postedKey)) {
    console.log(`[watch:${slot}] digest deja poste pour ${cycleId}, skip`);
    return;
  }
  const dateStr = cycleId.replace(/^watch-/, "");
  const sections = slotWatchers.map((w, i) => `## ${w.label}\n\n${results[i] || "(aucun resume)"}`);
  const body = sections.join("\n\n---\n\n");
  const fullDigest = watchDigestHeader(slot, dateStr) + body;
  await discordPostMessage(env, fullDigest);
  // Marquer livre uniquement APRES confirmation de tous les chunks Discord.
  await env.INTERACTIONS.put(postedKey, new Date().toISOString(), {
    expirationTtl: WEEKLY_KV_TTL,
  });
  console.log(`[watch:${slot}] digest poste pour ${cycleId}`);

  // Email recap vulgarise (echec silencieux, ne bloque pas le cleanup).
  const subject = watchEmailSubject(slot, dateStr);
  await sendNoviceEmail(env, subject, fullDigest);

  // Cleanup. digest-posted reste (TTL 24h) pour l'idempotence.
  await Promise.all([
    ...expected.map((key) => env.INTERACTIONS.delete(`watch:${cycleId}:${key}`)),
    env.INTERACTIONS.delete(`watch:${cycleId}:meta`),
  ]);
}

/**
 * Sujet de l'email recap pour chaque slot. Vulgarise au lieu de "Veille infra"
 * etc. pour rester lisible dans l'inbox.
 */
function watchEmailSubject(slot: CycleSlot, dateStr: string): string {
  switch (slot) {
    case "wed":
      return `Recap outils & tech — semaine du ${dateStr}`;
    case "thu":
      return `Recap concurrence & users — semaine du ${dateStr}`;
    case "fri":
      return `Recap recherche & nouveautes — semaine du ${dateStr}`;
    case "sat":
      return `Synthese hebdo de l'equipe IA — ${dateStr}`;
  }
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
  const res = await fetchWithTimeout(url, {
    method: "PUT", // PUT remplace toutes les commands du guild en une fois
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  }, 8_000);
  const text = await readTextBodyLimited(res, 256 * 1024);
  if (!res.ok) {
    console.error(`[discord] register commands failed ${res.status}: ${text.slice(0, 300)}`);
    return { ok: false, detail: "Discord command registration failed" };
  }
  return { ok: true, detail: `Registered ${commands.length} command(s)` };
}

/**
 * Verifie que l'utilisateur Discord est dans l'allowlist DISCORD_ALLOWED_USER_IDS.
 * La signature Ed25519 prouve que la requete vient de Discord, pas QUI l'a lancee :
 * sans cette verif, tout membre du serveur pourrait interroger le DG (qui a le repo
 * prive Arty + le memory store strategie/decisions monte).
 */
function isAuthorizedDiscordUser(interaction: DiscordInteraction, env: Env): boolean {
  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "";
  if (!userId) return false;
  const allow = (env.DISCORD_ALLOWED_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allow.includes(userId);
}

function discordEphemeral(content: string): Response {
  return new Response(
    JSON.stringify({ type: 4, data: { content, flags: 64 } }),
    { headers: { "Content-Type": "application/json" } },
  );
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
    // Autorisation : seuls les IDs Discord de l'allowlist peuvent parler au DG.
    if (!isAuthorizedDiscordUser(interaction, env)) {
      console.warn(
        `[discord] /dg refuse, user=${interaction.member?.user?.id ?? interaction.user?.id ?? "?"}`,
      );
      return discordEphemeral("Tu n'es pas autorise a utiliser cette commande.");
    }
    // Defense en profondeur : /dg seulement dans le canal #dg dedie.
    if (
      env.DISCORD_CHANNEL_ID &&
      interaction.channel_id &&
      interaction.channel_id !== env.DISCORD_CHANNEL_ID
    ) {
      return discordEphemeral("Utilise `/dg` dans le canal #dg dedie.");
    }
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
  console.log(`[adhoc] start, user=${username}, message_chars=${userMessage.length}`);

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
    gmailVaultIds(env),
  );
  if (!created.ok) {
    console.error(`[adhoc] create session failed: ${created.err}`);
    await patchDiscordOriginal(env, interaction.token, "Erreur temporaire pendant la creation de la session DG.");
    return;
  }
  const sessionId = created.id;
  console.log(`[adhoc] session created: ${sessionId}`);

  // 2. Stocker le mapping avant d'envoyer le brief (TTL 24 h pour permettre
  // le fallback bot lorsque le token d'interaction Discord a expire).
  // Token Discord d'interaction = 15 min valide.
  const pending: PendingInteraction = {
    interactionToken: interaction.token,
    type: "adhoc",
    role: "dg",
    createdAt: Date.now(),
  };
  const sent = await trackAndSendUserMessage(env, sessionId, brief, pending, WEEKLY_KV_TTL);
  if (!sent.ok) {
    console.error(`[adhoc] send message failed: ${sent.err}`);
    if (sent.ambiguous) {
      // Le webhook livrera la reponse si Anthropic avait accepte le POST.
      return;
    }
    await patchDiscordOriginal(env, interaction.token, "Erreur temporaire pendant l'envoi du brief.");
    return;
  }
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
    await discordFetchOrThrow(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: chunks[0] }),
    }, "Discord PATCH original interaction");
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
    await discordFetchOrThrow(
      url,
      { method: "PATCH", body: form },
      "Discord PATCH original interaction with attachments",
    );
    console.log(`[discord] PATCH @original OK avec ${attachments.length} piece(s) jointe(s)`);
  }

  for (let i = 1; i < chunks.length; i++) {
    await discordFetchOrThrow(
      `${DISCORD_API}/webhooks/${env.DISCORD_APPLICATION_ID}/${interactionToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: chunks[i] }),
      },
      `Discord interaction follow-up ${i + 1}/${chunks.length}`,
    );
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
    if (await timingSafeEqual(m[1]!, expectedB64)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "signature mismatch" };
}

/**
 * Webhook Anthropic. Audit secu :
 *  - Authentification : signature HMAC SHA256 verifiee avec ANTHROPIC_WEBHOOK_SIGNING_KEY,
 *    comparaison constant-time, anti-replay 5 min.
 *  - Autorisation : on filtre que sur les sessions trackees en KV (creees par nous).
 *    Session inconnue -> 200 silent (pas de leak d'info).
 *  - Fiabilite : un idle n'est livre que pour stop_reason=end_turn. Les erreurs
 *    critiques renvoient 503 et le suivi KV n'est supprime qu'apres succes.
 *  - Leak : 401 nu cote reponse, motif d'echec uniquement en console.warn.
 *  - Stocke en KV : juste interactionToken + type, pas de PII.
 */
interface AnthropicWebhookPayload {
  id?: string;
  data?: { type?: string; id?: string };
}

type DeliveryEventType =
  | "session.status_idled"
  | "session.status_terminated"
  | "session.status_retries_exhausted";

const MAX_ANTHROPIC_WEBHOOK_BYTES = 256 * 1024;
const MAX_MCP_REQUEST_BYTES = 512 * 1024;
const WEBHOOK_PROCESSING_TTL = 5 * 60;
const WEBHOOK_HANDLED_TTL = 7 * 24 * 60 * 60;

async function handleAnthropicWebhook(request: Request, env: Env): Promise<Response> {
  let body: string;
  try {
    body = await readTextBodyLimited(request, MAX_ANTHROPIC_WEBHOOK_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return new Response("Payload Too Large", { status: 413 });
    }
    return new Response("invalid body", { status: 400 });
  }
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
    // Motif garde en log seulement : une reponse detaillee aiderait un attaquant
    // a calibrer (timestamp stale vs signature mismatch vs header manquant).
    console.warn(`[webhook] sig FAIL: ${verif.reason}`);
    return new Response("Unauthorized", { status: 401 });
  }

  let event: AnthropicWebhookPayload;
  try {
    event = JSON.parse(body) as AnthropicWebhookPayload;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const eventType = event?.data?.type;
  const sessionId = event?.data?.id;
  const sourceEventId = typeof event.id === "string" && event.id.length <= 200
    ? event.id
    : webhookId;
  console.log(`[webhook] event=${eventType} session=${sessionId}`);

  // On ne traite que les session.status_idled et session.status_terminated
  if (eventType !== "session.status_idled" && eventType !== "session.status_terminated") {
    return new Response("ignored", { status: 200 });
  }
  if (!sessionId) return new Response("no session id", { status: 200 });
  if (!sourceEventId || !/^[a-zA-Z0-9_-]+$/.test(sourceEventId)) {
    return new Response("invalid event id", { status: 400 });
  }

  // `event.id` reste identique lors des retries Anthropic. KV ne fournit pas de
  // CAS, donc ce claim est best-effort en concurrence ; il bloque en revanche
  // les replays sequentiels et les retries apres une livraison deja confirmee.
  const eventKey = `anthropic-event:${sourceEventId}`;
  const previousEventState = await env.INTERACTIONS.get(eventKey);
  if (previousEventState === "handled") return new Response(null, { status: 204 });
  if (previousEventState?.startsWith("processing:")) {
    return new Response("temporarily unavailable", { status: 503 });
  }

  // Lookup KV
  const kvKey = `sess:${sessionId}`;
  const stored = await env.INTERACTIONS.get(kvKey);
  if (!stored) {
    console.log(`[webhook] session ${sessionId} non trackee, ignore`);
    return new Response("not tracked", { status: 200 });
  }
  const pending = safeParse<PendingInteraction>(stored);
  if (!pending) {
    // Entree KV corrompue : on la supprime et on renvoie 200 pour stopper les
    // retries at-least-once d'Anthropic (sinon boucle de 500).
    console.error(`[webhook] entree KV corrompue pour ${kvKey}, suppression`);
    await env.INTERACTIONS.delete(kvKey);
    return new Response("corrupt entry", { status: 200 });
  }
  if (pending.phase === "created") {
    // L'appel POST n'a pas encore rendu la main. Attendre son second put evite
    // que celui-ci recree la cle apres une livraison tres rapide.
    return new Response("temporarily unavailable", { status: 503 });
  }
  if (pending.phase === "send_unknown") {
    // Le POST a pu etre accepte avant un timeout. La classification ci-dessous
    // tranche selon l'etat persiste chez Anthropic.
    console.warn(`[webhook] phase d'envoi ambigue pour ${sessionId}`);
  }

  let deliveryEventType = eventType as DeliveryEventType;
  if (eventType === "session.status_idled") {
    try {
      // Le webhook dit seulement "idle". Relire la session et son evenement
      // persiste permet de distinguer fin naturelle, validation requise et
      // webhook arrive en retard apres un retour a running/rescheduling.
      const session = await retrieveAnthropicSession(env.ANTHROPIC_API_KEY, sessionId);
      const idleEvent = session.status === "idle"
        ? await fetchLatestIdleEvent(env.ANTHROPIC_API_KEY, sessionId)
        : null;
      const disposition = classifyIdleDisposition(session.status, idleEvent);

      if (disposition.kind === "stale") {
        console.log(`[webhook] idle stale pour session ${sessionId}, statut=${session.status}`);
        await env.INTERACTIONS.put(eventKey, "handled", { expirationTtl: WEBHOOK_HANDLED_TTL });
        return new Response(null, { status: 204 });
      }
      if (disposition.kind === "requires_action") {
        console.warn(
          `[webhook] session ${sessionId} attend ${disposition.eventIds.length} confirmation(s), refus automatique`,
        );
        // Aucun flux d'approbation humaine n'existe encore : refuser est plus
        // sur que laisser la session attendre indefiniment ou approuver seul.
        await denyPendingToolActions(env.ANTHROPIC_API_KEY, sessionId, disposition.eventIds);
        await env.INTERACTIONS.put(eventKey, "handled", { expirationTtl: WEBHOOK_HANDLED_TTL });
        return new Response(null, { status: 204 });
      }
      if (disposition.kind === "retry") {
        console.warn(`[webhook] stop_reason indisponible pour session ${sessionId}, retry demande`);
        return new Response("temporarily unavailable", { status: 503 });
      }
      if (disposition.kind === "failed") {
        deliveryEventType = "session.status_retries_exhausted";
      }
    } catch (err) {
      console.error(`[webhook] classification session ${sessionId} impossible: ${err}`);
      return new Response("temporarily unavailable", { status: 503 });
    }
  }

  const claimValue = `processing:${crypto.randomUUID()}`;
  try {
    await env.INTERACTIONS.put(eventKey, claimValue, { expirationTtl: WEBHOOK_PROCESSING_TTL });
    const observedClaim = await env.INTERACTIONS.get(eventKey);
    if (observedClaim !== claimValue) {
      return new Response("temporarily unavailable", { status: 503 });
    }
    // Le traitement reste synchrone dans cette PR : une erreur renvoie 503 afin
    // qu'Anthropic retente. La migration Queue + Durable Object est separee.
    await deliverSessionResultToDiscord(env, pending, sessionId, deliveryEventType);
    // Marquer l'evenement avant de supprimer la session : si le delete echoue,
    // un retry n'enverra pas une seconde fois la reponse externe.
    await env.INTERACTIONS.put(eventKey, "handled", { expirationTtl: WEBHOOK_HANDLED_TTL });
    await env.INTERACTIONS.delete(kvKey);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error(`[webhook] delivery failed, suivi conserve pour ${sessionId}: ${err}`);
    try {
      if ((await env.INTERACTIONS.get(eventKey)) === claimValue) {
        await env.INTERACTIONS.delete(eventKey);
      }
    } catch (claimCleanupError) {
      console.error(`[webhook] claim cleanup failed for ${sourceEventId}: ${claimCleanupError}`);
    }
    return new Response("temporarily unavailable", { status: 503 });
  }
}

async function deliverAdhocResponse(
  env: Env,
  pending: PendingInteraction,
  content: string,
  attachments: ScreenshotAttachment[] = [],
): Promise<void> {
  if (!pending.interactionToken) {
    throw new Error("Invalid adhoc delivery state: missing interaction token");
  }
  const ageMs = Date.now() - pending.createdAt;
  const interactionBudgetMs = 13 * 60 * 1000;
  if (ageMs > interactionBudgetMs) {
    const prefix = `**Reponse differee du DG** (session de ${(ageMs / 60000).toFixed(1)} min, token interaction expire) :\n\n`;
    await discordPostMessage(env, prefix + content, attachments);
  } else {
    await patchDiscordOriginal(env, pending.interactionToken, content, attachments);
  }
}

async function deliverSessionResultToDiscord(
  env: Env,
  pending: PendingInteraction,
  sessionId: string,
  eventType: DeliveryEventType,
): Promise<void> {
  try {
    // Cas terminated / retries_exhausted : session echouee cote Anthropic.
    if (eventType !== "session.status_idled") {
      const failureReason = eventType === "session.status_retries_exhausted"
        ? "le tour Anthropic a epuise ses tentatives"
        : "la session s'est terminee anormalement cote Anthropic";
      const msg = `Erreur : ${failureReason}. Type=${pending.type}, role=${pending.role ?? "?"}, session=${sessionId}.`;
      console.error(`[webhook] terminated: ${msg}`);
      if (pending.type === "weekly_subagent") {
        // Stocker un placeholder pour ne PAS figer le cycle : maybeLaunchDG doit
        // pouvoir atteindre le compte de 3 sub-agents meme si l'un a echoue. Le
        // brief DG signale deja le gap ("Pas d'output disponible").
        await handleSubAgentDone(
          env,
          pending,
          sessionId,
          `(Session ${pending.role ?? "?"} terminee anormalement cote Anthropic, aucun livrable.)`,
        );
      } else if (pending.type === "infra_watch") {
        // Meme logique pour la veille : ne pas figer le digest si un watcher
        // echoue. On stocke un placeholder et on tente de poster le digest du slot.
        await handleWatchDone(
          env,
          pending,
          sessionId,
          `(Watch ${pending.watcher ?? "?"} terminee anormalement cote Anthropic, aucun livrable cette semaine.)`,
        );
      } else if (pending.type === "adhoc") {
        await deliverAdhocResponse(env, pending, msg);
      } else {
        await discordPostMessage(env, msg);
      }
      return;
    }

    // Dispatch sur le type
    if (pending.type === "adhoc") {
      const rawText = await fetchAgentText(env.ANTHROPIC_API_KEY, sessionId);
      const baseText = rawText && rawText.trim().length > 0
        ? rawText
        : "Le DG a fini la session mais n'a rien renvoye comme texte.";

      // Parser les marqueurs <screenshot path="..."/> et recuperer les images en pieces jointes
      const { cleanText, attachments } = await extractScreenshots(baseText, env);
      console.log(`[webhook] adhoc : ${attachments.length} screenshot(s) extrait(s)`);

      const ageMs = Date.now() - pending.createdAt;
      await deliverAdhocResponse(env, pending, cleanText, attachments);
      console.log(`[webhook] adhoc delivered to Discord (sess=${sessionId}, attachments=${attachments.length}, age=${(ageMs / 60000).toFixed(1)}min)`);
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

    if (pending.type === "infra_watch") {
      await handleWatchDone(env, pending, sessionId);
      return;
    }

    throw new Error(`Invalid delivery state: unknown pending type ${pending.type}`);
  } catch (err) {
    console.error(`[webhook] deliver error: ${err}`);
    throw err;
  }
}

// ===========================================================================
// 6.6 GOOGLE OAUTH + MCP GMAIL
// ===========================================================================

const GOOGLE_OAUTH_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

function requestedGmailScopes(env: Env): string[] {
  return env.GMAIL_DRAFTS_ENABLED === "true"
    ? [GMAIL_READONLY_SCOPE, GMAIL_COMPOSE_SCOPE]
    : [GMAIL_READONLY_SCOPE];
}

/**
 * Demarre le flow OAuth Google. Auth : header X-Trigger-Secret (BUG 7 : aucun
 * secret en query string). Renvoie l'URL de consentement Google en JSON — Florent
 * l'appelle une fois en curl puis ouvre `authorize_url` dans un navigateur. Le
 * state anti-CSRF est genere ici (KV, TTL 10 min) et verifie par le callback.
 */
async function handleGoogleOAuthStart(env: Env, request: Request): Promise<Response> {
  if (!(await checkSecret(request.headers.get("X-Trigger-Secret"), env.TRIGGER_SECRET))) {
    return new Response("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  // Genere un state random pour anti-CSRF
  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.INTERACTIONS.put(`oauth:google:state:${state}`, "1", { expirationTtl: 600 });

  const redirectUri = `${url.origin}/oauth/google/callback`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: requestedGmailScopes(env).join(" "),
    access_type: "offline",
    prompt: "consent", // garantit un refresh_token a chaque flow
    state,
  });
  return new Response(
    JSON.stringify({
      authorize_url: `${GOOGLE_OAUTH_AUTHORIZE}?${params}`,
      note: "Ouvre authorize_url dans un navigateur sous 10 min (validite du state).",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function handleGoogleOAuthCallback(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(`OAuth error: ${error}`, { status: 400 });
  }
  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  // Verifie le state anti-CSRF
  const stateOk = await env.INTERACTIONS.get(`oauth:google:state:${state}`);
  if (!stateOk) {
    return new Response("Invalid or expired state", { status: 400 });
  }
  await env.INTERACTIONS.delete(`oauth:google:state:${state}`);

  // Echange le code contre tokens
  const redirectUri = `${url.origin}/oauth/google/callback`;
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const tokRes = await fetchWithTimeout(GOOGLE_OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }, 8_000);
  if (!tokRes.ok) {
    const err = await responseErrorSnippet(tokRes);
    console.error(`[oauth-google] token exchange failed ${tokRes.status}: ${err.slice(0, 200)}`);
    return new Response("Token exchange failed", { status: 400 });
  }
  const tokens = await readJsonBodyLimited<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }>(tokRes, 256 * 1024);
  if (!tokens.refresh_token) {
    return new Response("No refresh_token returned. Re-try and ensure prompt=consent.", { status: 400 });
  }

  // Stocke le refresh_token en KV. Pas d'expiration (les refresh tokens Google sont valides jusqu'a revocation).
  await env.INTERACTIONS.put("google:refresh_token", tokens.refresh_token);
  // Optionnel : stocker l'access_token courant + son expiry pour reuse
  if (tokens.access_token && tokens.expires_in) {
    const expiresAt = Date.now() + (tokens.expires_in - 60) * 1000; // -60s marge securite
    await env.INTERACTIONS.put(
      "google:access_token",
      JSON.stringify({ token: tokens.access_token, expiresAt }),
      { expirationTtl: tokens.expires_in },
    );
  }

  console.log(`[oauth-google] success, scopes=${tokens.scope}`);
  return new Response(
    `<html><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px;">
      <h1>OAuth Google : succes</h1>
      <p>Tu peux fermer cet onglet. Le DG aura maintenant acces a Gmail (readonly + compose) via le MCP.</p>
      <p><small>Refresh token stocke en KV. Pour refaire ce flow : POST /oauth/google/start avec le header X-Trigger-Secret.</small></p>
    </body></html>`,
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

/**
 * Obtient un access_token Google valide (refresh si besoin via le refresh_token KV).
 */
async function getGoogleAccessToken(env: Env): Promise<{ ok: true; token: string } | { ok: false; err: string }> {
  // 1. Check si on a un access_token cache encore valide
  const cached = await env.INTERACTIONS.get("google:access_token");
  if (cached) {
    try {
      const { token, expiresAt } = JSON.parse(cached) as { token: string; expiresAt: number };
      if (Date.now() < expiresAt) return { ok: true, token };
    } catch {}
  }

  // 2. Refresh via le refresh_token
  const refreshToken = await env.INTERACTIONS.get("google:refresh_token");
  if (!refreshToken) {
    return { ok: false, err: "No google:refresh_token in KV. Run /oauth/google/start first." };
  }
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  const res = await fetchWithTimeout(GOOGLE_OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }, 8_000);
  if (!res.ok) {
    const err = await responseErrorSnippet(res);
    return { ok: false, err: `Google refresh ${res.status}: ${err.slice(0, 200)}` };
  }
  const data = JSON.parse(await readTextBodyLimited(res, 64 * 1024)) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) return { ok: false, err: "No access_token in refresh response" };

  // Cache le nouveau access_token
  if (data.expires_in) {
    const expiresAt = Date.now() + (data.expires_in - 60) * 1000;
    await env.INTERACTIONS.put(
      "google:access_token",
      JSON.stringify({ token: data.access_token, expiresAt }),
      { expirationTtl: data.expires_in },
    );
  }
  return { ok: true, token: data.access_token };
}

/**
 * MCP server endpoint pour Gmail. Implemente le protocole JSON-RPC 2.0.
 * Tools exposes :
 *   - gmail_search : liste de messages matching une query Gmail
 *   - gmail_get_message : detail d'un message (subject, from, body)
 *   - gmail_draft : cree un brouillon (masque par defaut)
 *
 * Audit secu :
 *   - Auth : header `Authorization: Bearer <MCP_AUTH_TOKEN>` (BUG 7 : pas de
 *     secret en query string). Comparaison constant-time.
 *   - Le DG n'expose que search/get par defaut. `gmail_draft` reste masque tant
 *     qu'un flux d'approbation humaine n'est pas disponible.
 *   - IDs Gmail valides par regex avant toute URL d'API (BUG 32).
 */
async function handleMcpGmail(request: Request, env: Env): Promise<Response> {
  if (!(await checkSecret(bearerToken(request.headers.get("Authorization")), env.MCP_AUTH_TOKEN))) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let req: { jsonrpc?: string; method?: string; params?: any; id?: string | number };
  try {
    const rawRequest = await readTextBodyLimited(request, MAX_MCP_REQUEST_BYTES);
    req = JSON.parse(rawRequest) as typeof req;
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Payload too large" } }),
        { status: 413, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const reqId = req.id ?? null;

  if (req.method === "initialize") {
    return mcpResult(reqId, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "arty-gmail-mcp", version: "1.0" },
    });
  }

  if (req.method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }

  if (req.method === "tools/list") {
    const tools: Array<Record<string, unknown>> = [
      {
        name: "gmail_search",
        description: "Cherche dans les emails de Florent. Utilise la syntaxe de recherche Gmail (ex: 'from:korben.info', 'is:unread', 'subject:arty', 'after:2026/05/10'). Retourne une liste de messages avec id, subject, from, snippet.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Query Gmail (syntaxe standard Gmail search)" },
            max_results: { type: "integer", description: "Max messages a retourner (defaut 10, max 50)", default: 10 },
          },
          required: ["query"],
        },
      },
      {
        name: "gmail_get_message",
        description: "Recupere le contenu complet d'un email par son id. Retourne subject, from, to, date, body.",
        inputSchema: {
          type: "object",
          properties: {
            message_id: { type: "string", description: "Id du message (obtenu via gmail_search)" },
          },
          required: ["message_id"],
        },
      },
    ];
    if (env.GMAIL_DRAFTS_ENABLED === "true") {
      tools.push({
        name: "gmail_draft",
        description: "Cree un brouillon de mail dans la boite Gmail de Florent (PAS d'envoi). Florent verra le draft dans Gmail UI et pourra l'envoyer ou le modifier.",
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "string", description: "Destinataire (email)" },
            subject: { type: "string", description: "Sujet" },
            body: { type: "string", description: "Corps du mail en texte brut" },
            in_reply_to_message_id: { type: "string", description: "(optionnel) Id du message auquel on repond, pour thread Gmail proprement" },
          },
          required: ["to", "subject", "body"],
        },
      });
    }
    return mcpResult(reqId, {
      tools,
    });
  }

  if (req.method === "tools/call") {
    const name = req.params?.name;
    const args = req.params?.arguments || {};

    if (name === "gmail_draft" && env.GMAIL_DRAFTS_ENABLED !== "true") {
      return mcpResult(reqId, {
        content: [{ type: "text", text: "Creation de brouillon desactivee en attente d'un flux d'approbation humaine." }],
        isError: true,
      });
    }
    if (name !== "gmail_search" && name !== "gmail_get_message" && name !== "gmail_draft") {
      return mcpResult(reqId, {
        content: [{ type: "text", text: "Tool Gmail inconnu" }],
        isError: true,
      });
    }

    const tokenResult = await getGoogleAccessToken(env);
    if (!tokenResult.ok) {
      console.error(`[mcp-gmail] Google authentication failed: ${tokenResult.err}`);
      return mcpResult(reqId, {
        content: [{ type: "text", text: "Erreur d'authentification Gmail. Consulte les logs du Worker." }],
        isError: true,
      });
    }
    const accessToken = tokenResult.token;

    try {
      if (name === "gmail_search") {
        const query = String(args.query || "");
        if (!query.trim() || query.length > 2048) {
          return mcpResult(reqId, {
            content: [{ type: "text", text: "Query Gmail vide ou trop longue (maximum 2048 caracteres)." }],
            isError: true,
          });
        }
        const max = Math.max(1, Math.min(parseInt(String(args.max_results || "10"), 10) || 10, 50));
        const listRes = await fetchWithTimeout(
          `${GMAIL_API}/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${max}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          8_000,
        );
        if (!listRes.ok) throw new Error(`Gmail list ${listRes.status}: ${await responseErrorSnippet(listRes)}`);
        const list = JSON.parse(await readTextBodyLimited(listRes, 256 * 1024)) as {
          messages?: Array<{ id: string }>;
        };
        const ids = (list.messages || []).slice(0, max);

        // Pour chaque id, fetch metadata
        const details = await Promise.all(
          ids.map(async (m) => {
            const r = await fetchWithTimeout(
              `${GMAIL_API}/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
              8_000,
            );
            if (!r.ok) return { id: m.id, error: `fetch ${r.status}` };
            const md = JSON.parse(await readTextBodyLimited(r, 256 * 1024)) as any;
            const headers = md.payload?.headers || [];
            const get = (n: string) => headers.find((h: any) => h.name === n)?.value || "";
            return {
              id: m.id,
              subject: get("Subject"),
              from: get("From"),
              date: get("Date"),
              snippet: md.snippet || "",
            };
          }),
        );
        return mcpResult(reqId, {
          content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
        });
      }

      if (name === "gmail_get_message") {
        const id = String(args.message_id || "");
        if (!isValidGmailId(id)) {
          return mcpResult(reqId, {
            content: [{ type: "text", text: "message_id invalide (attendu [a-zA-Z0-9_-])." }],
            isError: true,
          });
        }
        const r = await fetchWithTimeout(`${GMAIL_API}/users/me/messages/${id}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }, 8_000);
        if (!r.ok) throw new Error(`Gmail get ${r.status}: ${await responseErrorSnippet(r)}`);
        const msg = JSON.parse(await readTextBodyLimited(r, 2 * 1024 * 1024)) as {
          payload?: GmailMimePart;
          snippet?: string;
        };
        const headers = msg.payload?.headers || [];
        // Comparaison de header insensible a la casse (RFC 2822 — BUG 49).
        const get = (n: string) =>
          headers.find((h: any) => (h.name || "").toLowerCase() === n.toLowerCase())?.value || "";

        // Body : text/plain en priorite, sinon text/html -> texte. Le charset
        // declare est respecte (BUG 36/49 : atob() seul casse l'UTF-8 et le
        // windows-1252 des mails Outlook -> accents en U+FFFD).
        let body = "";
        const plainPart = findGmailMimePart(msg.payload, "text/plain");
        if (plainPart) {
          body = decodePartBody(plainPart);
        } else {
          const htmlPart = findGmailMimePart(msg.payload, "text/html");
          if (htmlPart) body = htmlToText(decodePartBody(htmlPart));
        }
        if (!body) body = msg.snippet || "";

        return mcpResult(reqId, {
          content: [{
            type: "text",
            text: JSON.stringify({
              id,
              subject: get("Subject"),
              from: get("From"),
              to: get("To"),
              date: get("Date"),
              body: body.slice(0, 8000),
              snippet: msg.snippet || "",
            }, null, 2),
          }],
        });
      }

      if (name === "gmail_draft") {
        const to = String(args.to || "");
        const subject = String(args.subject || "");
        const bodyText = String(args.body || "");
        const inReplyTo = args.in_reply_to_message_id ? String(args.in_reply_to_message_id) : "";
        if (inReplyTo && !isValidGmailId(inReplyTo)) {
          return mcpResult(reqId, {
            content: [{ type: "text", text: "in_reply_to_message_id invalide (attendu [a-zA-Z0-9_-])." }],
            isError: true,
          });
        }

        let threadId: string | undefined;
        let messageIdHeader: string | undefined;
        let referencesHeader: string | undefined;
        if (inReplyTo) {
          // Pour un threading RFC correct, l'ID Gmail sert a recuperer le
          // threadId, mais In-Reply-To doit contenir le vrai header Message-ID.
          const tr = await fetchWithTimeout(
            `${GMAIL_API}/users/me/messages/${inReplyTo}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            },
            8_000,
          );
          if (!tr.ok) {
            throw new Error(`Gmail reply metadata ${tr.status}`);
          }
          const tmsg = JSON.parse(await readTextBodyLimited(tr, 256 * 1024)) as {
            threadId?: string;
            payload?: { headers?: Array<{ name?: string; value?: string }> };
          };
          threadId = tmsg.threadId;
          const headers = tmsg.payload?.headers ?? [];
          const header = (headerName: string) =>
            headers.find((h) => (h.name ?? "").toLowerCase() === headerName.toLowerCase())?.value;
          messageIdHeader = header("Message-ID");
          if (!threadId || !messageIdHeader) {
            throw new Error("Gmail reply metadata incomplete");
          }
          const previousReferences = header("References") ?? "";
          referencesHeader = messageIdHeader
            ? appendReference(previousReferences, messageIdHeader)
            : previousReferences || undefined;
        }

        let raw: string;
        try {
          raw = buildRfc2822Message({
            to,
            subject,
            body: bodyText,
            inReplyTo: messageIdHeader,
            references: referencesHeader,
          });
        } catch (err) {
          if (err instanceof GmailMessageValidationError) {
            return mcpResult(reqId, {
              content: [{ type: "text", text: `Brouillon refuse : ${err.message}` }],
              isError: true,
            });
          }
          throw err;
        }

        const draftBody: { message: { raw: string; threadId?: string } } = {
          message: { raw: encodeBase64UrlUtf8(raw) },
        };
        if (threadId) draftBody.message.threadId = threadId;

        const r = await fetchWithTimeout(`${GMAIL_API}/users/me/drafts`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(draftBody),
        }, 8_000);
        if (!r.ok) throw new Error(`Gmail draft ${r.status}: ${await responseErrorSnippet(r)}`);
        const draft = JSON.parse(await readTextBodyLimited(r, 64 * 1024)) as { id?: string };
        return mcpResult(reqId, {
          content: [{
            type: "text",
            text: `Brouillon cree : id=${draft.id}. Florent peut le valider et l'envoyer depuis Gmail UI > Drafts.`,
          }],
        });
      }

      return mcpResult(reqId, {
        content: [{ type: "text", text: `Tool ${name} inconnu` }],
        isError: true,
      });
    } catch (err) {
      console.error(`[mcp-gmail] err in ${name}: ${err}`);
      return mcpResult(reqId, {
        content: [{ type: "text", text: `Erreur execution ${name}. Consulte les logs du Worker.` }],
        isError: true,
      });
    }
  }

  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: reqId,
      error: { code: -32601, message: `Method not found: ${req.method}` },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function mcpResult(id: string | number | null, result: any): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id, result }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ===========================================================================
// 7. EXPORT HANDLERS
// ===========================================================================

export default {
  /**
   * Crons :
   *  - "0 18 * * SUN" : cycle hebdo growth (3 sous-agents + DG).
   *  - "0 12 * * WED" : veille outils/infra (7 watchers, slot wed).
   *  - "0 12 * * THU" : veille marche/users (2 watchers, slot thu).
   *  - "0 12 * * FRI" : veille recherche docs/tutos (1 watcher, slot fri).
   *  - "0 12 * * SAT" : meta-digest du manager veille (1 watcher, slot sat).
   * On dispatch sur `event.cron` pour ne pas mixer les flux.
   */
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    switch (event.cron) {
      case "0 12 * * WED":
        await runWatchCycle(env, "wed"); return;
      case "0 12 * * THU":
        await runWatchCycle(env, "thu"); return;
      case "0 12 * * FRI":
        await runWatchCycle(env, "fri"); return;
      case "0 12 * * SAT":
        await runWatchCycle(env, "sat"); return;
      default:
        await runWeeklyCycle(env);
    }
  },

  /**
   * HTTP : 9 routes (detail en tete de fichier). Auth par header uniquement,
   * jamais en query string (BUG 7).
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

    // /trigger : run manuel du cycle growth
    if (url.pathname === "/trigger" && request.method === "POST") {
      if (!(await checkSecret(request.headers.get("X-Trigger-Secret"), env.TRIGGER_SECRET))) {
        return new Response("Not Found", { status: 404 });
      }
      ctx.waitUntil(runWeeklyCycle(env));
      return new Response(JSON.stringify({ status: "triggered", at: new Date().toISOString() }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }

    // /admin/trigger-watch?slot=wed|thu|fri|sat : run manuel d'un cycle de veille.
    // Slot par defaut : "wed" (cycle outils/infra).
    if (url.pathname === "/admin/trigger-watch" && request.method === "POST") {
      if (!(await checkSecret(request.headers.get("X-Trigger-Secret"), env.TRIGGER_SECRET))) {
        return new Response("Not Found", { status: 404 });
      }
      const slotParam = (url.searchParams.get("slot") || "wed").toLowerCase();
      const validSlots: CycleSlot[] = ["wed", "thu", "fri", "sat"];
      if (!validSlots.includes(slotParam as CycleSlot)) {
        return new Response(
          JSON.stringify({ error: `slot invalide. Attendu : ${validSlots.join(", ")}.` }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      const slot = slotParam as CycleSlot;
      ctx.waitUntil(runWatchCycle(env, slot));
      return new Response(JSON.stringify({ status: "watch-triggered", slot, at: new Date().toISOString() }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }

    // /admin/register-commands : enregistre la slash command /dg sur le guild Discord
    if (url.pathname === "/admin/register-commands" && request.method === "POST") {
      if (!(await checkSecret(request.headers.get("X-Trigger-Secret"), env.TRIGGER_SECRET))) {
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
      if (!(await checkSecret(request.headers.get("X-Trigger-Secret"), env.TRIGGER_SECRET))) {
        return new Response("Not Found", { status: 404 });
      }
      try {
        await discordPostMessage(env, `Test de connexion bot - ${new Date().toISOString()}\n\nSi tu vois ce message, le bot Discord est correctement connecte au canal #dg.`);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error(`[admin/post-test] Discord delivery failed: ${err}`);
        return new Response(JSON.stringify({ ok: false, error: "Discord delivery failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // /anthropic/webhook : reception des events Anthropic (session.status_idled)
    if (url.pathname === "/anthropic/webhook" && request.method === "POST") {
      return handleAnthropicWebhook(request, env);
    }

    // /oauth/google/start : initie le OAuth flow Google (setup one-shot par Florent).
    // POST + header X-Trigger-Secret ; renvoie l'URL de consentement en JSON.
    if (url.pathname === "/oauth/google/start" && request.method === "POST") {
      return handleGoogleOAuthStart(env, request);
    }

    // /oauth/google/callback : Google nous redirige ici apres consent
    if (url.pathname === "/oauth/google/callback" && request.method === "GET") {
      return handleGoogleOAuthCallback(env, request);
    }

    // /mcp/gmail : MCP server endpoint (consomme par l'agent DG via mcp_servers config)
    if (url.pathname === "/mcp/gmail" && request.method === "POST") {
      return handleMcpGmail(request, env);
    }

    // /discord/interactions : webhook Discord
    if (url.pathname === "/discord/interactions" && request.method === "POST") {
      let body: string;
      try {
        body = await readTextBodyLimited(request, 256 * 1024);
      } catch (error) {
        return new Response(
          error instanceof BodyTooLargeError ? "payload too large" : "invalid body",
          { status: error instanceof BodyTooLargeError ? 413 : 400 },
        );
      }
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

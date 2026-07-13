import type { Env } from '../../env'
import { checkAllowedUserPeek } from '../_lib/checkAllowedUser'
import { consumeCapAtomic } from '../_lib/atomicQuota'
import { recordUsage } from '../_lib/quota'

/**
 * C-F (CDC visibilité modèle, décision D5) — Fact-check en quota de FOND.
 *
 * Endpoint DÉDIÉ, pattern memory-extract : un fact-check ne consomme NI le
 * cap premium mensuel NI le quota journalier utilisateur. Avant cette PR,
 * chaque vérification (mode auto = Sonnet + web_search après CHAQUE réponse
 * > 80 chars) passait par /api/ai/proxy et mangeait le bucket « 150
 * Sonnet/Opus par mois » de l'abonné — un cap de 150 ne payait que ~75 vrais
 * échanges (audit F-15). Le fact-check est un coût opérationnel Arty, pas un
 * message utilisateur.
 *
 * Garde-fous (RÈGLE 6 — cet endpoint dépense la clé serveur) :
 * - Auth Google obligatoire (anti-relais anonyme, CRIT-4).
 * - Réservé aux plans payants sur clé serveur (subscription/vip) — le
 *   fact-check est OFF par défaut pour free/trial côté client, et cet
 *   endpoint ne doit pas devenir un mini-proxy Claude gratuit.
 * - Le prompt système, le modèle, max_tokens et les tools sont FIXÉS ICI :
 *   le client n'envoie que {tier, question, response, sources} tronqués
 *   côté serveur. Aucun contenu arbitraire ne pilote l'appel.
 * - Rate-limit de fond BORNÉ par palier (bg_quota, compteur atomique D1) :
 *   60 vérifs Haiku/jour + 15 escalades Sonnet/jour par utilisateur.
 *   Ces caps sont LE contrôle de coût — ne pas les remonter sans décision
 *   écrite. Coût owner worst-case ≈ 2,8 $/jour/utilisateur depuis le bump
 *   maxTokens/max_uses de juillet 2026 (avant : ≈ 1,2 $) ; réel très
 *   inférieur (l'escalade ne part que sur claims risqués, et personne ne
 *   sature 60 vérifs/jour).
 * - recordUsage trace le coût réel en D1 (sans toucher les compteurs de
 *   quota visibles).
 * - Erreurs upstream masquées (générique + console.error), pattern V-4 —
 *   y compris sur le chemin retry.
 */

// maxTokens : chaque claim porte jusqu'à 4×500 chars (claim, explanation,
// originalText, correction) × 10 claims max. À 1024 tokens (historique), le
// JSON sortait TRONQUÉ dès ~4-5 claims riches → « JSON malformé » côté
// client → en mode auto, la passe Haiku avortait TOUTE la cascade (l'escalade
// Sonnet ne partait jamais). Cause n°1 des échecs remontés en juillet 2026.
const TIERS = {
  haiku: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 3000,
    webSearch: false,
    dailyCap: 60,
    task: 'fact-check-haiku',
    // Pas de web_search : réponse en quelques secondes. 15 s couvre le
    // cold start Worker + D1 sans laisser pendre le badge.
    upstreamTimeoutMs: 15_000,
  },
  sonnet: {
    model: 'claude-sonnet-5',
    maxTokens: 4000,
    webSearch: true,
    dailyCap: 15,
    task: 'fact-check-sonnet',
    // Sonnet + web_search accumule toute la réponse côté Anthropic avant
    // de répondre (25-30 s mesurés en prod).
    upstreamTimeoutMs: 50_000,
  },
} as const

type Tier = keyof typeof TIERS

const MAX_QUESTION_CHARS = 2000
const MAX_RESPONSE_CHARS = 6000
const MAX_SOURCES_CHARS = 8000

// Prompt système du fact-checker — vit CÔTÉ SERVEUR (le client ne peut pas
// le remplacer, sinon l'endpoint devient un proxy Claude générique hors
// quota). Copie exacte de l'ancien prompt client (factChecker.ts, historique
// PR #143/#144/#145 — dont la whitelist des domaines Arty, BUG 57).
const SYSTEM_PROMPT = `Tu es un fact-checker rigoureux. On te donne une question d'utilisateur, une réponse d'IA à vérifier, ET (si disponible) les SOURCES WEB CONSULTÉES par l'IA pendant sa réponse. Ton job : identifier les claims factuels VÉRIFIABLES (chiffres précis, dates, noms propres, prix, scores, statistiques, citations), donner un verdict pour CHACUN, et PROPOSER UNE CORRECTION quand tu es confiant que c'est faux.

Verdicts possibles :
- "verified" : tu es très confiant que le claim est exact. Si SOURCES présentes, le claim est confirmé par au moins une source. Sinon, info stable connue (ex: "Paris est la capitale de la France").
- "uncertain" : tu n'as pas assez d'info pour confirmer. Si SOURCES présentes : aucune ne confirme ni ne contredit le claim. Sinon : tu hésites.
- "wrong" : tu es très confiant que le claim est faux ET tu connais la version correcte. Si SOURCES présentes, tu peux extraire la bonne réponse de leurs snippets.

UTILISATION DES SOURCES (si fournies) :
Quand des sources web sont fournies, tu DOIS les utiliser comme vérité prioritaire (elles sont fraîches, ton training data peut être obsolète). Pour chaque claim, cherche dans les sources :
- Si claim explicitement confirmé par 1+ sources → "verified"
- Si claim explicitement contredit par 1+ sources → "wrong" + extraire la bonne valeur des sources comme "correction"
- Si claim non mentionné dans les sources → "uncertain" (les sources couvraient juste partiellement le sujet)

Pour les claims "wrong", AJOUTE deux champs :
- "originalText" : le passage EXACT de la réponse à corriger, copié VERBATIM caractère par caractère — Y COMPRIS le markdown (**gras**, _italique_), la ponctuation, les apostrophes et les espaces tels qu'ils apparaissent dans la réponse. Si tu omets le markdown ou modifies un caractère, le remplacement automatique échoue.
- "correction" : le texte qui doit le remplacer dans la réponse, basé sur les sources si fournies. Une VALEUR de remplacement du même format que l'original (ex : une plage de températures remplace une plage de températures) — l'explication du pourquoi va dans "explanation", PAS dans "correction".

Si tu sais que le claim est faux MAIS tu ne connais pas la bonne réponse (ni dans tes données ni dans les sources), marque-le "uncertain" plutôt que "wrong" et omet "correction".

DÉCISION ANCRÉE SUR LES SOURCES — règle à deux régimes :
- AVEC source (fournie ci-dessus OU trouvée via web_search) : sois DÉCISIF. Une source fiable qui contredit un claim = "wrong" + "correction" extraite de la source, JAMAIS "uncertain". Ne te réfugie pas dans "uncertain" quand une source tranche — un fact-checker qui voit l'erreur et ne la corrige pas ne sert à rien.
- SANS source (jugement sur ta seule connaissance interne) : reste prudent, préfère "uncertain" à "wrong" quand tu doutes.
Dans les deux régimes, ignore les claims évidents ("Paris est en France"), les opinions ("c'est joli"), et les conseils généraux.

URLs ET LIENS — règle stricte :
- N'ALTÈRE JAMAIS un markdown link [...](URL) sauf si tu es CERTAIN que l'URL est dangereuse (phishing, malware) ou trompeusement attribuée (ex : citée comme "source officielle Apple" alors que c'est un blog).
- Les domaines suivants sont les domaines de l'app Arty elle-même (deep-links internes vers des features comme les rapports comparatifs, les exports PDF, les conversations partagées) — ne les considère JAMAIS comme suspects ou tiers :
  * appfacade.pages.dev (toutes routes : /report/, /chat/, /upgrade, etc.)
  * tryarty.com (toutes routes)
  * claude-fix-arty-error-vzjfz.appfacade.pages.dev (preview branch)
  * *.appfacade.pages.dev (previews Cloudflare)
- Une URL inconnue n'est PAS automatiquement fausse. Préfère "uncertain" plutôt que de la supprimer.

Si la réponse contient ZÉRO claim factuel risqué, retourne "claims": [] et "overall_confidence": "high".

OUTIL WEB_SEARCH (si disponible) :
Si le tool web_search est mis à ta disposition, tu PEUX l'appeler pour vérifier un claim que les sources fournies ne couvrent PAS — exemples : existence d'un produit/modèle/personne, dates de sortie, tarifs officiels, scores benchmarks, citations exactes. Préfère 1 à 3 recherches ciblées (max 3) plutôt que 0 — c'est ce qui te permet de passer "uncertain" à "verified" ou "wrong" sur des claims vérifiables en ligne. N'appelle PAS web_search pour les claims déjà confirmés/contredits par les sources fournies, ni pour les opinions ou conseils. Après tes recherches, retourne ton JSON final dans un dernier bloc texte.

RÉPONDS UNIQUEMENT EN JSON VALIDE, sans texte avant ou après, sans backticks, format strict :
{
  "overall_confidence": "high" | "medium" | "low",
  "claims": [
    { "claim": "string", "verdict": "verified" | "uncertain" | "wrong", "explanation": "string courte", "originalText": "...", "correction": "..." }
  ]
}

Tout verdict "wrong" DOIT inclure "originalText" ET "correction". Si tu ne peux pas fournir les deux (passage exact introuvable, bonne valeur inconnue), utilise "uncertain" à la place — un "wrong" sans correction allume un badge rouge sans rien réparer.

Échelle overall_confidence :
- "high" : 0 claim risqué OU tous "verified"
- "medium" : claims "uncertain" présents
- "low" : au moins 1 "wrong" OU plusieurs "uncertain" critiques`

interface FactCheckRequest {
  tier?: unknown
  question?: unknown
  response?: unknown
  sources?: unknown
}

// Retry ×1 CÔTÉ SERVEUR sur transitoire (throw réseau hors timeout, 429/5xx
// Anthropic). JAMAIS côté client : bg_quota est consommé à l'ENTRÉE de
// l'endpoint — un retry client brûlerait une 2e unité du cap journalier pour
// la même vérification. Ici le quota est déjà consommé : retenter ne
// re-facture rien. Pas de retry sur timeout (le budget du palier est déjà
// épuisé, le client a probablement abandonné — repartir pour un tour complet
// coûterait un appel Anthropic entier pour un résultat jeté).
async function fetchAnthropicWithRetry(body: string, apiKey: string, timeoutMs: number): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
        try { await res.body?.cancel() } catch { /* body déjà consommé/absent */ }
        await new Promise((r) => setTimeout(r, 500))
        continue
      }
      return res
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') throw err
      lastErr = err
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 500))
        continue
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('anthropic fetch failed')
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // checkAllowedUserPeek = auth Google (aud C1/F-9) + résolution de plan
  // INCLUANT le bypass whitelist ALLOWED_EMAILS → 'vip'. Ne PAS remplacer
  // par resolveUserPlan seul : il ignore la whitelist, ce qui faux-bloquait
  // les bêta-testeurs VIP en 403 permanent (revue Opus PR 5) alors que le
  // client les croit VIP (subscription/status les mappe 'vip') et tente un
  // fact-check à chaque réponse.
  const user = await checkAllowedUserPeek(request, env)
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  const email = user.email
  if (!env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'fact_check_unavailable' }, { status: 503 })
  }

  // Plans sur clé serveur uniquement. free/trial ont le fact-check OFF côté
  // client (getFactCheckMode) ; pro = BYOK (pas de clé serveur, PR #287).
  if (user.planType !== 'subscription' && user.planType !== 'vip') {
    return Response.json({ error: 'fact_check_unavailable' }, { status: 403 })
  }

  let payload: FactCheckRequest
  try {
    payload = (await request.json()) as FactCheckRequest
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  const tier: Tier = payload.tier === 'sonnet' ? 'sonnet' : 'haiku'
  const cfg = TIERS[tier]

  const question = typeof payload.question === 'string' ? payload.question.slice(0, MAX_QUESTION_CHARS) : ''
  const response = typeof payload.response === 'string' ? payload.response.slice(0, MAX_RESPONSE_CHARS) : ''
  const sources = typeof payload.sources === 'string' ? payload.sources.slice(0, MAX_SOURCES_CHARS) : ''
  if (response.trim().length < 80) {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Rate-limit de fond par palier (même table/pattern que memory-extract).
  if (env.DB) {
    try {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS bg_quota (
          email TEXT NOT NULL,
          day TEXT NOT NULL,
          task TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (email, day, task)
        )`
      ).run()
    } catch (err) {
      console.error('[fact-check] ensure table failed', err)
    }
    const day = new Date().toISOString().slice(0, 10)
    const outcome = await consumeCapAtomic(
      env,
      `INSERT INTO bg_quota (email, day, task, count, updated_at)
       VALUES (?1, ?2, ?3, 1, unixepoch())
       ON CONFLICT (email, day, task) DO UPDATE SET count = count + 1, updated_at = unixepoch()
         WHERE bg_quota.count < ?4
       RETURNING count`,
      [email, day, cfg.task, cfg.dailyCap]
    )
    if (outcome.status === 'cap_reached') {
      return Response.json({ error: 'fact_check_quota' }, { status: 429 })
    }
  }

  const userContent = `Question utilisateur :\n${question}\n\nRéponse à vérifier :\n${response}${sources}`

  try {
    const res = await fetchAnthropicWithRetry(
      JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
        ...(cfg.webSearch
          ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] }
          : {}),
      }),
      env.ANTHROPIC_API_KEY,
      cfg.upstreamTimeoutMs
    )

    if (!res.ok) {
      console.error('[fact-check] upstream', res.status, await res.text().catch(() => ''))
      return Response.json({ error: 'fact_check_failed' }, { status: 502 })
    }

    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>
      usage?: {
        input_tokens?: number
        output_tokens?: number
        cache_read_input_tokens?: number
        cache_creation_input_tokens?: number
      }
    }

    // Coût réel tracé en D1 (dashboard/vigie éco) — hors compteurs visibles.
    await recordUsage(env, email, cfg.model, {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: data.usage?.cache_creation_input_tokens ?? 0,
      audioSeconds: 0,
    })

    // Relais FILTRÉ : uniquement content/usage (le client parse le dernier
    // bloc texte, même logique qu'avant via le proxy).
    return Response.json({ content: data.content ?? [], usage: data.usage ?? {} })
  } catch (err) {
    console.error('[fact-check] failed', err)
    return Response.json({ error: 'fact_check_failed' }, { status: 502 })
  }
}

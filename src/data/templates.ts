export type TemplateCategory =
  | 'artisanat'
  | 'freelance'
  | 'admin'
  | 'juridique'
  | 'marketing'
  | 'finances'

export interface TemplateField {
  key: string
  label: string
  placeholder: string
  multiline?: boolean
}

export interface Template {
  id: string
  category: TemplateCategory
  title: string
  description: string
  icon: string
  fields: TemplateField[]
  prompt: string
}

export const CATEGORY_LABELS: Record<TemplateCategory, { label: string; icon: string }> = {
  artisanat: { label: 'Artisanat', icon: '🔨' },
  freelance: { label: 'Freelance', icon: '💼' },
  admin: { label: 'Admin', icon: '📋' },
  juridique: { label: 'Juridique', icon: '⚖️' },
  marketing: { label: 'Marketing', icon: '📣' },
  finances: { label: 'Finances', icon: '💰' },
}

export const TEMPLATES: Template[] = [
  // ─── Artisanat ────────────────────────────────────────────────────────────
  {
    id: 'artisanat-devis-travaux',
    category: 'artisanat',
    title: 'Rédiger un devis travaux',
    description: 'Devis professionnel détaillé avec matériaux, main d’œuvre, TVA et conditions de paiement.',
    icon: '📝',
    fields: [
      { key: 'nom_client', label: 'Nom du client', placeholder: 'Mme Dupont' },
      { key: 'adresse_chantier', label: 'Adresse du chantier', placeholder: '12 rue des Lilas, 75011 Paris' },
      { key: 'description_travaux', label: 'Description des travaux', placeholder: 'Rénovation salle de bain', multiline: true },
      { key: 'superficie', label: 'Superficie', placeholder: '8 m²' },
      { key: 'délai', label: 'Délai estimé', placeholder: '2 semaines' },
    ],
    prompt: `Rédige un devis professionnel pour {{nom_client}} concernant des travaux de {{description_travaux}} au {{adresse_chantier}}. Surface : {{superficie}}. Délai estimé : {{délai}}. Inclure : descriptif détaillé, liste des matériaux, main d’œuvre, TVA 10%, conditions de paiement (30% à la commande, solde à la fin).`,
  },
  {
    id: 'artisanat-avis-google',
    category: 'artisanat',
    title: 'Répondre à un avis Google négatif',
    description: 'Réponse calme et constructive à un avis négatif, sans être défensif.',
    icon: '💬',
    fields: [
      { key: 'texte_avis', label: 'Texte de l’avis', placeholder: 'Collez ici l’avis négatif…', multiline: true },
      { key: 'problème_évoqué', label: 'Problème évoqué', placeholder: 'Retard de chantier, malfaçon…' },
    ],
    prompt: `Rédige une réponse professionnelle et empathique à cet avis Google négatif : '{{texte_avis}}'. Le problème évoqué est : {{problème_évoqué}}. Ton : calme, constructif, sans être défensif. Max 5 phrases.`,
  },
  {
    id: 'artisanat-relance-impaye',
    category: 'artisanat',
    title: 'Relance client impayé (amiable)',
    description: 'Email de relance amiable avec ton cordial mais ferme et nouveau délai de 8 jours.',
    icon: '📧',
    fields: [
      { key: 'nom_client', label: 'Nom du client', placeholder: 'M. Martin' },
      { key: 'numéro_facture', label: 'Numéro de facture', placeholder: 'F2026-0042' },
      { key: 'montant', label: 'Montant', placeholder: '1 250' },
      { key: 'date_facture', label: 'Date de facture', placeholder: '15 mars 2026' },
      { key: 'date_échéance', label: 'Date d’échéance', placeholder: '15 avril 2026' },
    ],
    prompt: `Rédige un email de relance amiable pour la facture {{numéro_facture}} de {{montant}}€ émise le {{date_facture}}, échue le {{date_échéance}}, adressée à {{nom_client}}. Ton cordial mais ferme. Proposer un délai de paiement de 8 jours.`,
  },
  {
    id: 'artisanat-realisation-site',
    category: 'artisanat',
    title: 'Description d’une réalisation pour le site web',
    description: 'Descriptif engageant 100-150 mots style blog artisan pour mettre en valeur un chantier.',
    icon: '🏗️',
    fields: [
      { key: 'type_travaux', label: 'Type de travaux', placeholder: 'Pose de parquet massif' },
      { key: 'lieu', label: 'Lieu', placeholder: 'Maison ancienne à Bordeaux' },
      { key: 'matériaux', label: 'Matériaux utilisés', placeholder: 'Chêne français huilé' },
      { key: 'durée', label: 'Durée du chantier', placeholder: '5 jours' },
      { key: 'résultat', label: 'Résultat', placeholder: 'Sol chaleureux et durable' },
    ],
    prompt: `Rédige une description engageante de 100-150 mots pour illustrer une réalisation : {{type_travaux}} à {{lieu}}, matériaux utilisés : {{matériaux}}, durée du chantier : {{durée}}, résultat : {{résultat}}. Ton professionnel et accessible, style blog artisan.`,
  },
  {
    id: 'artisanat-confirmation-rdv',
    category: 'artisanat',
    title: 'Email de confirmation de rendez-vous',
    description: 'Confirmation de RDV avec ce qu’il faut prévoir et numéro de contact pour modifier.',
    icon: '📅',
    fields: [
      { key: 'nom_client', label: 'Nom du client', placeholder: 'Mme Lefèvre' },
      { key: 'date_rdv', label: 'Date du rendez-vous', placeholder: 'lundi 28 avril' },
      { key: 'heure_rdv', label: 'Heure', placeholder: '14h30' },
      { key: 'adresse', label: 'Adresse', placeholder: '5 avenue de la République' },
      { key: 'objet_rdv', label: 'Objet du rendez-vous', placeholder: 'Devis pose carrelage' },
    ],
    prompt: `Rédige un email de confirmation de rendez-vous pour {{nom_client}}, le {{date_rdv}} à {{heure_rdv}}, à l’adresse {{adresse}}, objet : {{objet_rdv}}. Inclure ce qu’il faut prévoir et un numéro de contact pour modifier.`,
  },

  // ─── Freelance ────────────────────────────────────────────────────────────
  {
    id: 'freelance-proposition',
    category: 'freelance',
    title: 'Proposition commerciale client',
    description: 'Proposition structurée : résumé, besoin, solution, planning, tarification, prochaines étapes.',
    icon: '📄',
    fields: [
      { key: 'nom_client', label: 'Nom du client', placeholder: 'Sophie Bernard' },
      { key: 'société', label: 'Société', placeholder: 'Acme SAS' },
      { key: 'besoin', label: 'Besoin identifié', placeholder: 'Refonte site e-commerce', multiline: true },
      { key: 'solution_proposée', label: 'Solution proposée', placeholder: 'Nouveau Shopify + design custom', multiline: true },
      { key: 'budget_estimé', label: 'Budget estimé (€)', placeholder: '8000' },
      { key: 'délai', label: 'Délai', placeholder: '6 semaines' },
    ],
    prompt: `Rédige une proposition commerciale professionnelle pour {{nom_client}} de {{société}}. Besoin identifié : {{besoin}}. Solution proposée : {{solution_proposée}}. Budget estimé : {{budget_estimé}}€. Délai : {{délai}}. Structure : résumé exécutif, compréhension du besoin, solution, planning, tarification, prochaines étapes.`,
  },
  {
    id: 'freelance-cr-reunion',
    category: 'freelance',
    title: 'Compte-rendu de réunion client',
    description: 'CR structuré en bullet points : sujets, décisions, actions à mener.',
    icon: '🗒️',
    fields: [
      { key: 'date', label: 'Date de la réunion', placeholder: '24 avril 2026' },
      { key: 'participants', label: 'Participants', placeholder: 'Sophie Bernard (Acme), moi' },
      { key: 'sujets_abordés', label: 'Sujets abordés', placeholder: 'Roadmap Q3, budget, recrutement…', multiline: true },
      { key: 'décisions_prises', label: 'Décisions prises', placeholder: '…', multiline: true },
      { key: 'actions_suivantes', label: 'Actions suivantes', placeholder: '…', multiline: true },
    ],
    prompt: `Rédige un compte-rendu de réunion du {{date}} avec {{participants}}. Sujets abordés : {{sujets_abordés}}. Décisions prises : {{décisions_prises}}. Actions suivantes : {{actions_suivantes}}. Format : bullet points clairs, ton professionnel.`,
  },
  {
    id: 'freelance-cgv',
    category: 'freelance',
    title: 'Conditions générales de vente simplifiées',
    description: 'CGV claires en 400 mots max : prix, paiement, propriété intellectuelle, responsabilité.',
    icon: '📜',
    fields: [
      { key: 'nom_entreprise', label: 'Nom de l’entreprise', placeholder: 'Atelier Bernard' },
      { key: 'activité', label: 'Activité', placeholder: 'Conseil et développement web' },
      { key: 'pays', label: 'Pays', placeholder: 'France' },
      { key: 'délai_paiement', label: 'Délai de paiement (jours)', placeholder: '30' },
    ],
    prompt: `Rédige des CGV simplifiées pour {{nom_entreprise}}, activité : {{activité}}, basée en {{pays}}. Délai de paiement : {{délai_paiement}} jours. Inclure : objet, prix, paiement, propriété intellectuelle, responsabilité, loi applicable. Langage clair, 400 mots max.`,
  },
  {
    id: 'freelance-post-linkedin',
    category: 'freelance',
    title: 'Post LinkedIn (partage de réalisation)',
    description: 'Post authentique avec hook, 3-4 paragraphes courts et 1 question pour engager.',
    icon: '📢',
    fields: [
      { key: 'projet', label: 'Projet', placeholder: 'Refonte UX d’une app banking' },
      { key: 'résultat_clé', label: 'Résultat clé', placeholder: '+18% de conversion' },
      { key: 'apprentissage', label: 'Apprentissage', placeholder: 'Tester sur de vrais users dès la semaine 1' },
      { key: 'secteur', label: 'Secteur', placeholder: 'Fintech B2C' },
    ],
    prompt: `Rédige un post LinkedIn pour partager cette réalisation : {{projet}}, résultat clé : {{résultat_clé}}, apprentissage : {{apprentissage}}, secteur : {{secteur}}. Ton authentique et personnel, hook accrocheur, 3-4 paragraphes courts, 1 question pour engager. Sans hashtags excessifs.`,
  },
  {
    id: 'freelance-suivi-devis',
    category: 'freelance',
    title: 'Email de suivi après devis sans réponse',
    description: 'Relance utile et non insistante après un devis envoyé sans retour.',
    icon: '✉️',
    fields: [
      { key: 'nom_client', label: 'Nom du client', placeholder: 'Marc Lemoine' },
      { key: 'objet_devis', label: 'Objet du devis', placeholder: 'Refonte du site corporate' },
      { key: 'date_envoi_devis', label: 'Date d’envoi du devis', placeholder: '12 avril 2026' },
      { key: 'montant', label: 'Montant', placeholder: '5400' },
    ],
    prompt: `Rédige un email de suivi pour {{nom_client}} qui n’a pas répondu au devis {{objet_devis}} de {{montant}}€ envoyé le {{date_envoi_devis}}. Ton : curieux et utile, pas insistant. Proposer de clarifier des points ou ajuster si besoin.`,
  },

  // ─── Admin ────────────────────────────────────────────────────────────────
  {
    id: 'admin-resume-document',
    category: 'admin',
    title: 'Résumer un contrat ou document long',
    description: 'Synthèse en 5 points : obligations, dates, montants, clauses inhabituelles, à retenir.',
    icon: '📑',
    fields: [
      { key: 'texte_document', label: 'Texte du document', placeholder: 'Collez le contenu du contrat ou document…', multiline: true },
    ],
    prompt: `Résume ce document en 5 points clés, en mettant en évidence : les obligations importantes, les dates ou délais critiques, les montants, les clauses inhabituelles ou risquées, et ce qu’il faut retenir avant de signer :\n\n{{texte_document}}`,
  },
  {
    id: 'admin-urssaf',
    category: 'admin',
    title: 'Préparer une déclaration URSSAF / charges',
    description: 'Cotisations à déclarer, calcul, délais — réponse pratique et chiffrée.',
    icon: '🧾',
    fields: [
      { key: 'revenus_trimestre', label: 'Revenus du trimestre (€)', placeholder: '12500' },
      { key: 'type_activité', label: 'Type d’activité', placeholder: 'Prestation de services BNC' },
      { key: 'régime', label: 'Régime', placeholder: 'Micro-entreprise' },
    ],
    prompt: `J’ai {{revenus_trimestre}}€ de revenus ce trimestre, activité {{type_activité}}, régime {{régime}}. Explique-moi : quelles cotisations je dois déclarer, comment les calculer, et les délais à respecter. Réponse pratique et chiffrée.`,
  },
  {
    id: 'admin-email-difficile',
    category: 'admin',
    title: 'Répondre à un email difficile (client mécontent)',
    description: 'Réponse calme qui reconnaît le problème et propose une solution concrète.',
    icon: '🛡️',
    fields: [
      { key: 'texte_email_reçu', label: 'Email reçu', placeholder: 'Collez ici le contenu de l’email…', multiline: true },
      { key: 'contexte_situation', label: 'Contexte', placeholder: 'Retard de livraison, projet en cours…', multiline: true },
    ],
    prompt: `Voici un email d’un client mécontent : '{{texte_email_reçu}}'. Contexte : {{contexte_situation}}. Rédige une réponse professionnelle qui reconnaît le problème, explique sans se justifier excessivement, et propose une solution concrète. Ton calme et constructif.`,
  },
  {
    id: 'admin-traduction',
    category: 'admin',
    title: 'Traduire un document professionnel',
    description: 'Traduction formelle qui préserve le ton et la précision technique.',
    icon: '🌍',
    fields: [
      { key: 'texte_à_traduire', label: 'Texte à traduire', placeholder: 'Collez le texte source…', multiline: true },
      { key: 'langue_source', label: 'Langue source', placeholder: 'français' },
      { key: 'langue_cible', label: 'Langue cible', placeholder: 'anglais' },
      { key: 'contexte', label: 'Contexte', placeholder: 'Email à un client US, contrat technique…' },
    ],
    prompt: `Traduis ce texte professionnel du {{langue_source}} vers le {{langue_cible}}, contexte : {{contexte}}. Garde le ton formel et la précision technique :\n\n{{texte_à_traduire}}`,
  },

  // ─── Juridique ────────────────────────────────────────────────────────────
  {
    id: 'juridique-clause',
    category: 'juridique',
    title: 'Analyser une clause contractuelle',
    description: 'Décryptage en langage clair : sens, risques, standard ou pas, à modifier ?',
    icon: '🔍',
    fields: [
      { key: 'texte_clause', label: 'Texte de la clause', placeholder: 'Collez la clause à analyser…', multiline: true },
      { key: 'contexte_contrat', label: 'Contexte du contrat', placeholder: 'Contrat de prestation, CDI, NDA…' },
    ],
    prompt: `Analyse cette clause contractuelle : '{{texte_clause}}'. Contexte : {{contexte_contrat}}. Explique en langage clair : ce qu’elle signifie, les risques éventuels pour moi, si c’est standard ou inhabituel, et si je devrais demander une modification. Je ne suis pas juriste.`,
  },
  {
    id: 'juridique-mise-en-demeure',
    category: 'juridique',
    title: 'Lettre de mise en demeure',
    description: 'Lettre formelle, ferme mais légalement prudente, avec délai de réponse.',
    icon: '⚖️',
    fields: [
      { key: 'nom_destinataire', label: 'Nom du destinataire', placeholder: 'Société Beta SARL' },
      { key: 'adresse_destinataire', label: 'Adresse', placeholder: '24 rue du Commerce, 69002 Lyon' },
      { key: 'objet_litige', label: 'Objet du litige', placeholder: 'Non-paiement de la facture F2026-0017', multiline: true },
      { key: 'montant_ou_obligation', label: 'Montant ou obligation', placeholder: '3 200 €' },
      { key: 'délai_réponse', label: 'Délai accordé (jours)', placeholder: '15' },
    ],
    prompt: `Rédige une lettre de mise en demeure formelle à {{nom_destinataire}} ({{adresse_destinataire}}) concernant : {{objet_litige}}. Montant ou obligation : {{montant_ou_obligation}}. Délai accordé : {{délai_réponse}} jours. Ton ferme mais légalement prudent.`,
  },
  {
    id: 'juridique-mes-droits',
    category: 'juridique',
    title: 'Comprendre mes droits dans une situation',
    description: 'Tes droits, recours possibles, nécessité d’un avocat — pratique et concret.',
    icon: '🧭',
    fields: [
      { key: 'situation_décrite', label: 'Décris la situation', placeholder: 'Décris en quelques lignes…', multiline: true },
      { key: 'pays', label: 'Pays', placeholder: 'France' },
    ],
    prompt: `Situation : {{situation_décrite}}. Pays : {{pays}}. Explique-moi mes droits et recours possibles en langage simple. Indique si je dois consulter un avocat ou si je peux gérer seul. Sois pratique et concret.`,
  },
  {
    id: 'juridique-mentions-legales',
    category: 'juridique',
    title: 'Rédiger des mentions légales site web',
    description: 'Mentions légales conformes au droit français : éditeur, hébergeur, RGPD, cookies.',
    icon: '🌐',
    fields: [
      { key: 'nom_entreprise', label: 'Nom de l’entreprise', placeholder: 'Atelier Bernard' },
      { key: 'siret', label: 'SIRET', placeholder: '123 456 789 00012' },
      { key: 'adresse', label: 'Adresse', placeholder: '5 rue de Paris, 75001 Paris' },
      { key: 'email_contact', label: 'Email de contact', placeholder: 'contact@exemple.fr' },
      { key: 'hébergeur', label: 'Hébergeur', placeholder: 'OVH SAS, 2 rue Kellermann, 59100 Roubaix' },
    ],
    prompt: `Rédige les mentions légales pour un site web professionnel. Éditeur : {{nom_entreprise}}, SIRET {{siret}}, {{adresse}}, contact : {{email_contact}}. Hébergeur : {{hébergeur}}. Conformes au droit français, couvrant : identité, hébergeur, RGPD, propriété intellectuelle, cookies.`,
  },

  // ─── Marketing ────────────────────────────────────────────────────────────
  {
    id: 'marketing-fiche-produit',
    category: 'marketing',
    title: 'Fiche produit ou service',
    description: 'Fiche persuasive : accroche, problème résolu, solution, bénéfices, CTA.',
    icon: '🛍️',
    fields: [
      { key: 'nom_produit', label: 'Nom du produit/service', placeholder: 'Coaching photo en ligne' },
      { key: 'public_cible', label: 'Public cible', placeholder: 'Indépendants qui veulent se mettre en avant' },
      { key: 'bénéfice_principal', label: 'Bénéfice principal', placeholder: 'Des photos pro en 1h sans matériel' },
      { key: 'caractéristiques', label: 'Caractéristiques', placeholder: '4 séances, replay, fichiers livrables', multiline: true },
      { key: 'prix', label: 'Prix', placeholder: '249 €' },
    ],
    prompt: `Rédige une fiche produit/service persuasive pour {{nom_produit}}, destinée à {{public_cible}}. Bénéfice principal : {{bénéfice_principal}}. Caractéristiques : {{caractéristiques}}. Prix : {{prix}}. Structure : accroche, problème résolu, solution, bénéfices, CTA.`,
  },
  {
    id: 'marketing-appel-offres',
    category: 'marketing',
    title: 'Réponse à un appel d’offres',
    description: 'Réponse synthétique 400 mots : solution, valeur ajoutée, références.',
    icon: '🎯',
    fields: [
      { key: 'nom_organisme', label: 'Nom de l’organisme', placeholder: 'Mairie de Lyon' },
      { key: 'objet_ao', label: 'Objet de l’appel d’offres', placeholder: 'Refonte du site associatif', multiline: true },
      { key: 'ma_solution', label: 'Ma solution', placeholder: 'Méthodologie, stack, planning…', multiline: true },
      { key: 'valeur_ajoutée', label: 'Valeur ajoutée', placeholder: 'Expérience secteur public, accessibilité' },
      { key: 'références', label: 'Références', placeholder: '2 mairies similaires, 1 département' },
    ],
    prompt: `Rédige une réponse synthétique à un appel d’offres de {{nom_organisme}} pour {{objet_ao}}. Ma solution : {{ma_solution}}. Valeur ajoutée : {{valeur_ajoutée}}. Références : {{références}}. Ton professionnel et confiant, 400 mots, structure claire.`,
  },
  {
    id: 'marketing-prospection-b2b',
    category: 'marketing',
    title: 'Email de prospection froide B2B',
    description: 'Cold email 150 mots max : hook fort, 1 seule question en CTA.',
    icon: '🎣',
    fields: [
      { key: 'secteur_cible', label: 'Secteur cible', placeholder: 'Cabinets d’avocats indépendants' },
      { key: 'problème_qu_on_résout', label: 'Problème résolu', placeholder: 'Trop de temps perdu sur la facturation' },
      { key: 'offre', label: 'Offre', placeholder: 'Audit + outil sur-mesure en 4 semaines' },
      { key: 'nom_expéditeur', label: 'Nom de l’expéditeur', placeholder: 'Florent Bernard' },
    ],
    prompt: `Rédige un email de prospection froide B2B pour le secteur {{secteur_cible}}. Problème résolu : {{problème_qu_on_résout}}. Offre : {{offre}}. Expéditeur : {{nom_expéditeur}}. Max 150 mots, hook fort, 1 seule question en CTA. Pas de pitch générique.`,
  },
  {
    id: 'marketing-analyse-concurrent',
    category: 'marketing',
    title: 'Analyse d’un concurrent',
    description: 'Positionnement résumé, 3 arguments de différenciation, gestion des objections.',
    icon: '🥊',
    fields: [
      { key: 'nom_concurrent', label: 'Nom du concurrent', placeholder: 'Studio Onyx' },
      { key: 'leurs_points_forts', label: 'Leurs points forts', placeholder: 'Marque connue, gros budgets', multiline: true },
      { key: 'leurs_points_faibles', label: 'Leurs points faibles', placeholder: 'Lents, peu de proximité', multiline: true },
      { key: 'ma_différence', label: 'Ma différenciation', placeholder: 'Petit studio, livraison rapide, suivi perso' },
    ],
    prompt: `Analyse ce concurrent : {{nom_concurrent}}. Points forts : {{leurs_points_forts}}. Points faibles : {{leurs_points_faibles}}. Ma différenciation : {{ma_différence}}. Fournis : positionnement résumé, 3 arguments pour me différencier, comment répondre si un prospect les mentionne.`,
  },

  // ─── Finances ─────────────────────────────────────────────────────────────
  {
    id: 'finances-analyse-depenses',
    category: 'finances',
    title: 'Analyser mes dépenses',
    description: 'Catégorisation, postes anormalement élevés, 3 pistes d’optimisation.',
    icon: '📊',
    fields: [
      { key: 'liste_dépenses', label: 'Liste des dépenses', placeholder: 'Collez la liste (montant, libellé)…', multiline: true },
      { key: 'période', label: 'Période', placeholder: 'mars 2026' },
      { key: 'activité', label: 'Activité', placeholder: 'Freelance design' },
    ],
    prompt: `Voici mes dépenses sur {{période}} pour mon activité {{activité}} :\n\n{{liste_dépenses}}\n\nCatégorise ces dépenses, identifie les postes anormalement élevés, et donne 3 pistes d’optimisation concrètes.`,
  },
  {
    id: 'finances-rentabilite-projet',
    category: 'finances',
    title: 'Calculer la rentabilité d’un projet',
    description: 'Marge brute, marge nette, taux horaire réel, est-ce rentable, comment améliorer.',
    icon: '🧮',
    fields: [
      { key: 'revenus_projet', label: 'Revenus du projet (€)', placeholder: '4500' },
      { key: 'coûts_matériaux', label: 'Coûts matériaux (€)', placeholder: '950' },
      { key: 'heures_passées', label: 'Heures passées', placeholder: '38' },
      { key: 'taux_horaire_cible', label: 'Taux horaire cible (€/h)', placeholder: '60' },
      { key: 'autres_charges', label: 'Autres charges (€)', placeholder: '120' },
    ],
    prompt: `Calcule la rentabilité de ce projet. Revenus : {{revenus_projet}}€. Coûts matériaux : {{coûts_matériaux}}€. Heures passées : {{heures_passées}}h. Taux horaire cible : {{taux_horaire_cible}}€/h. Autres charges : {{autres_charges}}€. Donne : marge brute, marge nette, taux horaire réel, est-ce rentable, comment améliorer.`,
  },
  {
    id: 'finances-bilan-fin-annee',
    category: 'finances',
    title: 'Préparer mon bilan de fin d’année',
    description: 'Points clés à préparer, optimisations fiscales légales, message au comptable.',
    icon: '🗓️',
    fields: [
      { key: 'revenus_annuels', label: 'Revenus annuels (€)', placeholder: '78000' },
      { key: 'charges_déductibles', label: 'Charges déductibles (€)', placeholder: '12500' },
      { key: 'statut_juridique', label: 'Statut juridique', placeholder: 'EURL à l’IS' },
      { key: 'objectif_fiscal', label: 'Objectif fiscal', placeholder: 'Réduire l’IS, anticiper 2027' },
    ],
    prompt: `J’ai {{revenus_annuels}}€ de revenus, {{charges_déductibles}}€ de charges déductibles. Statut : {{statut_juridique}}. Objectif : {{objectif_fiscal}}. Points clés à préparer avant la clôture, optimisations fiscales légales à envisager, ce que je dois communiquer à mon comptable.`,
  },
]

/**
 * Replace `{{field_key}}` placeholders in `prompt` with the user-provided
 * values. Empty values are left as a `[à compléter]` marker so the assistant
 * can flag the gap rather than silently producing a hallucinated answer.
 */
export function renderTemplatePrompt(template: Template, values: Record<string, string>): string {
  // Field keys may contain French characters (é, à, …) so we accept any
  // non-`}` character in the placeholder name rather than only `\w`.
  return template.prompt.replace(/\{\{([^}]+)\}\}/g, (_, rawKey: string) => {
    const key = rawKey.trim()
    const value = values[key]?.trim()
    return value && value.length > 0 ? value : '[à compléter]'
  })
}

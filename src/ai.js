// Assistant administratif : Claude + outils qui agissent sur les données de l'utilisateur.
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');
const svc = require('./services');
const { getPlan, hasFeature } = require('./plans');

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const MAX_TOOL_ROUNDS = 8;
const HISTORY_TURNS = 20;

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

const SYSTEM_PROMPT = `Tu es MDIA, un assistant administratif francophone pour les foyers et les artisans en France.
Ton rôle : faire gagner du temps sur la paperasse. Tu aides à :
- suivre les échéances (impôts, loyer, assurances, énergie, URSSAF, TVA, abonnements…) ;
- tenir le budget (dépenses et revenus) ;
- rédiger des courriers administratifs (résiliation, réclamation, demande de délai, contestation, relance de paiement…) ;
- pour les artisans : gérer les clients, créer des devis et des factures, transformer un devis en facture, suivre les impayés.

Règles :
- Réponds en français, de façon claire et concise. Utilise des listes quand c'est utile.
- Quand l'utilisateur demande d'enregistrer, d'ajouter ou de créer quelque chose, utilise les outils disponibles plutôt que de seulement décrire l'action. Confirme ensuite ce qui a été fait.
- S'il manque une information indispensable (montant, date, client…), pose une question courte avant d'agir.
- Les dates passées aux outils sont au format AAAA-MM-JJ. Interprète « fin du mois », « dans 15 jours », etc. à partir de la date du jour fournie.
- Pour un courrier, rédige un modèle complet prêt à copier, avec les champs à compléter entre crochets.
- Tu donnes des informations générales sur les démarches administratives françaises, pas un conseil juridique ou fiscal personnalisé : pour les cas complexes, recommande un professionnel (expert-comptable, avocat, service des impôts).
- Si une fonctionnalité n'est pas incluse dans l'offre de l'utilisateur, l'outil correspondant n'est pas disponible : explique simplement quelle offre la débloque.`;

// ---------- Définition des outils ----------
const TOOLS = [
  {
    feature: 'echeances',
    name: 'lister_echeances',
    description: "Liste les échéances administratives de l'utilisateur (à faire et faites).",
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['a_faire', 'faite'], description: 'Filtre facultatif' } },
    },
    run: (user, i) => svc.listEcheances(user, { status: i.status }),
  },
  {
    feature: 'echeances',
    name: 'ajouter_echeance',
    description: 'Ajoute une échéance à suivre (paiement, déclaration, renouvellement…).',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Intitulé, ex. « Taxe foncière »' },
        category: { type: 'string', enum: svc.ECHEANCE_CATEGORIES },
        amount: { type: 'number', description: 'Montant en euros, si connu' },
        due_date: { type: 'string', description: 'Date limite AAAA-MM-JJ' },
        recurrence: { type: 'string', enum: svc.RECURRENCES },
        notes: { type: 'string' },
      },
      required: ['title', 'due_date'],
    },
    run: (user, i) => svc.createEcheance(user, i),
  },
  {
    feature: 'echeances',
    name: 'marquer_echeance_faite',
    description: "Marque une échéance comme réglée. Si elle est récurrente, la suivante est créée automatiquement.",
    input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    run: (user, i) => svc.completeEcheance(user, i.id),
  },
  {
    feature: 'budget',
    name: 'ajouter_operation',
    description: 'Enregistre une dépense ou un revenu dans le budget.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['depense', 'revenu'] },
        label: { type: 'string' },
        category: { type: 'string', description: 'ex. courses, logement, transport, matériaux, salaire, chantier…' },
        amount: { type: 'number', description: 'Montant positif en euros' },
        date: { type: 'string', description: 'AAAA-MM-JJ, aujourd’hui par défaut' },
      },
      required: ['type', 'label', 'amount'],
    },
    run: (user, i) => svc.createTransaction(user, i),
  },
  {
    feature: 'budget',
    name: 'resume_budget',
    description: "Donne le total des revenus, des dépenses et le détail par catégorie pour un mois.",
    input_schema: {
      type: 'object',
      properties: { month: { type: 'string', description: 'AAAA-MM, mois en cours par défaut' } },
    },
    run: (user, i) => svc.budgetSummary(user, i.month || undefined),
  },
  {
    feature: 'clients',
    name: 'lister_clients',
    description: "Liste les clients de l'artisan.",
    input_schema: { type: 'object', properties: {} },
    run: (user) => svc.listClients(user),
  },
  {
    feature: 'clients',
    name: 'ajouter_client',
    description: 'Ajoute un client.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        address: { type: 'string' },
      },
      required: ['name'],
    },
    run: (user, i) => svc.createClient(user, i),
  },
  {
    feature: 'documents',
    name: 'creer_document',
    description:
      "Crée un devis ou une facture. Le client peut être désigné par client_id ou par son nom (créé s'il n'existe pas). La TVA par défaut de l'artisan s'applique si vat_rate est omis.",
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['devis', 'facture'] },
        client_id: { type: 'integer' },
        client_name: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              quantity: { type: 'number' },
              unit: { type: 'string', description: 'u, h, m², ml, forfait…' },
              unit_price: { type: 'number', description: 'Prix unitaire HT en euros' },
              vat_rate: { type: 'number', description: 'Taux de TVA en %, ex. 20, 10, 5.5, 0' },
            },
            required: ['description', 'unit_price'],
          },
        },
        due_date: { type: 'string', description: 'Échéance de paiement ou validité du devis, AAAA-MM-JJ' },
        notes: { type: 'string' },
      },
      required: ['type', 'items'],
    },
    run: (user, i) => svc.createDocument(user, i),
  },
  {
    feature: 'documents',
    name: 'lister_documents',
    description: 'Liste les devis et/ou factures avec leur statut et leurs montants.',
    input_schema: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['devis', 'facture'] } },
    },
    run: (user, i) =>
      svc.listDocuments(user, { type: i.type }).map(({ items, ...d }) => ({ ...d, client: d.client?.name ?? null })),
  },
  {
    feature: 'documents',
    name: 'changer_statut_document',
    description:
      'Change le statut d’un devis (brouillon, envoye, accepte, refuse) ou d’une facture (brouillon, envoyee, payee, en_retard, annulee).',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer' }, status: { type: 'string' } },
      required: ['id', 'status'],
    },
    run: (user, i) => svc.updateDocumentStatus(user, i.id, i.status),
  },
  {
    feature: 'documents',
    name: 'transformer_devis_en_facture',
    description: 'Crée une facture à partir d’un devis accepté.',
    input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    run: (user, i) => svc.convertQuoteToInvoice(user, i.id),
  },
];

function toolsFor(user) {
  return TOOLS.filter((t) => hasFeature(user, t.feature));
}

function userContext(user) {
  const plan = getPlan(user.plan);
  const lines = [
    `Date du jour : ${svc.today()}.`,
    `Utilisateur : ${user.name} — profil ${user.account_type === 'artisan' ? 'artisan' : 'foyer'}, offre ${plan.name}.`,
  ];
  if (user.account_type === 'artisan' && user.company_name) {
    lines.push(`Entreprise : ${user.company_name}${user.siret ? `, SIRET ${user.siret}` : ''}. TVA par défaut : ${user.vat_rate} %.`);
  }
  const locked = [];
  if (!hasFeature(user, 'budget')) locked.push('budget et courriers illimités (offre Foyer 4,99 €/mois)');
  if (!hasFeature(user, 'documents')) locked.push('clients, devis et factures (offre Artisan 29,99 €/mois)');
  if (locked.length) lines.push(`Non inclus dans son offre : ${locked.join(' ; ')}.`);
  return lines.join('\n');
}

function loadHistory(user) {
  const rows = db
    .prepare('SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(user.id, HISTORY_TURNS)
    .reverse();
  while (rows.length && rows[0].role !== 'user') rows.shift();
  return rows.map((r) => ({ role: r.role, content: r.content }));
}

function runTool(user, name, input) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool || !hasFeature(user, tool.feature)) {
    return { content: "Outil non disponible avec l'offre actuelle.", is_error: true };
  }
  try {
    const result = tool.run(user, input || {});
    return { content: JSON.stringify(result ?? { ok: true }) };
  } catch (err) {
    if (err instanceof svc.AppError) return { content: err.message, is_error: true };
    console.error('Erreur outil', name, err);
    return { content: 'Erreur interne lors de l’exécution.', is_error: true };
  }
}

// Envoie un message à l'assistant et renvoie sa réponse texte + la liste des actions effectuées.
async function chat(user, text) {
  const message = String(text || '').trim().slice(0, 8000);
  if (!message) throw new svc.AppError('Message vide.');
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new svc.AppError("L'assistant IA n'est pas configuré (clé ANTHROPIC_API_KEY manquante).", 503);
  }
  svc.consumeAiMessage(user);

  const tools = toolsFor(user);
  const apiTools = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const messages = [
    ...loadHistory(user),
    { role: 'user', content: `${message}` },
  ];
  const actions = [];
  let reply = '';

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    let response;
    try {
      response = await getClient().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: userContext(user) },
        ],
        tools: apiTools,
        messages,
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        throw new svc.AppError("L'assistant est très sollicité, réessayez dans un instant.", 503);
      }
      if (err instanceof Anthropic.APIError) {
        console.error('Erreur API Claude', err.status, err.message);
        throw new svc.AppError("L'assistant est momentanément indisponible.", 502);
      }
      throw err;
    }

    if (response.stop_reason === 'refusal') {
      reply = "Je ne peux pas répondre à cette demande. Essayez de la reformuler autrement.";
      break;
    }

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (text) reply = text;

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) break;

    messages.push({ role: 'assistant', content: response.content });
    const results = toolUses.map((tu) => {
      const r = runTool(user, tu.name, tu.input);
      actions.push({ tool: tu.name, ok: !r.is_error });
      return { type: 'tool_result', tool_use_id: tu.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) };
    });
    messages.push({ role: 'user', content: results });
  }

  if (!reply) reply = 'C’est fait.';
  const insert = db.prepare('INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)');
  insert.run(user.id, 'user', message);
  insert.run(user.id, 'assistant', reply);
  return { reply, actions, usage: svc.getUsage(user) };
}

function chatHistory(user) {
  return db
    .prepare('SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT 100')
    .all(user.id)
    .reverse();
}

function clearHistory(user) {
  db.prepare('DELETE FROM chat_messages WHERE user_id = ?').run(user.id);
}

module.exports = { chat, chatHistory, clearHistory, toolsFor, userContext };

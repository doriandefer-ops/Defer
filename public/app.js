// Espace client MDIA — application monopage sans framework.
const state = { me: null, plans: [] };
const view = document.getElementById('view');

// ---------- Utilitaires ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const eur = (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }));
const frDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('fr-FR') : '—');
const todayIso = () => new Date().toISOString().slice(0, 10);
const has = (feature) => state.me?.plan.features.includes(feature);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    location.href = '/connexion';
    throw new Error('Non connecté');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur inattendue.');
  return data;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function attempt(fn) {
  try {
    await fn();
  } catch (err) {
    toast(err.message);
  }
}

// Mini rendu Markdown (gras, listes, titres, code) appliqué à du texte déjà échappé.
function md(text) {
  const blocks = esc(text).split(/```/);
  return blocks
    .map((chunk, i) => {
      if (i % 2 === 1) return `<pre>${chunk.replace(/^\w*\n/, '')}</pre>`;
      const lines = chunk.split('\n');
      let html = '';
      let list = null;
      const close = () => {
        if (list) html += `</${list}>`;
        list = null;
      };
      for (const raw of lines) {
        const line = raw
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
          .replace(/`([^`]+)`/g, '<code>$1</code>');
        let m;
        if ((m = line.match(/^\s*[-•*]\s+(.*)/))) {
          if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; }
          html += `<li>${m[1]}</li>`;
        } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
          if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; }
          html += `<li>${m[1]}</li>`;
        } else if ((m = line.match(/^#{1,4}\s+(.*)/))) {
          close();
          html += `<p><strong>${m[1]}</strong></p>`;
        } else if (line.trim() === '') {
          close();
        } else {
          close();
          html += `<p>${line}</p>`;
        }
      }
      close();
      return html;
    })
    .join('');
}

function upsell(feature) {
  const artisan = feature === 'clients' || feature === 'documents';
  return `<div class="upsell">
    <h3>${artisan ? 'Réservé à l’offre Artisan' : 'Disponible avec les offres Foyer et Artisan'}</h3>
    <p class="muted">${artisan
      ? 'Créez vos devis et factures en une phrase, gérez vos clients et suivez vos impayés pour 29,99 € / mois.'
      : 'Suivez votre budget, sans limite d’échéances, à partir de 4,99 € / mois.'}</p>
    <a class="btn btn-primary" href="#abonnement">Voir les offres</a>
  </div>`;
}

// ---------- Navigation ----------
const ROUTES = [
  { id: 'tableau-de-bord', label: 'Tableau de bord', icon: '🏠', render: renderDashboard },
  { id: 'assistant', label: 'Assistant IA', icon: '💬', render: renderAssistant },
  { id: 'echeances', label: 'Échéances', icon: '⏰', render: renderEcheances, feature: 'echeances' },
  { id: 'budget', label: 'Budget', icon: '💶', render: renderBudget, feature: 'budget' },
  { id: 'clients', label: 'Clients', icon: '👥', render: renderClients, feature: 'clients', artisanOnly: true },
  { id: 'documents', label: 'Devis & factures', icon: '🧾', render: renderDocuments, feature: 'documents', artisanOnly: true },
  { id: 'abonnement', label: 'Abonnement', icon: '⭐', render: renderBilling },
  { id: 'parametres', label: 'Paramètres', icon: '⚙️', render: renderSettings },
];

function currentRoute() {
  const [hash, query] = location.hash.slice(1).split('?');
  return { route: ROUTES.find((r) => r.id === hash) || ROUTES[0], query: new URLSearchParams(query || '') };
}

function renderNav() {
  const { route } = currentRoute();
  const isArtisan = state.me.user.accountType === 'artisan';
  document.getElementById('nav').innerHTML = ROUTES.filter((r) => !r.artisanOnly || isArtisan || has(r.feature))
    .map((r) => {
      const locked = r.feature && !has(r.feature);
      return `<a class="nav-item ${r === route ? 'active' : ''} ${locked ? 'locked' : ''}" href="#${r.id}">
        <span>${r.icon}</span><span>${r.label}</span>${locked ? '<span class="small">🔒</span>' : ''}</a>`;
    })
    .join('');
  const { usage, plan } = state.me;
  const pct = Math.min(100, Math.round((usage.used / usage.limit) * 100));
  document.getElementById('plan-box').innerHTML = `
    <div><strong>Offre ${esc(plan.name)}</strong></div>
    <div class="meter"><span style="width:${pct}%"></span></div>
    <div class="muted">${usage.used} / ${usage.limit} messages IA ce mois</div>
    ${plan.id !== 'artisan' ? '<a href="#abonnement" class="small">Passer à une offre supérieure →</a>' : ''}`;
}

async function refreshMe() {
  state.me = await api('/me');
  renderNav();
}

// Les rendus sont enchaînés : une page lente à charger ne peut pas écraser celle demandée ensuite.
let routing = Promise.resolve();
function router() {
  routing = routing.then(async () => {
    document.getElementById('sidebar').classList.remove('open');
    renderNav();
    const { route, query } = currentRoute();
    view.innerHTML = '<p class="muted">Chargement…</p>';
    await attempt(() => route.render(query));
  });
  return routing;
}

// ---------- Tableau de bord ----------
async function renderDashboard() {
  const d = await api('/dashboard');
  const u = state.me.user;
  const stats = [];
  if (d.facturation) {
    stats.push(['Chiffre d’affaires encaissé (année, HT)', eur(d.facturation.chiffreAffairesAnnuel)]);
    stats.push(['Factures impayées', `${d.facturation.impayees} · ${eur(d.facturation.montantImpaye)}`]);
    stats.push(['Devis en attente de réponse', d.facturation.devisEnAttente]);
  }
  if (d.budget) stats.push(['Solde du mois', eur(d.budget.solde)]);
  stats.push(['Échéances en retard', d.echeancesEnRetard]);

  view.innerHTML = `
    <div class="main-header"><h1>Bonjour ${esc(u.name.split(' ')[0])} 👋</h1>
      <a class="btn btn-primary" href="#assistant">💬 Demander à l’assistant</a></div>
    <div class="stats">${stats.map(([l, v]) => `<div class="card stat"><div class="label">${l}</div><div class="value">${esc(v)}</div></div>`).join('')}</div>
    <div class="two-col">
      <div class="card">
        <h2>Échéances des 30 prochains jours</h2>
        ${d.echeancesAVenir.length ? `<div class="table-wrap"><table><tbody>${d.echeancesAVenir.map((e) => `
          <tr><td>${esc(e.title)}</td><td>${e.due_date < todayIso() ? `<span class="badge badge-warn">En retard · ${frDate(e.due_date)}</span>` : frDate(e.due_date)}</td><td class="num">${eur(e.amount)}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="empty">Aucune échéance à venir. 🎉</p>'}
        <a href="#echeances" class="small">Toutes les échéances →</a>
      </div>
      <div class="card">
        <h2>Que puis-je faire pour vous ?</h2>
        <p class="muted">Quelques exemples à demander à l’assistant :</p>
        <ul>
          ${u.accountType === 'artisan'
            ? '<li>« Fais une facture pour M. Durand : remplacement chauffe-eau 850 € HT »</li><li>« Quelles factures ne sont pas encore payées ? »</li><li>« Rédige une relance polie pour une facture en retard »</li>'
            : '<li>« Rappelle-moi de renouveler l’assurance auto le 3 mars »</li><li>« J’ai dépensé 86 € de courses aujourd’hui »</li><li>« Écris une lettre de résiliation pour ma box internet »</li>'}
        </ul>
      </div>
    </div>`;
}

// ---------- Assistant ----------
const SUGGESTIONS = {
  artisan: [
    'Crée un devis pour Mme Martin : pose de 12 m² de carrelage à 45 €/m²',
    'Quelles factures sont impayées ?',
    'Ajoute l’échéance URSSAF du trimestre au 31 du mois',
    'Rédige une relance pour une facture en retard de 15 jours',
  ],
  foyer: [
    'Rappelle-moi de payer la taxe foncière le 15 octobre, 1 240 €',
    'J’ai dépensé 86 € de courses aujourd’hui',
    'Écris une lettre de résiliation pour mon abonnement de salle de sport',
    'Quelles sont mes prochaines échéances ?',
  ],
};
const ACTION_LABELS = {
  ajouter_echeance: 'échéance ajoutée',
  marquer_echeance_faite: 'échéance réglée',
  ajouter_operation: 'opération enregistrée',
  ajouter_client: 'client ajouté',
  creer_document: 'document créé',
  changer_statut_document: 'statut modifié',
  transformer_devis_en_facture: 'facture créée',
};

async function renderAssistant() {
  const { messages, usage } = await api('/chat');
  const sugg = SUGGESTIONS[state.me.user.accountType] || SUGGESTIONS.foyer;
  view.innerHTML = `
    <div class="main-header"><h1>Assistant IA</h1>
      <div><span class="muted small" id="usage">${usage.used} / ${usage.limit} messages ce mois</span>
      <button class="btn btn-small" id="clear">Effacer la conversation</button></div></div>
    <div class="card chat">
      <div class="chat-log" id="log"></div>
      <div class="suggestions" id="sugg">${sugg.map((s) => `<button class="btn btn-small" type="button">${esc(s)}</button>`).join('')}</div>
      <form class="chat-form" id="chat-form">
        <textarea id="input" rows="1" placeholder="Demandez quelque chose… (Entrée pour envoyer)" aria-label="Message"></textarea>
        <button class="btn btn-primary" type="submit" id="send">Envoyer</button>
      </form>
    </div>`;
  const log = document.getElementById('log');
  const input = document.getElementById('input');
  const addBubble = (role, content, actions = []) => {
    const div = document.createElement('div');
    div.className = `bubble ${role}`;
    div.innerHTML = role === 'assistant' ? md(content) : esc(content);
    log.appendChild(div);
    const done = actions.filter((a) => a.ok && ACTION_LABELS[a.tool]);
    if (done.length) {
      const note = document.createElement('div');
      note.className = 'actions-note';
      note.textContent = `✓ ${done.map((a) => ACTION_LABELS[a.tool]).join(' · ')}`;
      log.appendChild(note);
    }
    log.scrollTop = log.scrollHeight;
    return div;
  };
  if (!messages.length) {
    addBubble('assistant', `Bonjour ! Je suis votre assistant administratif. Dites-moi ce que vous voulez faire, je m’en occupe.`);
  }
  messages.forEach((m) => addBubble(m.role, m.content));
  document.getElementById('sugg').classList.toggle('hidden', messages.length > 0);

  const send = async (text) => {
    if (!text.trim()) return;
    document.getElementById('sugg').classList.add('hidden');
    addBubble('user', text);
    input.value = '';
    const typing = addBubble('assistant', '');
    typing.innerHTML = '<span class="typing">L’assistant réfléchit…</span>';
    document.getElementById('send').disabled = true;
    try {
      const res = await api('/chat', { method: 'POST', body: { message: text } });
      typing.remove();
      addBubble('assistant', res.reply, res.actions);
      document.getElementById('usage').textContent = `${res.usage.used} / ${res.usage.limit} messages ce mois`;
      state.me.usage = res.usage;
      renderNav();
    } catch (err) {
      typing.innerHTML = `<span class="error">${esc(err.message)}</span>`;
    } finally {
      document.getElementById('send').disabled = false;
      input.focus();
    }
  };
  document.getElementById('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    send(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input.value);
    }
  });
  document.querySelectorAll('#sugg button').forEach((b) => b.addEventListener('click', () => send(b.textContent)));
  document.getElementById('clear').addEventListener('click', () =>
    attempt(async () => {
      if (!confirm('Effacer tout l’historique de conversation ?')) return;
      await api('/chat', { method: 'DELETE' });
      router();
    }),
  );
  input.focus();
}

// ---------- Échéances ----------
const CATEGORIES = {
  impots: 'Impôts', loyer: 'Loyer / crédit', energie: 'Énergie', assurance: 'Assurance', banque: 'Banque',
  sante: 'Santé', abonnement: 'Abonnement', vehicule: 'Véhicule', urssaf: 'URSSAF', tva: 'TVA',
  fournisseur: 'Fournisseur', autre: 'Autre',
};
const RECURRENCE_LABELS = { aucune: 'Ponctuelle', mensuelle: 'Mensuelle', trimestrielle: 'Trimestrielle', annuelle: 'Annuelle' };

async function renderEcheances() {
  const { echeances } = await api('/echeances');
  const limit = state.me.plan.limits.echeances;
  const todo = echeances.filter((e) => e.status === 'a_faire');
  const done = echeances.filter((e) => e.status === 'faite').slice(0, 20);
  view.innerHTML = `
    <div class="main-header"><h1>Échéances</h1>${limit ? `<span class="muted small">${echeances.length} / ${limit} avec l’offre Gratuit</span>` : ''}</div>
    <div class="stack">
      <form class="card" id="form">
        <h2>Ajouter une échéance</h2>
        <div class="row">
          <div class="field"><label>Intitulé</label><input name="title" required placeholder="Ex. Taxe foncière"></div>
          <div class="field"><label>Date limite</label><input name="due_date" type="date" required></div>
          <div class="field"><label>Montant (€)</label><input name="amount" type="number" step="0.01" min="0"></div>
          <div class="field"><label>Catégorie</label><select name="category">${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <div class="field"><label>Récurrence</label><select name="recurrence">${Object.entries(RECURRENCE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        </div>
        <button class="btn btn-primary" type="submit">Ajouter</button>
      </form>
      <div class="card"><h2>À faire</h2>${echeancesTable(todo, true)}</div>
      ${done.length ? `<div class="card"><h2>Réglées récemment</h2>${echeancesTable(done, false)}</div>` : ''}
    </div>`;
  document.getElementById('form').addEventListener('submit', (e) =>
    attempt(async () => {
      e.preventDefault();
      await api('/echeances', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      toast('Échéance ajoutée');
      router();
    }),
  );
  view.querySelectorAll('[data-done]').forEach((b) =>
    b.addEventListener('click', () =>
      attempt(async () => {
        const r = await api(`/echeances/${b.dataset.done}/faite`, { method: 'POST', body: {} });
        toast(r.next ? `Réglée. Prochaine échéance le ${frDate(r.next.due_date)}` : 'Échéance réglée');
        router();
      }),
    ),
  );
  view.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () =>
      attempt(async () => {
        if (!confirm('Supprimer cette échéance ?')) return;
        await api(`/echeances/${b.dataset.del}`, { method: 'DELETE' });
        router();
      }),
    ),
  );
}

function echeancesTable(rows, actionable) {
  if (!rows.length) return '<p class="empty">Rien pour le moment.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Intitulé</th><th>Catégorie</th><th>Date</th><th>Récurrence</th><th class="num">Montant</th><th></th></tr></thead>
    <tbody>${rows.map((e) => `<tr>
      <td>${esc(e.title)}</td>
      <td><span class="badge">${CATEGORIES[e.category] || esc(e.category)}</span></td>
      <td>${actionable && e.due_date < todayIso() ? `<span class="badge badge-warn">${frDate(e.due_date)}</span>` : frDate(e.due_date)}</td>
      <td>${RECURRENCE_LABELS[e.recurrence] || ''}</td>
      <td class="num">${eur(e.amount)}</td>
      <td class="actions">${actionable ? `<button class="btn btn-small" data-done="${e.id}">✓ Réglée</button>` : ''}
        <button class="btn btn-small btn-danger" data-del="${e.id}" aria-label="Supprimer">✕</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}

// ---------- Budget ----------
async function renderBudget(query) {
  if (!has('budget')) {
    view.innerHTML = `<div class="main-header"><h1>Budget</h1></div>${upsell('budget')}`;
    return;
  }
  const month = query.get('mois') || todayIso().slice(0, 7);
  const { transactions, summary } = await api(`/transactions?month=${month}`);
  view.innerHTML = `
    <div class="main-header"><h1>Budget</h1><input type="month" id="month" value="${month}" style="width:auto"></div>
    <div class="stats">
      <div class="card stat"><div class="label">Revenus</div><div class="value">${eur(summary.revenus)}</div></div>
      <div class="card stat"><div class="label">Dépenses</div><div class="value">${eur(summary.depenses)}</div></div>
      <div class="card stat"><div class="label">Solde</div><div class="value">${eur(summary.solde)}</div></div>
    </div>
    <div class="two-col">
      <form class="card" id="form">
        <h2>Nouvelle opération</h2>
        <div class="choice">
          <input type="radio" name="type" id="ty-d" value="depense" checked><label for="ty-d">Dépense</label>
          <input type="radio" name="type" id="ty-r" value="revenu"><label for="ty-r">Revenu</label>
        </div>
        <div class="field"><label>Libellé</label><input name="label" required></div>
        <div class="row">
          <div class="field"><label>Montant (€)</label><input name="amount" type="number" step="0.01" min="0.01" required></div>
          <div class="field"><label>Catégorie</label><input name="category" list="cats" placeholder="courses, logement…"></div>
          <div class="field"><label>Date</label><input name="date" type="date" value="${todayIso()}"></div>
        </div>
        <datalist id="cats">${['courses', 'logement', 'transport', 'énergie', 'santé', 'loisirs', 'matériaux', 'outillage', 'carburant', 'salaire', 'chantier', 'autre'].map((c) => `<option value="${c}">`).join('')}</datalist>
        <button class="btn btn-primary" type="submit">Enregistrer</button>
      </form>
      <div class="card">
        <h2>Par catégorie</h2>
        ${summary.parCategorie.length ? `<table><tbody>${summary.parCategorie.map((c) => `<tr><td>${c.type === 'revenu' ? '➕' : '➖'} ${esc(c.category)}</td><td class="num">${eur(c.total)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Aucune opération ce mois-ci.</p>'}
      </div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Opérations</h2>
      ${transactions.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Libellé</th><th>Catégorie</th><th class="num">Montant</th><th></th></tr></thead><tbody>
      ${transactions.map((t) => `<tr><td>${frDate(t.date)}</td><td>${esc(t.label)}</td><td>${esc(t.category)}</td>
        <td class="num" style="color:${t.type === 'revenu' ? 'var(--ok)' : 'inherit'}">${t.type === 'revenu' ? '+' : '−'}${eur(t.amount)}</td>
        <td class="actions"><button class="btn btn-small btn-danger" data-del="${t.id}" aria-label="Supprimer">✕</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">Aucune opération.</p>'}
    </div>`;
  document.getElementById('month').addEventListener('change', (e) => (location.hash = `budget?mois=${e.target.value}`));
  document.getElementById('form').addEventListener('submit', (e) =>
    attempt(async () => {
      e.preventDefault();
      await api('/transactions', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      toast('Opération enregistrée');
      router();
    }),
  );
  view.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () =>
      attempt(async () => {
        await api(`/transactions/${b.dataset.del}`, { method: 'DELETE' });
        router();
      }),
    ),
  );
}

// ---------- Clients ----------
async function renderClients() {
  if (!has('clients')) {
    view.innerHTML = `<div class="main-header"><h1>Clients</h1></div>${upsell('clients')}`;
    return;
  }
  const { clients } = await api('/clients');
  view.innerHTML = `
    <div class="main-header"><h1>Clients</h1></div>
    <div class="stack">
      <form class="card" id="form"><h2>Nouveau client</h2>
        <div class="row">
          <div class="field"><label>Nom</label><input name="name" required></div>
          <div class="field"><label>Email</label><input name="email" type="email"></div>
          <div class="field"><label>Téléphone</label><input name="phone"></div>
        </div>
        <div class="field"><label>Adresse</label><input name="address"></div>
        <button class="btn btn-primary" type="submit">Ajouter</button>
      </form>
      <div class="card">
        ${clients.length ? `<div class="table-wrap"><table><thead><tr><th>Nom</th><th>Email</th><th>Téléphone</th><th>Adresse</th><th></th></tr></thead><tbody>
        ${clients.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.email || '')}</td><td>${esc(c.phone || '')}</td><td>${esc(c.address || '')}</td>
          <td class="actions"><button class="btn btn-small btn-danger" data-del="${c.id}" aria-label="Supprimer">✕</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">Aucun client pour l’instant.</p>'}
      </div>
    </div>`;
  document.getElementById('form').addEventListener('submit', (e) =>
    attempt(async () => {
      e.preventDefault();
      await api('/clients', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      toast('Client ajouté');
      router();
    }),
  );
  view.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () =>
      attempt(async () => {
        if (!confirm('Supprimer ce client ?')) return;
        await api(`/clients/${b.dataset.del}`, { method: 'DELETE' });
        router();
      }),
    ),
  );
}

// ---------- Devis & factures ----------
const STATUS_LABELS = {
  brouillon: 'Brouillon', envoye: 'Envoyé', accepte: 'Accepté', refuse: 'Refusé',
  envoyee: 'Envoyée', payee: 'Payée', en_retard: 'En retard', annulee: 'Annulée',
};
const STATUSES = { devis: ['brouillon', 'envoye', 'accepte', 'refuse'], facture: ['brouillon', 'envoyee', 'payee', 'en_retard', 'annulee'] };

async function renderDocuments(query) {
  if (!has('documents')) {
    view.innerHTML = `<div class="main-header"><h1>Devis & factures</h1></div>${upsell('documents')}`;
    return;
  }
  const type = query.get('type') === 'facture' ? 'facture' : 'devis';
  const [{ documents }, { clients }] = await Promise.all([api(`/documents?type=${type}`), api('/clients')]);
  const vat = state.me.user.vatRate;
  view.innerHTML = `
    <div class="main-header"><h1>Devis & factures</h1>
      <div><a class="btn btn-small ${type === 'devis' ? 'btn-primary' : ''}" href="#documents?type=devis">Devis</a>
      <a class="btn btn-small ${type === 'facture' ? 'btn-primary' : ''}" href="#documents?type=facture">Factures</a></div></div>
    <div class="stack">
      <details class="card"><summary><strong>＋ Nouveau ${type === 'devis' ? 'devis' : 'facture'}</strong> <span class="muted small">(ou demandez-le simplement à l’assistant)</span></summary>
        <form id="form" style="margin-top:16px">
          <div class="row">
            <div class="field"><label>Client existant</label><select name="client_id"><option value="">— Choisir —</option>${clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
            <div class="field"><label>… ou nouveau client</label><input name="client_name" placeholder="Nom du client"></div>
            <div class="field"><label>${type === 'devis' ? 'Valable jusqu’au' : 'À payer avant le'}</label><input name="due_date" type="date"></div>
          </div>
          <div class="table-wrap"><table class="lines-table"><thead><tr><th>Description</th><th>Qté</th><th>Unité</th><th>Prix HT</th><th>TVA %</th><th></th></tr></thead><tbody id="lines"></tbody></table></div>
          <button class="btn btn-small" type="button" id="add-line" style="margin:8px 0 16px">＋ Ajouter une ligne</button>
          <div class="field"><label>Notes / conditions</label><textarea name="notes" rows="2"></textarea></div>
          <button class="btn btn-primary" type="submit">Créer</button>
        </form>
      </details>
      <div class="card">
        ${documents.length ? `<div class="table-wrap"><table><thead><tr><th>N°</th><th>Client</th><th>Date</th><th>Statut</th><th class="num">Total TTC</th><th></th></tr></thead><tbody>
        ${documents.map((d) => `<tr>
          <td><a href="/document?id=${d.id}" target="_blank">${esc(d.number)}</a></td>
          <td>${esc(d.client?.name || '—')}</td>
          <td>${frDate(d.issue_date)}</td>
          <td><select data-status="${d.id}" style="width:auto">${STATUSES[d.type].map((s) => `<option value="${s}" ${s === d.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select></td>
          <td class="num">${eur(d.total_ttc)}</td>
          <td class="actions">
            <a class="btn btn-small" href="/document?id=${d.id}" target="_blank">PDF</a>
            ${d.type === 'devis' ? `<button class="btn btn-small" data-convert="${d.id}">→ Facture</button>` : ''}
            <button class="btn btn-small btn-danger" data-del="${d.id}" aria-label="Supprimer">✕</button>
          </td></tr>`).join('')}
        </tbody></table></div>` : `<p class="empty">Aucun ${type === 'devis' ? 'devis' : 'facture'} pour l’instant.</p>`}
      </div>
    </div>`;

  const lines = document.getElementById('lines');
  const addLine = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input data-k="description" required></td><td><input data-k="quantity" type="number" step="0.01" value="1"></td>
      <td><input data-k="unit" value="u" style="width:70px"></td><td><input data-k="unit_price" type="number" step="0.01" required></td>
      <td><input data-k="vat_rate" type="number" step="0.1" value="${vat}" style="width:80px"></td>
      <td><button type="button" class="btn btn-small btn-danger" aria-label="Retirer">✕</button></td>`;
    tr.querySelector('button').addEventListener('click', () => tr.remove());
    lines.appendChild(tr);
  };
  addLine();
  document.getElementById('add-line').addEventListener('click', addLine);
  document.getElementById('form').addEventListener('submit', (e) =>
    attempt(async () => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      body.type = type;
      body.items = [...lines.querySelectorAll('tr')].map((tr) =>
        Object.fromEntries([...tr.querySelectorAll('input')].map((i) => [i.dataset.k, i.value])),
      );
      const { document: doc } = await api('/documents', { method: 'POST', body });
      toast(`${doc.number} créé`);
      router();
    }),
  );
  view.querySelectorAll('[data-status]').forEach((s) =>
    s.addEventListener('change', () =>
      attempt(async () => {
        await api(`/documents/${s.dataset.status}/statut`, { method: 'POST', body: { status: s.value } });
        toast('Statut mis à jour');
      }),
    ),
  );
  view.querySelectorAll('[data-convert]').forEach((b) =>
    b.addEventListener('click', () =>
      attempt(async () => {
        const { document: doc } = await api(`/documents/${b.dataset.convert}/facturer`, { method: 'POST', body: {} });
        toast(`Facture ${doc.number} créée`);
        location.hash = 'documents?type=facture';
      }),
    ),
  );
  view.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () =>
      attempt(async () => {
        if (!confirm('Supprimer ce document ?')) return;
        await api(`/documents/${b.dataset.del}`, { method: 'DELETE' });
        router();
      }),
    ),
  );
}

// ---------- Abonnement ----------
const PLAN_FEATURES = {
  gratuit: ['10 messages IA / mois', '5 échéances'],
  foyer: ['300 messages IA / mois', 'Échéances illimitées', 'Budget du foyer', 'Courriers administratifs'],
  artisan: ['2 000 messages IA / mois', 'Devis & factures illimités', 'Fichier clients', 'Suivi des impayés', 'Budget & courriers'],
};

async function renderBilling(query) {
  await refreshMe();
  const { plans, demoBilling } = await api('/plans');
  const current = state.me.plan.id;
  view.innerHTML = `
    <div class="main-header"><h1>Abonnement</h1></div>
    ${query.get('paiement') === 'ok' ? '<div class="card" style="margin-bottom:16px">✅ Merci ! Votre abonnement est actif.</div>' : ''}
    ${demoBilling ? '<p class="muted small">Mode démonstration : aucun paiement n’est demandé, le changement d’offre est immédiat.</p>' : ''}
    <div class="pricing">${plans.map((p) => `
      <div class="card price-card ${p.id === current ? 'featured' : ''}">
        <h3>${esc(p.name)} ${p.id === current ? '<span class="badge badge-ok">Offre actuelle</span>' : ''}</h3>
        <div class="price">${esc(p.priceLabel)}</div>
        <p class="muted small">${esc(p.tagline)}</p>
        <ul>${PLAN_FEATURES[p.id].map((f) => `<li>${f}</li>`).join('')}</ul>
        ${p.id === current ? '' : p.id === 'gratuit'
          ? '<button class="btn btn-block" data-portal>Revenir à l’offre gratuite</button>'
          : `<button class="btn btn-primary btn-block" data-plan="${p.id}">Choisir ${esc(p.name)}</button>`}
      </div>`).join('')}
    </div>
    ${current !== 'gratuit' && !demoBilling ? '<p style="margin-top:16px"><button class="btn" data-portal>Gérer mon abonnement et mes factures</button></p>' : ''}`;
  view.querySelectorAll('[data-plan]').forEach((b) =>
    b.addEventListener('click', () =>
      attempt(async () => {
        b.disabled = true;
        const r = await api('/billing/checkout', { method: 'POST', body: { plan: b.dataset.plan } });
        if (r.url) return (location.href = r.url);
        toast('Offre mise à jour');
        router();
      }).finally(() => (b.disabled = false)),
    ),
  );
  view.querySelectorAll('[data-portal]').forEach((b) =>
    b.addEventListener('click', () =>
      attempt(async () => {
        if (demoBilling && !confirm('Revenir à l’offre gratuite ? Vos données sont conservées.')) return;
        const r = await api('/billing/portal', { method: 'POST', body: {} });
        if (r.url) return (location.href = r.url);
        toast('Vous êtes revenu à l’offre gratuite');
        router();
      }),
    ),
  );
}

// ---------- Paramètres ----------
async function renderSettings() {
  const u = state.me.user;
  const artisan = u.accountType === 'artisan';
  view.innerHTML = `
    <div class="main-header"><h1>Paramètres</h1></div>
    <form class="card" id="form" style="max-width:640px">
      <div class="field"><label>Nom</label><input name="name" value="${esc(u.name)}" required></div>
      <div class="field"><label>Email</label><input value="${esc(u.email)}" disabled></div>
      ${artisan ? `
        <h2 style="margin-top:24px">Informations de l’entreprise</h2>
        <p class="muted small">Elles apparaissent sur vos devis et factures.</p>
        <div class="field"><label>Raison sociale</label><input name="companyName" value="${esc(u.companyName || '')}"></div>
        <div class="row">
          <div class="field"><label>SIRET</label><input name="siret" value="${esc(u.siret || '')}"></div>
          <div class="field"><label>Téléphone</label><input name="phone" value="${esc(u.phone || '')}"></div>
          <div class="field"><label>TVA par défaut (%)</label><input name="vatRate" type="number" step="0.1" min="0" max="100" value="${u.vatRate}"></div>
        </div>
        <div class="field"><label>Adresse</label><textarea name="address" rows="2">${esc(u.address || '')}</textarea></div>` : ''}
      <button class="btn btn-primary" type="submit">Enregistrer</button>
    </form>
    <div class="card" style="max-width:640px;margin-top:16px">
      <h2>Mes données</h2>
      <p class="muted small">Téléchargez l’ensemble de vos données ou supprimez définitivement votre compte.</p>
      <a class="btn" href="/api/me/export" download>Télécharger mes données</a>
      <form id="delete-form" style="margin-top:20px">
        <div class="field"><label>Mot de passe pour confirmer la suppression</label><input name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn btn-danger" type="submit">Supprimer mon compte</button>
      </form>
    </div>`;
  document.getElementById('form').addEventListener('submit', (e) =>
    attempt(async () => {
      e.preventDefault();
      await api('/me', { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) });
      await refreshMe();
      toast('Paramètres enregistrés');
    }),
  );
  document.getElementById('delete-form').addEventListener('submit', (e) =>
    attempt(async () => {
      e.preventDefault();
      if (!confirm('Supprimer définitivement votre compte et toutes vos données ? Cette action est irréversible.')) return;
      await api('/me', { method: 'DELETE', body: Object.fromEntries(new FormData(e.target)) });
      location.href = '/';
    }),
  );
}

// ---------- Démarrage ----------
document.getElementById('menu-btn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
document.getElementById('logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST', body: {} });
  location.href = '/';
});
window.addEventListener('hashchange', router);
refreshMe().then(router);

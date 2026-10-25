// Espace client MDIA — application monopage sans framework.
const state = { me: null, plans: [] };
const view = document.getElementById('view');

// ---------- Utilitaires ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const eur = (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }));
const frDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('fr-FR') : '—');
const frDateTime = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
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
      : 'Suivez votre budget et vos abonnements, sans limite d’échéances, à partir de 4,99 € / mois.'}</p>
    <a class="btn btn-primary" href="#abonnement">Voir les offres</a>
  </div>`;
}

// ---------- Navigation ----------
const ROUTES = [
  { id: 'tableau-de-bord', label: 'Tableau de bord', icon: '🏠', render: renderDashboard },
  { id: 'assistant', label: 'Assistant IA', icon: '💬', render: renderAssistant },
  { id: 'echeances', label: 'Échéances', icon: '⏰', render: renderEcheances, feature: 'echeances' },
  { id: 'budget', label: 'Budget', icon: '💶', render: renderBudget, feature: 'budget' },
  { id: 'abonnements', label: 'Abonnements', icon: '🔁', render: renderAbonnements, feature: 'abonnements' },
  { id: 'clients', label: 'Clients', icon: '👥', render: renderClients, feature: 'clients', artisanOnly: true },
  { id: 'documents', label: 'Devis & factures', icon: '🧾', render: renderDocuments, feature: 'documents', artisanOnly: true },
  { id: 'tarifs', label: 'Mes prix', icon: '🏷️', render: renderTarifs, feature: 'documents', artisanOnly: true },
  { id: 'urssaf', label: 'Déclaration URSSAF', icon: '📤', render: renderUrssaf, feature: 'documents', artisanOnly: true },
  { id: 'abonnement', label: 'Abonnement', icon: '⭐', render: renderBilling },
  { id: 'statistiques', label: 'Statistiques', icon: '📊', render: renderStats, adminOnly: true },
  { id: 'parametres', label: 'Paramètres', icon: '⚙️', render: renderSettings },
];

function currentRoute() {
  const [hash, query] = location.hash.slice(1).split('?');
  return { route: ROUTES.find((r) => r.id === hash) || ROUTES[0], query: new URLSearchParams(query || '') };
}

function renderNav() {
  const { route } = currentRoute();
  const isArtisan = state.me.user.accountType === 'artisan';
  document.getElementById('nav').innerHTML = ROUTES.filter((r) => (!r.artisanOnly || isArtisan || has(r.feature)) && (!r.adminOnly || state.me.user.isAdmin))
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
    if (d.urssaf) stats.push([`URSSAF : à déclarer avant le ${frDate(d.urssaf.deadline)}`, eur(d.urssaf.total_ht)]);
    stats.push(['Factures impayées', `${d.facturation.impayees} · ${eur(d.facturation.montantImpaye)}`]);
    stats.push(['Devis en attente de réponse', d.facturation.devisEnAttente]);
  }
  if (d.budget) stats.push(['Solde du mois', eur(d.budget.solde)]);
  stats.push(['Échéances en retard', d.echeancesEnRetard]);

  view.innerHTML = `
    <div class="main-header"><h1>Bonjour ${esc(u.name.split(' ')[0])} 👋</h1>
      <div class="header-actions"><button class="btn" data-photo="courrier">📷 Photo d’un courrier</button>
      <a class="btn btn-primary" href="#assistant">💬 Demander à l’assistant</a></div></div>
    ${d.reponsesDevis?.length ? `<div class="card" style="margin-bottom:16px"><h2>Réponses de vos clients</h2>
      <ul class="plain">${d.reponsesDevis.map((q) => `<li>${q.status === 'accepte' && q.accepted_at
        ? `<span class="badge badge-ok">Accepté</span> ${esc(q.client || 'Un client')} a accepté le devis <a href="/document?id=${q.id}" target="_blank">${esc(q.number)}</a> (${eur(q.total_ttc)}) le ${frDateTime(q.accepted_at)}`
        : `<span class="badge badge-warn">Refusé</span> ${esc(q.client || 'Un client')} a refusé le devis <a href="/document?id=${q.id}" target="_blank">${esc(q.number)}</a>${q.refusal_reason ? ` : « ${esc(q.refusal_reason)} »` : ''}`}</li>`).join('')}</ul></div>` : ''}
    <div class="stats">${stats.map(([l, v]) => `<div class="card stat"><div class="label">${l}</div><div class="value">${esc(v)}</div></div>`).join('')}</div>
    <div class="two-col">
      <div class="card">
        <h2>Échéances des 30 prochains jours</h2>
        ${d.echeancesAVenir.length ? `<div class="table-wrap"><table><tbody>${d.echeancesAVenir.map((e) => `
          <tr><td>${esc(e.title)}</td><td>${e.due_date < todayIso() ? `<span class="badge badge-warn">En retard · ${frDate(e.due_date)}</span>` : frDate(e.due_date)}</td><td class="num">${eur(e.amount)}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="empty">Aucune échéance à venir. 🎉</p>'}
        <a href="#echeances" class="small">Toutes les échéances →</a>
        ${d.renouvellements?.length ? `<h2 style="margin-top:20px">Abonnements renouvelés bientôt</h2>
          <div class="table-wrap"><table><tbody>${d.renouvellements.map((a) => `
          <tr><td>${esc(a.name)}</td><td>${frDate(a.next_renewal)}</td><td class="num">${eur(a.amount)}</td></tr>`).join('')}</tbody></table></div>
          <a href="#abonnements" class="small">Tous les abonnements →</a>` : ''}
      </div>
      <div class="card">
        <h2>Que puis-je faire pour vous ?</h2>
        <p class="muted">Quelques exemples à demander à l’assistant :</p>
        <ul>
          ${u.accountType === 'artisan'
            ? '<li>« Fais une facture pour M. Durand : remplacement chauffe-eau 850 € HT »</li><li>« Fais une facture d’acompte de 30 % sur le dernier devis »</li><li>« Combien je dois déclarer à l’URSSAF ce trimestre ? »</li><li>Envoyez la photo d’un ticket de chez votre fournisseur : la dépense est rangée toute seule</li>'
            : '<li>« Rappelle-moi de renouveler l’assurance auto le 3 mars »</li><li>« J’ai dépensé 86 € de courses aujourd’hui »</li><li>« Écris une lettre de résiliation pour ma box internet »</li><li>Envoyez la photo d’un courrier des impôts ou de la CAF : l’assistant vous l’explique</li>'}
        </ul>
      </div>
    </div>`;
  wirePhotoButtons();
}

// ---------- Photos envoyées à l'assistant (tickets, courriers) ----------
const PHOTO_PROMPTS = {
  ticket: 'Voici la photo d’un ticket de caisse ou d’une facture fournisseur : enregistre la dépense.',
  courrier: 'Voici la photo d’un courrier : explique-moi simplement ce qu’il dit et ce que je dois faire.',
};

// Ouvre le choix de fichier (sur téléphone : appareil photo ou galerie). Doit être appelé pendant un clic.
function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    r.readAsDataURL(blob);
  });

// Les photos sont réduites (1600 px max) avant l'envoi : plus rapide sur mobile, et bien assez pour lire un ticket.
async function readAttachment(file) {
  if (file.type === 'application/pdf') {
    if (file.size > 8 * 1024 * 1024) throw new Error('PDF trop lourd (8 Mo maximum).');
    return { media_type: 'application/pdf', data: await toBase64(file) };
  }
  if (!file.type.startsWith('image/')) throw new Error('Choisissez une photo ou un PDF.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Format de photo non pris en charge. Essayez une capture d’écran ou un PDF.'));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return { media_type: 'image/jpeg', data: await toBase64(blob) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Envoie un message (et éventuellement une photo) à l'assistant, en ouvrant sa page.
function askAssistant(text, file = null) {
  state.pending = { text, file };
  if (location.hash.startsWith('#assistant')) router();
  else location.hash = 'assistant';
}

function wirePhotoButtons() {
  view.querySelectorAll('[data-photo]').forEach((b) =>
    b.addEventListener('click', async () => {
      const file = await pickFile();
      if (file) askAssistant(PHOTO_PROMPTS[b.dataset.photo], file);
    }),
  );
}

// ---------- Assistant ----------
const SUGGESTIONS = {
  artisan: [
    'Crée un devis pour Mme Martin : pose de 12 m² de carrelage à 45 €/m²',
    'Quelles factures sont impayées ?',
    'Combien je dois déclarer à l’URSSAF ce trimestre ?',
    'Retiens que mon heure de main-d’œuvre est à 45 € HT',
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
  creer_facture_acompte: 'facture d’acompte créée',
  enregistrer_tarif: 'tarif enregistré',
  ajouter_abonnement: 'abonnement ajouté',
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
        <button class="btn btn-icon" type="button" id="photo" title="Envoyer une photo (ticket, courrier…)" aria-label="Envoyer une photo">📷</button>
        <textarea id="input" rows="1" placeholder="Demandez quelque chose…" aria-label="Message"></textarea>
        <button class="btn btn-icon hidden" type="button" id="mic" title="Dicter mon message" aria-label="Dicter mon message">🎤</button>
        <button class="btn btn-primary" type="submit" id="send">Envoyer</button>
      </form>
      <div class="muted small hidden" id="listening" style="margin-top:6px">🔴 Je vous écoute… parlez normalement, appuyez sur 🎤 pour arrêter.</div>
    </div>`;
  const log = document.getElementById('log');
  const input = document.getElementById('input');
  const addBubble = (role, content, actions = []) => {
    const div = document.createElement('div');
    div.className = `bubble ${role}`;
    div.innerHTML = role === 'assistant' ? md(content) : esc(content).replace(/^\[(Photo jointe|PDF joint)\]/, '<span class="badge">📎 $1</span>');
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

  const send = async (text, file = null) => {
    if (!text.trim() && !file) return;
    stopDictation();
    document.getElementById('sugg').classList.add('hidden');
    addBubble('user', file ? `[${file.type === 'application/pdf' ? 'PDF joint' : 'Photo jointe'}] ${text}` : text);
    input.value = '';
    const typing = addBubble('assistant', '');
    typing.innerHTML = `<span class="typing">${file ? 'L’assistant lit votre document…' : 'L’assistant réfléchit…'}</span>`;
    document.getElementById('send').disabled = true;
    try {
      const attachment = file ? await readAttachment(file) : undefined;
      const res = await api('/chat', { method: 'POST', body: { message: text, attachment } });
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
  document.getElementById('photo').addEventListener('click', async () => {
    const file = await pickFile();
    if (file) send(input.value || (state.me.user.accountType === 'artisan' ? PHOTO_PROMPTS.ticket : PHOTO_PROMPTS.courrier), file);
  });

  // Dictée vocale (reconnaissance vocale du navigateur, en français)
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = document.getElementById('mic');
  let rec = null;
  function stopDictation() {
    if (rec) rec.stop();
  }
  if (Recognition) {
    mic.classList.remove('hidden');
    mic.addEventListener('click', () => {
      if (rec) return rec.stop();
      const before = input.value ? `${input.value.trim()} ` : '';
      rec = new Recognition();
      rec.lang = 'fr-FR';
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (e) => {
        input.value = before + [...e.results].map((r) => r[0].transcript).join(' ').replace(/\s+/g, ' ').trimStart();
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Autorisez le micro pour ce site dans les réglages du navigateur.');
      };
      rec.onend = () => {
        rec = null;
        mic.classList.remove('recording');
        document.getElementById('listening').classList.add('hidden');
        input.focus();
      };
      rec.start();
      mic.classList.add('recording');
      document.getElementById('listening').classList.remove('hidden');
    });
  }
  document.getElementById('clear').addEventListener('click', () =>
    attempt(async () => {
      if (!confirm('Effacer tout l’historique de conversation ?')) return;
      await api('/chat', { method: 'DELETE' });
      router();
    }),
  );
  input.focus();
  if (state.pending) {
    const { text, file } = state.pending;
    state.pending = null;
    send(text, file);
  }
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
    <div class="main-header"><h1>Échéances</h1><div class="header-actions">${limit ? `<span class="muted small">${echeances.length} / ${limit} avec l’offre Gratuit</span>` : ''}
      <button class="btn btn-small" data-photo="courrier">📷 Photo d’un courrier</button></div></div>
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
  wirePhotoButtons();
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
    <div class="main-header"><h1>Budget</h1><div class="header-actions">
      <button class="btn btn-small" data-photo="ticket">📷 Photo d’un ticket</button>
      <input type="month" id="month" value="${month}" style="width:auto"></div></div>
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
  wirePhotoButtons();
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
  const [{ documents }, { clients }, { items: catalog }] = await Promise.all([api(`/documents?type=${type}`), api('/clients'), api('/catalogue')]);
  const vat = state.me.user.vatRate;
  view.innerHTML = `
    <div class="main-header"><h1>Devis & factures</h1>
      <div><a class="btn btn-small ${type === 'devis' ? 'btn-primary' : ''}" href="#documents?type=devis">Devis</a>
      <a class="btn btn-small ${type === 'facture' ? 'btn-primary' : ''}" href="#documents?type=facture">Factures</a></div></div>
    <div class="stack">
      <details class="card"><summary><strong>＋ ${type === 'devis' ? 'Nouveau devis' : 'Nouvelle facture'}</strong> <span class="muted small">(ou demandez-le simplement à l’assistant)</span></summary>
        <form id="form" style="margin-top:16px">
          <div class="row">
            <div class="field"><label>Client existant</label><select name="client_id"><option value="">— Choisir —</option>${clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
            <div class="field"><label>… ou nouveau client</label><input name="client_name" placeholder="Nom du client"></div>
            <div class="field"><label>${type === 'devis' ? 'Valable jusqu’au' : 'À payer avant le'}</label><input name="due_date" type="date"></div>
          </div>
          ${catalog.length ? '<p class="muted small" style="margin:0">Commencez à taper une prestation : vos prix enregistrés dans « Mes prix » se remplissent tout seuls.</p>' : ''}
          <datalist id="catalog-list">${catalog.map((c) => `<option value="${esc(c.label)}">`).join('')}</datalist>
          <div class="table-wrap"><table class="lines-table"><thead><tr><th>Description</th><th>Qté</th><th>Unité</th><th>Prix HT</th><th>TVA %</th><th></th></tr></thead><tbody id="lines"></tbody></table></div>
          <button class="btn btn-small" type="button" id="add-line" style="margin:8px 0 16px">＋ Ajouter une ligne</button>
          <div class="field"><label>Notes / conditions</label><textarea name="notes" rows="2"></textarea></div>
          <button class="btn btn-primary" type="submit">Créer</button>
        </form>
      </details>
      <div class="card">
        ${documents.length ? `<div class="table-wrap"><table><thead><tr><th>N°</th><th>Client</th><th>Date</th><th>Statut</th><th class="num">Total TTC</th><th></th></tr></thead><tbody>
        ${documents.map((d) => `<tr>
          <td><a href="/document?id=${d.id}" target="_blank">${esc(d.number)}</a>${docBadges(d)}</td>
          <td>${esc(d.client?.name || '—')}</td>
          <td>${frDate(d.issue_date)}</td>
          <td><select data-status="${d.id}" style="width:auto">${STATUSES[d.type].map((s) => `<option value="${s}" ${s === d.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select></td>
          <td class="num">${eur(d.total_ttc)}</td>
          <td class="actions">
            <button class="btn btn-small btn-primary" data-send="${d.id}">Envoyer au client</button>
            <a class="btn btn-small" href="/document?id=${d.id}" target="_blank">PDF</a>
            ${d.type === 'devis' ? `<button class="btn btn-small" data-deposit="${d.id}">Acompte</button>
            <button class="btn btn-small" data-convert="${d.id}">→ Facture</button>` : ''}
            <button class="btn btn-small btn-danger" data-del="${d.id}" aria-label="Supprimer">✕</button>
          </td></tr>`).join('')}
        </tbody></table></div>` : `<p class="empty">${type === 'devis' ? 'Aucun devis' : 'Aucune facture'} pour l’instant.</p>`}
      </div>
    </div>`;

  const lines = document.getElementById('lines');
  const addLine = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input data-k="description" list="catalog-list" required></td><td><input data-k="quantity" type="number" step="0.01" value="1"></td>
      <td><input data-k="unit" value="u" style="width:70px"></td><td><input data-k="unit_price" type="number" step="0.01" required></td>
      <td><input data-k="vat_rate" type="number" step="0.1" value="${vat}" style="width:80px"></td>
      <td><button type="button" class="btn btn-small btn-danger" aria-label="Retirer">✕</button></td>`;
    tr.querySelector('button').addEventListener('click', () => tr.remove());
    tr.querySelector('[data-k=description]').addEventListener('change', (e) => {
      const item = catalog.find((c) => c.label.toLowerCase() === e.target.value.trim().toLowerCase());
      if (!item) return;
      tr.querySelector('[data-k=unit]').value = item.unit;
      tr.querySelector('[data-k=unit_price]').value = item.unit_price;
      tr.querySelector('[data-k=vat_rate]').value = item.vat_rate ?? vat;
    });
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
  view.querySelectorAll('[data-status]').forEach((s) => {
    let previous = s.value;
    s.addEventListener('change', () =>
      attempt(async () => {
        const body = { status: s.value };
        if (s.value === 'payee') {
          const paid = await askPayment();
          if (!paid) return (s.value = previous);
          Object.assign(body, paid);
        }
        try {
          await api(`/documents/${s.dataset.status}/statut`, { method: 'POST', body });
        } catch (err) {
          s.value = previous;
          throw err;
        }
        previous = s.value;
        toast('Statut mis à jour');
      }),
    );
  });
  view.querySelectorAll('[data-deposit]').forEach((b) =>
    b.addEventListener('click', () => createDepositDialog(documents.find((d) => d.id === Number(b.dataset.deposit)))),
  );
  view.querySelectorAll('[data-send]').forEach((b) =>
    b.addEventListener('click', () => attempt(() => sendToClient(documents.find((d) => d.id === Number(b.dataset.send))))),
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

function docBadges(d) {
  const b = [];
  if (d.kind === 'acompte') b.push('<span class="badge">Acompte</span>');
  if (d.accepted_at) b.push(`<span class="badge badge-ok" title="Le ${frDateTime(d.accepted_at)} par ${esc(d.accepted_name)}">Accepté en ligne</span>`);
  else if (d.refused_at) b.push('<span class="badge badge-warn">Refusé en ligne</span>');
  else if (d.viewed_at && d.type === 'devis') b.push('<span class="badge">Vu par le client</span>');
  if (d.paid_at && d.status === 'payee') b.push(`<span class="badge badge-ok">Payée le ${frDate(d.paid_at)}</span>`);
  return b.length ? `<div class="badges">${b.join('')}</div>` : '';
}

const PAYMENT_LABELS = { virement: 'Virement', cheque: 'Chèque', especes: 'Espèces', carte: 'Carte bancaire', autre: 'Autre' };

// Date d'encaissement et mode de paiement : ils servent au livre des recettes et à la déclaration URSSAF.
function askPayment() {
  return new Promise((resolve) => {
    const m = modal(`<h2>Facture payée</h2>
      <p class="muted small">Ces informations servent à votre déclaration URSSAF et à votre livre des recettes.</p>
      <div class="row">
        <div class="field"><label>Payée le</label><input type="date" id="paid-at" value="${todayIso()}" max="${todayIso()}"></div>
        <div class="field"><label>Mode de paiement</label><select id="paid-method">${Object.entries(PAYMENT_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      </div>
      <div class="modal-actions"><button class="btn" data-x>Annuler</button><button class="btn btn-primary" data-go>Valider</button></div>`);
    const done = (v) => {
      m.close();
      resolve(v);
    };
    m.el.querySelector('[data-x]').onclick = () => done(null);
    m.el.addEventListener('click', (e) => e.target === m.el && resolve(null));
    m.el.querySelector('[data-go]').onclick = () =>
      done({ paid_at: m.el.querySelector('#paid-at').value, payment_method: m.el.querySelector('#paid-method').value });
  });
}

function createDepositDialog(d) {
  const m = modal(`<h2>Facture d’acompte</h2>
    <p class="muted small">Sur le devis ${esc(d.number)} de ${eur(d.total_ttc)} TTC. L’acompte sera déduit tout seul de la facture finale (bouton « → Facture »).</p>
    <div class="row">
      <div class="field"><label>Pourcentage</label><input type="number" id="dep-pct" min="1" max="100" step="1" value="30"></div>
      <div class="field"><label>Montant TTC</label><input id="dep-amount" disabled></div>
    </div>
    <div class="modal-actions"><button class="btn" data-x>Annuler</button><button class="btn btn-primary" data-go>Créer la facture d’acompte</button></div>`);
  const pct = m.el.querySelector('#dep-pct');
  const preview = () => (m.el.querySelector('#dep-amount').value = eur((d.total_ttc * Number(pct.value || 0)) / 100));
  pct.addEventListener('input', preview);
  preview();
  m.el.querySelector('[data-x]').onclick = m.close;
  m.el.querySelector('[data-go]').onclick = () =>
    attempt(async () => {
      const { document: inv } = await api(`/documents/${d.id}/acompte`, { method: 'POST', body: { percent: pct.value } });
      m.close();
      toast(`Facture d’acompte ${inv.number} créée`);
      location.hash = 'documents?type=facture';
    });
}

// ---------- Envoi d'un devis / d'une facture au client (PDF + message prêt à envoyer) ----------
const SHARE_STYLES = ['Classique', 'Courte', 'Chaleureuse'];

function shareMessages(d, link) {
  const u = state.me.user;
  const sig = u.companyName || u.name;
  const hello = `Bonjour${d.client?.name ? ` ${d.client.name}` : ''},`;
  const ttc = eur(d.total_ttc);
  const due = d.due_date ? frDate(d.due_date) : null;
  if (d.type === 'devis') {
    return [
      `${hello}\n\nComme convenu, voici le devis ${d.number} pour les travaux, d'un montant de ${ttc} TTC.${due ? ` Il est valable jusqu'au ${due}.` : ''} N'hésitez pas si vous avez des questions.\n\nVous pouvez l'accepter en ligne ici : ${link}\n\nCordialement,\n${sig}`,
      `${hello}\n\nVous trouverez ci-joint votre devis ${d.number} (${ttc} TTC). Pour l'accepter : ${link}\n\nBonne journée,\n${sig}`,
      `${hello}\n\nMerci pour votre confiance. Voici le devis ${d.number} d'un montant de ${ttc} TTC. Si tout vous convient, il vous suffit de l'accepter en ligne ici : ${link}\n\nÀ bientôt,\n${sig}`,
    ];
  }
  return [
    `${hello}\n\nVoici la facture ${d.number} pour les travaux réalisés, d'un montant de ${ttc} TTC${due ? `, à régler avant le ${due}` : ''}. Merci d'avance pour votre règlement.\n\nCordialement,\n${sig}`,
    `${hello}\n\nVous trouverez ci-joint votre facture ${d.number} (${ttc} TTC).\n\nBonne journée,\n${sig}`,
    `${hello}\n\nMerci encore pour votre confiance, ce fut un plaisir de travailler pour vous. Vous trouverez ci-joint la facture ${d.number} d'un montant de ${ttc} TTC${due ? `, à régler avant le ${due}` : ''}.\n\nÀ bientôt,\n${sig}`,
  ];
}

async function fetchPdf(d) {
  const res = await fetch(`/api/documents/${d.id}/pdf`);
  if (!res.ok) throw new Error('Impossible de préparer le PDF.');
  const name = decodeURIComponent((res.headers.get('content-disposition') || '').match(/filename\*=UTF-8''([^;]+)/)?.[1] || `${d.number}.pdf`);
  return new File([await res.blob()], name, { type: 'application/pdf' });
}

function modal(html) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal card" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => e.target === wrap && close());
  return { el: wrap, close };
}

// Partage : sur téléphone, menu de partage avec le PDF joint et le message ; sinon, message copié + PDF téléchargé.
async function deliver(d, message, filePromise, onSent) {
  try {
    await navigator.clipboard?.writeText(message); // copie de secours, si l'appli choisie ne reprend pas le texte
  } catch {
    /* presse-papiers indisponible : sans conséquence */
  }
  const file = await filePromise;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: message, title: file.name.replace(/\.pdf$/, '') });
      return onSent();
    } catch (err) {
      if (err.name === 'AbortError') return; // l'artisan a fermé le menu de partage
      if (err.name === 'NotAllowedError') {
        // Le navigateur exige un nouvel appui (préparation du PDF trop longue) : un clic suffit.
        const m = modal(`<h2>Prêt à envoyer</h2><p class="muted">Le ${d.type} ${esc(d.number)} et votre message sont prêts.</p>
          <div class="modal-actions"><button class="btn" data-x>Annuler</button><button class="btn btn-primary" data-go>Partager</button></div>`);
        m.el.querySelector('[data-x]').onclick = m.close;
        m.el.querySelector('[data-go]').onclick = () => {
          m.close();
          navigator.share({ files: [file], text: message }).then(onSent, () => {});
        };
        return;
      }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Message copié et PDF téléchargé : collez le message et joignez le PDF à votre envoi');
  return onSent();
}

async function sendToClient(d) {
  const filePromise = fetchPdf(d);
  filePromise.catch(() => {});
  const link = d.type === 'devis' ? (await api(`/documents/${d.id}/lien`, { method: 'POST', body: {} })).url : null;
  const messages = shareMessages(d, link);
  // Un brouillon partagé passe à « Envoyé(e) »
  const onSent = async () => {
    if (d.status !== 'brouillon') return;
    await api(`/documents/${d.id}/statut`, { method: 'POST', body: { status: d.type === 'devis' ? 'envoye' : 'envoyee' } }).catch(() => {});
    router();
  };
  const saved = state.me.user.shareChoices?.[d.type];
  if (Number.isInteger(saved) && messages[saved]) return deliver(d, messages[saved], filePromise, onSent);

  const m = modal(`
    <h2>Envoyer ${d.type === 'devis' ? 'le devis' : 'la facture'} ${esc(d.number)}</h2>
    <p class="muted small">Choisissez un message. Il sera envoyé avec le PDF ${d.type === 'devis' ? 'du devis' : 'de la facture'} (WhatsApp, SMS, email…).${d.type === 'devis' ? ' Votre client pourra accepter le devis en un clic grâce au lien.' : ''}</p>
    <div class="share-options">${messages.map((msg, i) => `
      <label class="share-option"><input type="radio" name="msg" value="${i}" ${i === 0 ? 'checked' : ''}>
        <span><strong>${SHARE_STYLES[i]}</strong><span class="share-text">${esc(msg)}</span></span></label>`).join('')}
    </div>
    <label class="check"><input type="checkbox" id="remember"> Ne plus me demander (toujours utiliser ce message pour les ${d.type === 'devis' ? 'devis' : 'factures'})</label>
    <div class="modal-actions"><button class="btn" data-x>Annuler</button><button class="btn btn-primary" data-go>Envoyer</button></div>`);
  m.el.querySelector('[data-x]').onclick = m.close;
  m.el.querySelector('[data-go]').onclick = () =>
    attempt(async () => {
      const choice = Number(m.el.querySelector('input[name=msg]:checked').value);
      const remember = m.el.querySelector('#remember').checked;
      m.close();
      const sending = deliver(d, messages[choice], filePromise, onSent);
      if (remember) {
        const shareChoices = { ...(state.me.user.shareChoices || {}), [d.type]: choice };
        await api('/me', { method: 'PATCH', body: { shareChoices } });
        state.me.user.shareChoices = shareChoices;
        toast('Message enregistré : vous pourrez le changer dans les Paramètres');
      }
      await sending;
    });
}

// ---------- Mes prix (tarifs habituels de l'artisan) ----------
async function renderTarifs() {
  if (!has('documents')) {
    view.innerHTML = `<div class="main-header"><h1>Mes prix</h1></div>${upsell('documents')}`;
    return;
  }
  const { items } = await api('/catalogue');
  const vat = state.me.user.vatRate;
  view.innerHTML = `
    <div class="main-header"><h1>Mes prix</h1></div>
    <div class="stack">
      <form class="card" id="form">
        <h2>Ajouter un prix</h2>
        <p class="muted small">Enregistrez une fois vos tarifs habituels : l’assistant les reprend tout seul dans vos devis. Vous pouvez aussi lui dire « retiens que ma pose de carrelage est à 45 € le m² ».</p>
        <div class="row">
          <div class="field" style="flex:2"><label>Prestation</label><input name="label" required placeholder="Ex. Pose carrelage"></div>
          <div class="field"><label>Prix HT (€)</label><input name="unit_price" type="number" step="0.01" min="0" required></div>
          <div class="field"><label>Unité</label><input name="unit" list="units" value="u"></div>
          <div class="field"><label>TVA %</label><input name="vat_rate" type="number" step="0.1" min="0" max="100" value="${vat}"></div>
        </div>
        <datalist id="units">${['u', 'h', 'm²', 'ml', 'm³', 'forfait', 'jour', 'km'].map((u) => `<option value="${u}">`).join('')}</datalist>
        <button class="btn btn-primary" type="submit">Enregistrer</button>
      </form>
      <div class="card">
        ${items.length ? `<div class="table-wrap"><table><thead><tr><th>Prestation</th><th class="num">Prix HT</th><th>Unité</th><th class="num">TVA</th><th></th></tr></thead><tbody>
        ${items.map((t) => `<tr><td>${esc(t.label)}</td><td class="num">${eur(t.unit_price)}</td><td>${esc(t.unit)}</td><td class="num">${t.vat_rate ?? vat} %</td>
          <td class="actions"><button class="btn btn-small btn-danger" data-del="${t.id}" aria-label="Supprimer">✕</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">Aucun prix enregistré pour l’instant.</p>'}
      </div>
    </div>`;
  document.getElementById('form').addEventListener('submit', (e) =>
    attempt(async () => {
      e.preventDefault();
      await api('/catalogue', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      toast('Prix enregistré');
      router();
    }),
  );
  view.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () =>
      attempt(async () => {
        await api(`/catalogue/${b.dataset.del}`, { method: 'DELETE' });
        router();
      }),
    ),
  );
}

// ---------- Déclaration URSSAF (micro-entrepreneur) ----------
const URSSAF_STATUS = {
  a_declarer: '<span class="badge badge-warn">À déclarer</span>',
  en_cours: '<span class="badge">En cours</span>',
  passee: '<span class="badge badge-ok">Délai passé</span>',
  a_venir: '',
};

async function renderUrssaf(query) {
  if (!has('documents')) {
    view.innerHTML = `<div class="main-header"><h1>Déclaration URSSAF</h1></div>${upsell('documents')}`;
    return;
  }
  const year = Number(query.get('annee')) || new Date().getFullYear();
  const r = await api(`/urssaf?annee=${year}`);
  const now = r.periods.find((p) => p.status === 'a_declarer') || r.periods.find((p) => p.status === 'en_cours');
  view.innerHTML = `
    <div class="main-header"><h1>Déclaration URSSAF</h1>
      <div class="header-actions"><select id="year" style="width:auto">${[0, 1, 2].map((i) => new Date().getFullYear() - i).map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></div></div>
    ${now ? `<div class="card highlight" style="margin-bottom:16px">
      <div class="label muted small">${now.status === 'a_declarer' ? 'À déclarer maintenant' : 'Période en cours'} · ${esc(now.label)}</div>
      <div class="value big">${eur(now.total_ht)}</div>
      <p class="muted small" style="margin:0">Chiffre d’affaires encaissé hors taxes, à déclarer avant le <strong>${frDate(now.deadline)}</strong> sur autoentrepreneur.urssaf.fr.</p>
    </div>` : ''}
    <div class="card">
      <div class="main-header" style="margin-bottom:8px"><h2 style="margin:0">Année ${year}</h2>
        <div class="choice" style="margin:0">
          <input type="radio" name="per" id="per-m" value="mensuelle" ${r.period === 'mensuelle' ? 'checked' : ''}><label for="per-m">Je déclare tous les mois</label>
          <input type="radio" name="per" id="per-t" value="trimestrielle" ${r.period === 'trimestrielle' ? 'checked' : ''}><label for="per-t">Tous les trimestres</label>
        </div></div>
      <div class="table-wrap"><table><thead><tr><th>Période</th><th class="num">CA encaissé HT</th><th class="num">Factures</th><th>À déclarer avant le</th><th></th></tr></thead><tbody>
      ${r.periods.map((p) => `<tr class="${p === now ? 'row-highlight' : ''}"><td>${esc(p.label)}</td><td class="num">${eur(p.total_ht)}</td><td class="num">${p.count}</td><td>${frDate(p.deadline)}</td><td>${URSSAF_STATUS[p.status]}</td></tr>`).join('')}
      <tr><td><strong>Total ${year}</strong></td><td class="num"><strong>${eur(r.total_ht)}</strong></td><td></td><td></td><td></td></tr>
      </tbody></table></div>
      <p style="margin-top:16px"><a class="btn" href="/api/urssaf/livre-recettes?annee=${year}" download>Télécharger le livre des recettes ${year} (Excel)</a></p>
      <p class="muted small">Seules les factures marquées « Payée » sont comptées, à leur date de paiement. Le livre des recettes est obligatoire pour les micro-entrepreneurs : gardez-le avec vos factures. Si vous vendez aussi du matériel, séparez la part « vente » de la part « prestation » lors de votre déclaration. En cas de doute, l’URSSAF ou un comptable vous renseigne.</p>
    </div>`;
  document.getElementById('year').addEventListener('change', (e) => (location.hash = `urssaf?annee=${e.target.value}`));
  view.querySelectorAll('input[name=per]').forEach((i) =>
    i.addEventListener('change', () =>
      attempt(async () => {
        await api('/me', { method: 'PATCH', body: { urssafPeriod: i.value } });
        state.me.user.urssafPeriod = i.value;
        router();
      }),
    ),
  );
}

// ---------- Abonnements du foyer ----------
const ABO_CATEGORIES = {
  internet: 'Box internet', mobile: 'Forfait mobile', energie: 'Énergie', assurance: 'Assurance', banque: 'Banque',
  streaming: 'Streaming / TV', sport: 'Sport', presse: 'Presse', logiciel: 'Logiciel / appli', autre: 'Autre',
};
const ABO_FREQ = { mensuelle: 'par mois', trimestrielle: 'par trimestre', annuelle: 'par an' };

async function renderAbonnements() {
  if (!has('abonnements')) {
    view.innerHTML = `<div class="main-header"><h1>Abonnements</h1></div>${upsell('abonnements')}`;
    return;
  }
  const { abonnements, totalMensuel, totalAnnuel } = await api('/abonnements');
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const today = todayIso();
  view.innerHTML = `
    <div class="main-header"><h1>Abonnements</h1></div>
    <div class="stats">
      <div class="card stat"><div class="label">Coût par mois</div><div class="value">${eur(totalMensuel)}</div></div>
      <div class="card stat"><div class="label">Coût par an</div><div class="value">${eur(totalAnnuel)}</div></div>
      <div class="card stat"><div class="label">Abonnements</div><div class="value">${abonnements.length}</div></div>
    </div>
    <div class="stack">
      <form class="card" id="form">
        <h2>Ajouter un abonnement</h2>
        <div class="row">
          <div class="field" style="flex:2"><label>Nom</label><input name="name" required placeholder="Ex. Box internet, salle de sport…"></div>
          <div class="field"><label>Catégorie</label><select name="category">${Object.entries(ABO_CATEGORIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <div class="field"><label>Prix (€)</label><input name="amount" type="number" step="0.01" min="0"></div>
          <div class="field"><label>Payé</label><select name="frequency">${Object.entries(ABO_FREQ).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        </div>
        <div class="row">
          <div class="field"><label>Prochain prélèvement ou renouvellement</label><input name="next_renewal" type="date"></div>
          <div class="field"><label>Fin d’engagement (si vous la connaissez)</label><input name="commitment_end" type="date"></div>
        </div>
        <button class="btn btn-primary" type="submit">Ajouter</button>
      </form>
      <div class="card">
        ${abonnements.length ? `<div class="table-wrap"><table><thead><tr><th>Abonnement</th><th class="num">Prix</th><th>Prochain renouvellement</th><th>Engagement</th><th></th></tr></thead><tbody>
        ${abonnements.map((a) => `<tr>
          <td>${esc(a.name)}<div class="muted small">${ABO_CATEGORIES[a.category] || ''}</div></td>
          <td class="num">${a.amount != null ? `${eur(a.amount)} <span class="muted small">${ABO_FREQ[a.frequency]}</span>` : '—'}</td>
          <td>${a.next_renewal ? (a.next_renewal <= soon ? `<span class="badge badge-warn">${frDate(a.next_renewal)}</span>` : frDate(a.next_renewal)) : '—'}</td>
          <td>${a.commitment_end ? (a.commitment_end <= today ? '<span class="badge badge-ok">Sans engagement</span>' : `jusqu’au ${frDate(a.commitment_end)}`) : '—'}</td>
          <td class="actions"><button class="btn btn-small" data-cancel="${a.id}">Lettre de résiliation</button>
            <button class="btn btn-small btn-danger" data-del="${a.id}" aria-label="Supprimer">✕</button></td></tr>`).join('')}
        </tbody></table></div>
        <p class="muted small">Les renouvellements des 30 prochains jours apparaissent en orange, et sur votre tableau de bord.</p>` : '<p class="empty">Ajoutez vos abonnements (box, téléphone, assurances, salle de sport…) pour savoir combien ils vous coûtent et quand ils se renouvellent.</p>'}
      </div>
    </div>`;
  document.getElementById('form').addEventListener('submit', (e) =>
    attempt(async () => {
      e.preventDefault();
      await api('/abonnements', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      toast('Abonnement ajouté');
      router();
    }),
  );
  view.querySelectorAll('[data-cancel]').forEach((b) =>
    b.addEventListener('click', () => {
      const a = abonnements.find((x) => x.id === Number(b.dataset.cancel));
      askAssistant(`Écris une lettre de résiliation pour mon abonnement « ${a.name} »${a.commitment_end ? ` (fin d’engagement le ${frDate(a.commitment_end)})` : ''}. Dis-moi aussi comment l’envoyer et dans quel délai la résiliation prend effet.`);
    }),
  );
  view.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () =>
      attempt(async () => {
        if (!confirm('Supprimer cet abonnement de la liste ?')) return;
        await api(`/abonnements/${b.dataset.del}`, { method: 'DELETE' });
        router();
      }),
    ),
  );
}

// ---------- Abonnement ----------
const PLAN_FEATURES = {
  gratuit: ['10 messages IA / mois', '5 échéances', 'Photo d’un courrier expliquée'],
  foyer: ['300 messages IA / mois', 'Échéances illimitées', 'Budget du foyer', 'Suivi des abonnements', 'Courriers et lettres de résiliation', 'Photos de tickets et de courriers'],
  artisan: ['2 000 messages IA / mois', 'Devis & factures illimités', 'Devis accepté en ligne par le client', 'Factures d’acompte', 'Montant à déclarer à l’URSSAF', 'Fichier clients et vos prix enregistrés', 'Budget, abonnements & courriers'],
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
    ${state.me.user.lifetime
      ? '<div class="card" style="margin-top:16px">Votre offre Artisan est <strong>gratuite à vie</strong>. Vous n’avez rien à payer.</div>'
      : `${current !== 'gratuit' && !demoBilling ? '<p style="margin-top:16px"><button class="btn" data-portal>Gérer mon abonnement et mes factures</button></p>' : ''}
    <form class="card" id="redeem" style="margin-top:16px">
      <label for="code">Vous avez un code d’accès ?</label>
      <div class="row" style="align-items:center"><input id="code" autocomplete="off" autocapitalize="characters" placeholder="Votre code" required>
        <button class="btn btn-primary">Valider</button></div>
    </form>`}`;
  view.querySelector('#redeem')?.addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(async () => {
      await api('/billing/redeem', { method: 'POST', body: { code: view.querySelector('#code').value } });
      toast('Code validé : offre Artisan gratuite à vie');
      await refreshMe();
      router();
    });
  });
  if (state.me.user.lifetime) view.querySelectorAll('[data-plan],[data-portal]').forEach((b) => b.remove());
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

// ---------- Statistiques (administrateur) ----------
const frShortDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const PLAN_NAMES = { gratuit: 'Gratuit', foyer: 'Foyer', artisan: 'Artisan' };

// Histogramme à une série (barres fines, extrémités arrondies, infobulle au survol, tableau de données).
function barChart(id, title, rows, key, unit) {
  const W = 720, H = 200, PAD_L = 32, PAD_B = 22, PAD_T = 10;
  const max = Math.max(1, ...rows.map((r) => r[key]));
  const step = max <= 4 ? 1 : Math.ceil(max / 4);
  const top = Math.ceil(max / step) * step;
  const plotW = W - PAD_L, plotH = H - PAD_B - PAD_T;
  const slot = plotW / rows.length;
  const barW = Math.min(16, slot - 4);
  const y = (v) => PAD_T + plotH - (v / top) * plotH;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const bars = rows.map((r, i) => {
    const x = PAD_L + i * slot + (slot - barW) / 2;
    const h = (r[key] / top) * plotH;
    if (!h) return '';
    const rad = Math.min(4, h, barW / 2);
    const yb = PAD_T + plotH;
    return `<path class="bar" d="M${x},${yb} V${yb - h + rad} Q${x},${yb - h} ${x + rad},${yb - h} H${x + barW - rad} Q${x + barW},${yb - h} ${x + barW},${yb - h + rad} V${yb} Z"/>`;
  }).join('');
  const hits = rows.map((r, i) =>
    `<rect class="hit" x="${PAD_L + i * slot}" y="${PAD_T}" width="${slot}" height="${plotH}" data-i="${i}"/>`).join('');
  const grid = ticks.map((v) => `<line class="grid" x1="${PAD_L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>
    <text class="axis" x="${PAD_L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const xLabels = rows.map((r, i) => ((rows.length - 1 - i) % 7 === 0)
    ? `<text class="axis" x="${PAD_L + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${frShortDate(r.day)}</text>` : '').join('');
  const total = rows.reduce((t, r) => t + r[key], 0);
  return `<div class="card chart-card" id="${id}">
    <div class="chart-head"><h2>${title}</h2><span class="muted small">${total} sur 30 jours</span></div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} : ${total} sur 30 jours">${grid}${bars}${xLabels}${hits}</svg>
      <div class="chart-tip hidden"></div>
    </div>
    <details class="small"><summary class="muted">Voir les données</summary>
      <div class="table-wrap"><table><thead><tr><th>Jour</th><th class="num">${unit}</th></tr></thead><tbody>
      ${rows.slice().reverse().map((r) => `<tr><td>${frDate(r.day)}</td><td class="num">${r[key]}</td></tr>`).join('')}
      </tbody></table></div>
    </details>
  </div>`;
}

function wireChart(id, rows, key, unit) {
  const card = document.getElementById(id);
  const tip = card.querySelector('.chart-tip');
  const svg = card.querySelector('svg');
  const show = (rect) => {
    const r = rows[Number(rect.dataset.i)];
    tip.innerHTML = `<strong>${r[key]}</strong> ${unit}<br><span class="muted">${frDate(r.day)}</span>`;
    tip.classList.remove('hidden');
    const box = rect.getBoundingClientRect(), wrap = svg.parentElement.getBoundingClientRect();
    const left = Math.min(Math.max(box.left - wrap.left + box.width / 2, 50), wrap.width - 50);
    tip.style.left = `${left}px`;
  };
  card.querySelectorAll('.hit').forEach((rect) => {
    rect.addEventListener('mouseenter', () => show(rect));
    rect.addEventListener('click', () => show(rect));
  });
  svg.addEventListener('mouseleave', () => tip.classList.add('hidden'));
}

async function renderStats() {
  const s = await api('/admin/stats');
  const tiles = [
    ['Visiteurs aujourd’hui', s.visits.today],
    ['Visiteurs sur 7 jours', s.visits.last7],
    ['Visiteurs sur 30 jours', s.visits.last30],
    ['Inscrits au total', s.users.total],
    ['Abonnés payants', s.revenue.payingUsers],
    ['Revenu mensuel estimé', eur(s.revenue.mrr)],
  ];
  const listTable = (rows, cols) => rows.length
    ? `<table><tbody>${rows.map((r) => `<tr>${cols.map((c, i) => `<td class="${i ? 'num' : ''}">${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '<p class="empty">Pas encore de données.</p>';
  view.innerHTML = `
    <div class="main-header"><h1>Statistiques</h1>
      <span class="muted small">Mis à jour ${new Date(s.generatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · <a href="#statistiques" id="refresh">Actualiser</a></span></div>
    <div class="stats">${tiles.map(([l, v]) => `<div class="card stat"><div class="label">${l}</div><div class="value">${esc(v)}</div></div>`).join('')}</div>
    <div class="stack">
      ${barChart('chart-visits', 'Visiteurs par jour', s.daily, 'visitors', 'visiteurs')}
      ${barChart('chart-signups', 'Inscriptions par jour', s.daily, 'signups', 'inscriptions')}
      <div class="two-col">
        <div class="card"><h2>Inscrits par offre</h2>
          <table><tbody>${Object.entries(s.users.byPlan).map(([p, n]) => `<tr><td>${PLAN_NAMES[p] || esc(p)}</td><td class="num">${n}</td></tr>`).join('')}
          <tr><td class="muted">Profils artisan / foyer</td><td class="num muted">${s.users.byType.artisan} / ${s.users.byType.foyer}</td></tr>
          <tr><td class="muted">Taux d’inscription (30 j)</td><td class="num muted">${s.users.conversion == null ? '—' : `${s.users.conversion.toLocaleString('fr-FR')} %`}</td></tr>
          </tbody></table></div>
        <div class="card"><h2>Utilisation</h2>
          <table><tbody>
            <tr><td>Messages à l’assistant IA (ce mois)</td><td class="num">${s.usage.aiMessagesThisMonth}</td></tr>
            <tr><td>Utilisateurs de l’assistant (ce mois)</td><td class="num">${s.usage.aiActiveUsersThisMonth}</td></tr>
            <tr><td>Devis créés</td><td class="num">${s.usage.quotes}</td></tr>
            <tr><td>Factures créées</td><td class="num">${s.usage.invoices}</td></tr>
            <tr><td>Échéances suivies</td><td class="num">${s.usage.echeances}</td></tr>
            <tr><td>Opérations de budget</td><td class="num">${s.usage.transactions}</td></tr>
          </tbody></table></div>
      </div>
      <div class="two-col">
        <div class="card"><h2>Pages les plus vues (30 j)</h2>${listTable(s.visits.topPages, ['page', 'views'])}</div>
        <div class="card"><h2>D’où viennent les visiteurs (30 j)</h2>${listTable(s.visits.topReferrers, ['referrer', 'visitors'])}
          <p class="muted small">Les visites directes (adresse tapée, favoris, applications) n’apparaissent pas ici.</p></div>
      </div>
      <div class="card"><h2>Derniers inscrits</h2>
        ${s.users.recent.length ? `<div class="table-wrap"><table><thead><tr><th>Nom</th><th>Email</th><th>Profil</th><th>Offre</th><th>Inscription</th></tr></thead><tbody>
        ${s.users.recent.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.accountType === 'artisan' ? 'Artisan' : 'Foyer'}</td>
          <td>${PLAN_NAMES[u.plan] || esc(u.plan)}</td><td>${frDate(u.createdAt.slice(0, 10))}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">Aucun inscrit pour le moment.</p>'}
      </div>
      <p class="muted small">Visites comptées sans cookie : un visiteur est compté une fois par jour, ses visites ne sont pas reliées d’un jour à l’autre. Vos propres visites, connecté à ce compte, ne sont pas comptées.</p>
    </div>`;
  wireChart('chart-visits', s.daily, 'visitors', 'visiteurs');
  wireChart('chart-signups', s.daily, 'signups', 'inscriptions');
  document.getElementById('refresh').addEventListener('click', (e) => { e.preventDefault(); router(); });
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
        <div class="field"><label>Adresse</label><textarea name="address" rows="2">${esc(u.address || '')}</textarea></div>
        <div class="field" style="display:flex;gap:8px;align-items:flex-start">
          <input type="checkbox" id="branding" ${u.showBranding ? 'checked' : ''} style="width:auto;margin-top:4px">
          <label for="branding" style="font-weight:400">Afficher la mention discrète « Créé avec MDIA » en bas de mes devis et factures</label>
        </div>
        ${has('documents') ? `<h2 style="margin-top:24px">Message d’envoi aux clients</h2>
        <p class="muted small">Le message joint au PDF quand vous appuyez sur « Envoyer au client ».</p>
        <div class="row">${['devis', 'facture'].map((t) => `
          <div class="field"><label>${t === 'devis' ? 'Devis' : 'Factures'}</label>
            <select data-share="${t}"><option value="">Me demander à chaque fois</option>
              ${SHARE_STYLES.map((s, i) => `<option value="${i}" ${u.shareChoices?.[t] === i ? 'selected' : ''}>${s}</option>`).join('')}
            </select></div>`).join('')}
        </div>` : ''}` : ''}
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
      const body = Object.fromEntries(new FormData(e.target));
      const branding = document.getElementById('branding');
      if (branding) body.showBranding = branding.checked;
      const shareSelects = document.querySelectorAll('[data-share]');
      if (shareSelects.length) {
        body.shareChoices = Object.fromEntries(
          [...shareSelects].filter((s) => s.value !== '').map((s) => [s.dataset.share, Number(s.value)]),
        );
      }
      await api('/me', { method: 'PATCH', body });
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

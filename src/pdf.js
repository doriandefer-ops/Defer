// Génère le PDF d'un devis ou d'une facture (pour le partage : le PDF est joint au message choisi par l'artisan).
const PDFDocument = require('pdfkit');

const GREEN = '#2f5d50';
const MUTED = '#66655f';
const LINE = '#e2e0d8';

// Les polices PDF standard ne connaissent pas les espaces insécables fines utilisées par fr-FR.
const clean = (s) => String(s ?? '').replace(/[  ]/g, ' ');
const eur = (n) => clean(Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }));
const frDate = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : '');
const qty = (n) => clean(Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));

const docTitle = (doc) => (doc.type === 'devis' ? 'Devis' : doc.kind === 'acompte' ? 'Facture d’acompte' : 'Facture');
const frDateTime = (s) => {
  const d = new Date(`${s.replace(' ', 'T')}Z`);
  return `${d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })} à ${d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })}`;
};

function fileName(doc, issuer) {
  const who = (issuer.company_name || issuer.name || '').replace(/[\\/:*?"<>|]/g, '').trim();
  return `${docTitle(doc).replace('’', "'")} ${doc.number}${who ? ` - ${who}` : ''}.pdf`;
}

// link : adresse de la page où le client peut accepter le devis en ligne.
function renderPdf(doc, issuer, { link } = {}) {
  const isQuote = doc.type === 'devis';
  const pdf = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `${docTitle(doc)} ${doc.number}` } });
  const W = pdf.page.width - 100; // largeur utile
  const L = 50;

  // En-tête : titre à gauche, émetteur à droite
  pdf.font('Helvetica-Bold').fontSize(24).fillColor('#1d1d1b').text(docTitle(doc).toUpperCase(), L, 50);
  pdf.font('Helvetica').fontSize(10).fillColor(MUTED);
  pdf.text(`N° ${doc.number}`).text(`Date : ${frDate(doc.issue_date)}`);
  if (doc.due_date) pdf.text(`${isQuote ? 'Valable jusqu’au' : 'Échéance de paiement'} : ${frDate(doc.due_date)}`);

  const boxX = L + W - 220;
  const issuerLines = [issuer.address, issuer.phone, issuer.email, issuer.siret ? `SIRET : ${issuer.siret}` : null]
    .filter(Boolean)
    .map(clean);
  const boxH = 30 + issuerLines.join('\n').split('\n').length * 13;
  pdf.roundedRect(boxX, 45, 220, boxH, 6).fill('#f7f7f4');
  pdf.fillColor('#1d1d1b').font('Helvetica-Bold').fontSize(11).text(clean(issuer.company_name || issuer.name), boxX + 12, 55, { width: 196 });
  pdf.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(issuerLines.join('\n'), { width: 196 });

  // Client
  let y = Math.max(pdf.y, 45 + boxH) + 25;
  if (doc.client) {
    const clientLines = [doc.client.address, doc.client.email].filter(Boolean).map(clean);
    const h = 34 + clientLines.join('\n').split('\n').length * 13;
    pdf.roundedRect(boxX, y, 220, h, 6).fill('#f7f7f4');
    pdf.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(isQuote ? 'DESTINATAIRE' : 'FACTURÉ À', boxX + 12, y + 10);
    pdf.fillColor('#1d1d1b').font('Helvetica-Bold').fontSize(11).text(clean(doc.client.name), { width: 196 });
    pdf.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(clientLines.join('\n'), { width: 196 });
    y += h + 25;
  }

  // Tableau des lignes
  const cols = [
    { label: 'Désignation', x: L, w: W - 300, align: 'left' },
    { label: 'Qté', x: L + W - 300, w: 70, align: 'right' },
    { label: 'Prix unit. HT', x: L + W - 225, w: 80, align: 'right' },
    { label: 'TVA', x: L + W - 140, w: 45, align: 'right' },
    { label: 'Total HT', x: L + W - 90, w: 90, align: 'right' },
  ];
  pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED);
  cols.forEach((c) => pdf.text(c.label.toUpperCase(), c.x, y, { width: c.w, align: c.align }));
  y += 16;
  pdf.moveTo(L, y).lineTo(L + W, y).lineWidth(0.8).strokeColor(LINE).stroke();
  y += 8;
  pdf.font('Helvetica').fontSize(10).fillColor('#1d1d1b');
  for (const it of doc.items) {
    const values = [clean(it.description), `${qty(it.quantity)} ${clean(it.unit)}`, eur(it.unit_price), `${qty(it.vat_rate)} %`, eur(it.total_ht)];
    const h = Math.max(...values.map((v, i) => pdf.heightOfString(v, { width: cols[i].w })));
    if (y + h > pdf.page.height - 160) {
      pdf.addPage();
      y = 50;
    }
    values.forEach((v, i) => pdf.text(v, cols[i].x, y, { width: cols[i].w, align: cols[i].align }));
    y += h + 8;
    pdf.moveTo(L, y - 4).lineTo(L + W, y - 4).lineWidth(0.5).strokeColor(LINE).stroke();
  }

  // Totaux (TVA détaillée par taux)
  const byRate = {};
  doc.items.forEach((it) => (byRate[it.vat_rate] = (byRate[it.vat_rate] || 0) + (it.total_ht * it.vat_rate) / 100));
  y += 10;
  const tx = L + W - 220;
  const row = (label, value, bold = false) => {
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor('#1d1d1b');
    pdf.text(label, tx, y, { width: 120 });
    pdf.text(value, tx + 120, y, { width: 100, align: 'right' });
    y += bold ? 20 : 16;
  };
  row('Total HT', eur(doc.total_ht));
  Object.entries(byRate).forEach(([r, v]) => row(`TVA ${qty(r)} %`, eur(Math.round(v * 100) / 100)));
  pdf.moveTo(tx, y).lineTo(L + W, y).lineWidth(1.2).strokeColor('#1d1d1b').stroke();
  y += 6;
  row('Total TTC', eur(doc.total_ttc), true);

  // Notes, mentions
  pdf.font('Helvetica').fontSize(10).fillColor('#1d1d1b');
  if (doc.notes) pdf.text(clean(doc.notes), L, y + 10, { width: W });
  let signed = false;
  if (isQuote && doc.accepted_at) {
    signed = true;
    pdf.moveDown(1.5).font('Helvetica-Bold').fillColor(GREEN)
      .text(`Devis accepté en ligne le ${frDateTime(doc.accepted_at)} par ${clean(doc.accepted_name)}.`, L, undefined, { width: W });
    pdf.font('Helvetica').fillColor('#1d1d1b');
  } else if (isQuote) {
    if (link) {
      pdf.moveDown(1.5).font('Helvetica-Bold').text('Acceptez ce devis en ligne, en un clic :', L, undefined, { width: W });
      pdf.font('Helvetica').fillColor(GREEN).text(link, { width: W, link, underline: true });
      pdf.fillColor('#1d1d1b').moveDown(0.8).text('Ou renvoyez-le signé :', { width: W });
    }
    pdf.moveDown(link ? 0.3 : 1.5).text('Bon pour accord — date et signature du client :', L, undefined, { width: W });
  }
  pdf.moveDown(isQuote && !signed ? 4 : 2).fontSize(8).fillColor(MUTED);
  pdf.text(
    isQuote
      ? 'Devis gratuit. Les prix sont exprimés en euros.'
      : 'En cas de retard de paiement, des pénalités au taux de trois fois le taux d’intérêt légal sont exigibles, ainsi qu’une indemnité forfaitaire de 40 € pour frais de recouvrement (art. L441-10 du Code de commerce). Pas d’escompte pour paiement anticipé.',
    L,
    undefined,
    { width: W },
  );
  if (Number(doc.total_tva) === 0) pdf.text('TVA non applicable, art. 293 B du CGI.', { width: W });
  if (issuer.show_branding !== 0) {
    pdf.moveDown(1).fillColor('#9a998f').fontSize(7.5).text('Document créé avec MDIA — mdia-eu.onrender.com', { width: W, align: 'right', link: 'https://mdia-eu.onrender.com/?utm=document' });
  }
  pdf.fillColor(GREEN);
  return pdf;
}

module.exports = { renderPdf, fileName };

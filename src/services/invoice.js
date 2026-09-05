// src/services/invoice.js
//
// Generates a "Facture" PDF matching the layout of the sample invoice
// (Facture N°, Vol N°, Provenance/Destination, Nature, Nbre de colis,
// LTA N°, Poids brut, ICE, pricing table, TVA 20%, montant en lettres).
//
// Returns a Buffer - the route handler is responsible for saving it to
// the Invoice table (as `pdfData`) and attaching it to the "order arrived"
// email.

const PDFDocument = require('pdfkit');

const UNITS = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante-dix', 'quatre-vingt', 'quatre-vingt-dix'];

/** Minimal French number-to-words converter, good enough for invoice totals. */
function numberToFrenchWords(n) {
  n = Math.floor(n);
  if (n === 0) return 'zéro';

  function belowThousand(num) {
    if (num < 20) return UNITS[num];
    if (num < 100) {
      const ten = Math.floor(num / 10);
      const unit = num % 10;
      if (ten === 7 || ten === 9) {
        return TENS[ten - 1] + '-' + UNITS[10 + unit];
      }
      let word = TENS[ten];
      if (unit === 1 && ten !== 8) word += '-et-un';
      else if (unit > 0) word += '-' + UNITS[unit];
      if (ten === 8 && unit === 0) word += 's';
      return word;
    }
    const hundred = Math.floor(num / 100);
    const rest = num % 100;
    let word = hundred === 1 ? 'cent' : UNITS[hundred] + ' cent';
    if (hundred > 1 && rest === 0) word += 's';
    if (rest > 0) word += ' ' + belowThousand(rest);
    return word;
  }

  const parts = [];
  const millions = Math.floor(n / 1000000);
  const thousands = Math.floor((n % 1000000) / 1000);
  const rest = n % 1000;

  if (millions > 0) parts.push(belowThousand(millions) + (millions > 1 ? ' millions' : ' million'));
  if (thousands > 0) parts.push((thousands === 1 ? '' : belowThousand(thousands) + ' ') + 'mille');
  if (rest > 0) parts.push(belowThousand(rest));

  return parts.join(' ') || 'zéro';
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * @param {object} params
 * @param {string} params.invoiceNumber
 * @param {Date}   params.date
 * @param {string} params.clientName
 * @param {string} params.flightNumber
 * @param {string} params.provenance
 * @param {string} params.destination
 * @param {string} params.nature
 * @param {number} params.packages
 * @param {string} params.lta
 * @param {number} params.weightKg
 * @param {string} [params.ice]
 * @param {number} params.amountHT
 * @param {number} params.amountTVA
 * @param {number} params.amountTTC
 * @param {string} [params.currency] - default 'DHS'
 * @returns {Promise<Buffer>}
 */
function generateInvoicePdf(params) {
  const {
    invoiceNumber, date, clientName, flightNumber, provenance, destination,
    nature, packages, lta, weightKg, ice, amountHT, amountTVA, amountTTC,
    currency = 'DHS'
  } = params;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('United Transport Solutions', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor('#4E657E')
      .text('Fret aérien — Casablanca, Maroc', { align: 'left' });
    doc.fillColor('#000000');
    doc.moveDown(1);

    // Facture N° / Date row
    doc.fontSize(11).font('Helvetica-Bold');
    doc.text(`FACTURE N° : ${invoiceNumber}`, { continued: true }).font('Helvetica').text(`     DATE : ${date.toLocaleDateString('fr-FR')}`);
    doc.moveDown(0.8);

    // Details box
    const boxTop = doc.y;
    doc.rect(doc.page.margins.left, boxTop, pageWidth, 130).stroke();
    doc.fontSize(10).font('Helvetica');
    let y = boxTop + 10;
    const lineGap = 16;
    const col1X = doc.page.margins.left + 12;

    function row(label, value) {
      doc.font('Helvetica-Bold').text(`${label} : `, col1X, y, { continued: true });
      doc.font('Helvetica').text(value || '—');
      y += lineGap;
    }

    row('CLIENT', clientName);
    row('VOL N°', flightNumber);
    row('PROVENANCE', provenance);
    row('DESTINATION', destination);
    row('NATURE', nature);
    row('NBRE DE COLIS', packages != null ? String(packages) : '—');
    row('LTA N°', lta);
    row('POIDS BRUT', weightKg != null ? `${weightKg} KG` : '—');
    row('ICE', ice || '—');

    doc.y = boxTop + 130 + 20;

    // Pricing table
    const tableTop = doc.y;
    const colWidths = [pageWidth * 0.4, pageWidth * 0.15, pageWidth * 0.2, pageWidth * 0.25];
    const headers = ['Désignation', 'Qté', 'Taxable', 'Non Taxable'];
    let x = doc.page.margins.left;

    doc.font('Helvetica-Bold').fontSize(10);
    headers.forEach((h, i) => {
      doc.rect(x, tableTop, colWidths[i], 22).stroke();
      doc.text(h, x + 4, tableTop + 6, { width: colWidths[i] - 8 });
      x += colWidths[i];
    });

    // Row: Fret aérien
    let rowY = tableTop + 22;
    x = doc.page.margins.left;
    const rowValues = ['Fret aérien', '', '', `${amountHT.toFixed(2)} ${currency}`];
    doc.font('Helvetica');
    rowValues.forEach((v, i) => {
      doc.rect(x, rowY, colWidths[i], 22).stroke();
      doc.text(v, x + 4, rowY + 6, { width: colWidths[i] - 8 });
      x += colWidths[i];
    });

    // Totals rows
    function totalRow(label, value, bold = false) {
      rowY += 22;
      x = doc.page.margins.left;
      const widths = [colWidths[0] + colWidths[1] + colWidths[2], colWidths[3]];
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      doc.rect(x, rowY, widths[0], 22).stroke();
      doc.text(label, x + 4, rowY + 6);
      x += widths[0];
      doc.rect(x, rowY, widths[1], 22).stroke();
      doc.text(value, x + 4, rowY + 6, { width: widths[1] - 8 });
    }

    totalRow('TOTAL H.T', `${amountHT.toFixed(2)} ${currency}`, true);
    totalRow('TVA 20%', `${amountTVA.toFixed(2)} ${currency}`);
    totalRow('TOTAL TTC', `${amountTTC.toFixed(2)} ${currency}`, true);

    doc.y = rowY + 22 + 30;

    // Amount in words
    const words = capitalize(numberToFrenchWords(Math.round(amountTTC)));
    doc.font('Helvetica-Bold').fontSize(10)
      .text('Arrêtée la présente facture à la somme de :', doc.page.margins.left, doc.y);
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text(`${words} Dirhams`);

    doc.end();
  });
}

module.exports = { generateInvoicePdf, numberToFrenchWords };

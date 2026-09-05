// src/services/invoicePdf.js
//
// Generates the Facture/Invoice as a real PDF using pdfkit, for French and
// English. This exists specifically because .docx files get re-laid-out
// by whatever program opens them (Word, Google Docs, LibreOffice all
// interpret table/margin edge-cases differently) - a PDF's layout is
// fixed at generation time and looks identical everywhere.
//
// Arabic is NOT generated here - it stays on the .docx path (see
// invoice.js) because pdfkit's built-in fonts cannot shape Arabic script
// (no contextual letter joining, no RTL reordering), and this sandbox has
// no way to embed+shape a proper Arabic font without a real text-layout
// engine (see project notes). Opening a .docx in Word/LibreOffice/Google
// Docs handles that shaping correctly, which is why Arabic invoices are
// still delivered as .docx.

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'images', 'uts-logo.png');

const COLORS = {
  navy: '#082E67',
  navyLabel: '#082E67',
  valueBlue: '#537AA8',
  subtitleBlue: '#456C9B',
  headerBlue: '#1769AA',
  headerGreen: '#2AAA38',
  totalsLight: '#DCEBFA',
  border: '#A8C4E6',
  footerGray: '#35597C',
  white: '#FFFFFF',
  black: '#111111'
};

const LABELS = {
  fr: {
    title: 'FACTURE',
    subtitle: 'UNITED TRANSPORT SOLUTIONS',
    invoiceNumber: 'Facture N° :', date: 'Date :', flightNumber: 'Vol N° :', volume: 'Volume :',
    provenance: 'Provenance :', destination: 'Destination :', nature: 'Nature :', packages: 'Nbre de colis :',
    lta: 'LTA N° :', weight: 'Poids brut :', ice: 'ICE :',
    designation: 'Désignation', qte: 'Qté', taxable: 'Taxable', nonTaxable: 'Non Taxable',
    totalHT: 'TOTAL H.T', tva: 'TVA 20%', totalTTC: 'TOTAL TTC',
    amountWords: 'Arrêtée la présente facture à la somme de :',
    companyLine1: 'UNITED TRANSPORT SOLUTIONS INTERNATIONAL - SARL',
    footerIcons: ['FRET AÉRIEN', 'SOLUTIONS LOGISTIQUES'],
    defaultDesignation: 'Fret aérien'
  },
  en: {
    title: 'INVOICE',
    subtitle: 'UNITED TRANSPORT SOLUTIONS',
    invoiceNumber: 'Invoice No. :', date: 'Date :', flightNumber: 'Flight No. :', volume: 'Volume :',
    provenance: 'Origin :', destination: 'Destination :', nature: 'Nature of goods :', packages: 'No. of packages :',
    lta: 'AWB No. :', weight: 'Gross weight :', ice: 'ICE :',
    designation: 'Description', qte: 'Qty', taxable: 'Taxable', nonTaxable: 'Non-Taxable',
    totalHT: 'SUBTOTAL EXCL. TAX', tva: 'VAT 20%', totalTTC: 'TOTAL INCL. TAX',
    amountWords: 'This invoice is issued for the total amount of:',
    companyLine1: 'UNITED TRANSPORT SOLUTIONS INTERNATIONAL - SARL',
    footerIcons: ['AIR FREIGHT', 'LOGISTICS SOLUTIONS'],
    defaultDesignation: 'Air freight'
  }
};

const COMPANY_ADDRESS = '13 Rue Al Kassar 5ème étage N° 10 Maarif, 20200 CASABLANCA';
const COMPANY_CONTACT = 'Tél : 0700172779 / 0522 99 24 99  -  Email: united.transport.solutions9@gmail.com';
const COMPANY_LEGAL = 'RC 577359 / IF: 53698033   CNSS : 4750723   ICE: 003246421000004 / PATENTE : 35705314';

const PAGE_W = 595.28;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

const FR_UNITS = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const FR_TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante-dix', 'quatre-vingt', 'quatre-vingt-dix'];

function numberToFrenchWords(n) {
  n = Math.floor(n);
  if (n === 0) return 'zéro';

  function belowThousand(num) {
    if (num < 20) return FR_UNITS[num];
    if (num < 100) {
      const ten = Math.floor(num / 10);
      const unit = num % 10;
      if (ten === 7 || ten === 9) return FR_TENS[ten - 1] + '-' + FR_UNITS[10 + unit];
      let word = FR_TENS[ten];
      if (unit === 1 && ten !== 8) word += '-et-un';
      else if (unit > 0) word += '-' + FR_UNITS[unit];
      if (ten === 8 && unit === 0) word += 's';
      return word;
    }
    const hundred = Math.floor(num / 100);
    const rest = num % 100;
    let word = hundred === 1 ? 'cent' : FR_UNITS[hundred] + ' cent';
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

const EN_UNITS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numberToEnglishWords(n) {
  n = Math.floor(n);
  if (n === 0) return 'zero';

  function belowThousand(num) {
    if (num < 20) return EN_UNITS[num];
    if (num < 100) {
      const ten = Math.floor(num / 10);
      const unit = num % 10;
      return EN_TENS[ten] + (unit > 0 ? '-' + EN_UNITS[unit] : '');
    }
    const hundred = Math.floor(num / 100);
    const rest = num % 100;
    return EN_UNITS[hundred] + ' hundred' + (rest > 0 ? ' and ' + belowThousand(rest) : '');
  }

  const parts = [];
  const millions = Math.floor(n / 1000000);
  const thousands = Math.floor((n % 1000000) / 1000);
  const rest = n % 1000;
  if (millions > 0) parts.push(belowThousand(millions) + ' million');
  if (thousands > 0) parts.push(belowThousand(thousands) + ' thousand');
  if (rest > 0) parts.push(belowThousand(rest));
  return parts.join(' ') || 'zero';
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/**
 * @param {object} p - same shape as generateInvoiceDocx's params, minus lang restriction (fr/en only here)
 * @returns {Buffer}
 */
function generateInvoicePdf(p) {
  const lang = p.lang === 'en' ? 'en' : 'fr';
  const L = LABELS[lang];

  const taxType = p.taxType === 'taxable' ? 'taxable' : 'nonTaxable';
  const montant = p.montant || 0;
  const taxable = taxType === 'taxable' ? montant : 0;
  const nonTaxable = taxType === 'nonTaxable' ? montant : 0;
  const amountHT = Math.round((taxable + nonTaxable) * 100) / 100;
  const amountTVA = Math.round(taxable * 0.20 * 100) / 100;
  const amountTTC = Math.round((amountHT + amountTVA) * 100) / 100;
  const wordsFn = lang === 'en' ? numberToEnglishWords : numberToFrenchWords;
  const amountWordsText = `${capitalize(wordsFn(Math.round(amountTTC)))} ${lang === 'en' ? 'Dirhams' : 'Dirhams'}`;

  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));

  let y = MARGIN;
  const dateLocale = lang === 'en' ? 'en-GB' : 'fr-FR';
  const dateStr = p.date ? p.date.toLocaleDateString(dateLocale) : '';

  // --- Logo -----------------------------------------------------------
  if (fs.existsSync(LOGO_PATH)) {
    const logoW = 320;
    const logoH = logoW * (724 / 2172);
    doc.image(LOGO_PATH, (PAGE_W - logoW) / 2, y, { width: logoW, height: logoH });
    y += logoH + 14;
  }

  // --- Title ------------------------------------------------------------
  doc.font('Helvetica-Bold').fontSize(24).fillColor(COLORS.navy);
  doc.text(L.title, MARGIN, y, { width: CONTENT_W, align: 'center' });
  y += 32;

  // --- 3-segment header bar --------------------------------------------
  const barH = 26;
  const seg = CONTENT_W / 3;
  doc.rect(MARGIN, y, seg, barH).fill(COLORS.headerBlue);
  doc.rect(MARGIN + seg, y, seg, barH).fill(COLORS.white);
  doc.rect(MARGIN + seg * 2, y, seg, barH).fill(COLORS.headerGreen);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.subtitleBlue);
  doc.text((p.clientName || '').toUpperCase(), MARGIN + seg, y + 8, { width: seg, align: 'center' });
  y += barH + 14;

  // --- Info table (5 rows x 2 cols, "Label : value" per cell) ----------
  const rowH = 24;
  const colW = CONTENT_W / 2;
  const infoRows = [
    [`${L.invoiceNumber} ${p.invoiceNumber || ''}`, `${L.date} ${dateStr}`],
    [`${L.flightNumber} ${p.flightNumber || '—'}`, `${L.volume} ${p.volume || '—'}`],
    [`${L.provenance} ${p.provenance || ''}`, `${L.destination} ${p.destination || ''}`],
    [`${L.nature} ${p.nature || ''}`, `${L.packages} ${p.packages != null ? p.packages : '—'}`],
    [`${L.lta} ${p.lta || '—'}`, null] // row 4 col2 handled specially below (two values)
  ];

  

  for (let i = 0; i < 5; i++) {
    const rowY = y + i * rowH;
    doc.rect(MARGIN, rowY, colW, rowH).fillAndStroke('#F8FBFE', COLORS.border);
    doc.rect(MARGIN + colW, rowY, colW, rowH).fillAndStroke('#F8FBFE', COLORS.border);

    // Left cell
    const leftFull = infoRows[i][0];
    let idx = leftFull.indexOf(':');
    doc.fillColor(COLORS.navyLabel).font('Helvetica-Bold').fontSize(10);
    doc.text(leftFull.slice(0, idx + 1), MARGIN + 8, rowY + 7, { continued: true });
    doc.font('Helvetica').fillColor(COLORS.valueBlue).text(leftFull.slice(idx + 1));

    // Right cell
    if (i < 4) {
      const rightFull = infoRows[i][1];
      idx = rightFull.indexOf(':');
      doc.fillColor(COLORS.navyLabel).font('Helvetica-Bold').fontSize(10);
      doc.text(rightFull.slice(0, idx + 1), MARGIN + colW + 8, rowY + 7, { continued: true });
      doc.font('Helvetica').fillColor(COLORS.valueBlue).text(rightFull.slice(idx + 1));
    } else {
      // Row 4 right cell: weight + ICE, two independent values on one line
      doc.fillColor(COLORS.navyLabel).font('Helvetica-Bold').fontSize(10);
      doc.text(L.weight, MARGIN + colW + 8, rowY + 7, { continued: true });
      doc.font('Helvetica').fillColor(COLORS.valueBlue)
        .text(` ${p.weightKg != null ? p.weightKg : '—'} kg     `, { continued: true });
      doc.font('Helvetica-Bold').fillColor(COLORS.navyLabel).text(L.ice, { continued: true });
      doc.font('Helvetica').fillColor(COLORS.valueBlue).text(` ${p.ice || '—'}`);
    }
  }
  y += rowH * 5 + 14;

  // --- Pricing table ------------------------------------------------------
  const pCol = [0.35, 0.15, 0.25, 0.25].map((f) => f * CONTENT_W);
  const pX = [MARGIN, MARGIN + pCol[0], MARGIN + pCol[0] + pCol[1], MARGIN + pCol[0] + pCol[1] + pCol[2]];
  const headerH = 26;

  doc.rect(MARGIN, y, CONTENT_W, headerH).fill(COLORS.headerBlue);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLORS.white);
  const headerTexts = [L.designation, L.qte, L.taxable, L.nonTaxable];
  for (let c = 0; c < 4; c++) {
    doc.text(headerTexts[c], pX[c], y + 8, { width: pCol[c], align: 'center' });
  }
  y += headerH;

  const dataRowH = 20;
  const numDataRows = 8;
  const lineTaxable = taxable > 0 ? `${taxable.toFixed(2)} DHS` : '0.00 DHS';
  const lineNonTaxable = nonTaxable > 0 ? `${nonTaxable.toFixed(2)} DHS` : '0.00 DHS';
  const rowValues = [p.designation || L.defaultDesignation, p.qte != null ? String(p.qte) : '1', lineTaxable, lineNonTaxable];

  for (let r = 0; r < numDataRows; r++) {
    const rowY = y + r * dataRowH;
    for (let c = 0; c < 4; c++) {
      doc.rect(pX[c], rowY, pCol[c], dataRowH).stroke(COLORS.border);
    }
    if (r === 0) {
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.black);
      doc.text(rowValues[0], pX[0] + 8, rowY + 6, { width: pCol[0] - 16 });
      doc.text(rowValues[1], pX[1] + 8, rowY + 6, { width: pCol[1] - 16 });
      doc.text(rowValues[2], pX[2] + 8, rowY + 6, { width: pCol[2] - 16 });
      doc.text(rowValues[3], pX[3] + 8, rowY + 6, { width: pCol[3] - 16 });
    }
  }
  y += dataRowH * numDataRows;

  // --- Totals -------------------------------------------------------------
  const totalsRows = [
    { label: L.totalHT, value: amountHT, bg: COLORS.totalsLight, fg: COLORS.navy },
    { label: L.tva, value: amountTVA, bg: COLORS.totalsLight, fg: COLORS.navy },
    { label: L.totalTTC, value: amountTTC, bg: COLORS.headerBlue, fg: COLORS.white }
  ];
  const labelW = pCol[0] + pCol[1];
  for (const row of totalsRows) {
    doc.rect(MARGIN, y, labelW, dataRowH).fill(row.bg);
    doc.rect(pX[2], y, pCol[2], dataRowH).stroke(COLORS.border);
    doc.rect(pX[3], y, pCol[3], dataRowH).stroke(COLORS.border);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(row.fg);
    doc.text(row.label, MARGIN, y + 6, { width: labelW, align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.black);
    const valueText = `${row.value.toFixed(2)} DHS`;
    if (taxType === 'taxable') {
      doc.text(valueText, pX[2] + 8, y + 6, { width: pCol[2] - 16 });
    } else {
      doc.text(valueText, pX[3] + 8, y + 6, { width: pCol[3] - 16 });
    }
    y += dataRowH;
  }
  y += 16;

  // --- Amount in words ------------------------------------------------
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.navy);
  doc.text(L.amountWords, MARGIN, y, { continued: true });
  doc.font('Helvetica').fillColor(COLORS.valueBlue).text(`  ${amountWordsText}`);
  y += 24;

  // --- Footer (pinned near bottom) ------------------------------------
  const footerY = 750;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.navy);
  doc.text(L.companyLine1, MARGIN, footerY, { width: 320 });
  doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.footerGray);
  doc.text(COMPANY_ADDRESS, MARGIN, footerY + 13, { width: 320 });
  doc.text(COMPANY_CONTACT, MARGIN, footerY + 24, { width: 320 });
  doc.text(COMPANY_LEGAL, MARGIN, footerY + 35, { width: 320 });

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.headerBlue);
  doc.text(`•  ${L.footerIcons[0]}`, MARGIN + 340, footerY, { width: 175 });
  doc.fillColor(COLORS.headerGreen);
  doc.text(`•  ${L.footerIcons[1]}`, MARGIN + 340, footerY + 13, { width: 175 });

  doc.rect(MARGIN, footerY + 50, 100, 2).fill(COLORS.headerBlue);
  doc.rect(MARGIN + 100, footerY + 50, 80, 2).fill(COLORS.headerGreen);

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

module.exports = { generateInvoicePdf };

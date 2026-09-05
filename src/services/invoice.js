// src/services/invoice.js
//
// Generates the actual Facture/Invoice document by filling in the real
// Word templates (assets/templates/facture_{fr,en,ar}.docx) using
// docxtemplater. Output stays a .docx file - NOT converted to PDF -
// because:
//   1. Rendering Arabic script correctly (shaping + right-to-left) needs
//      a real text-layout engine. This sandbox has no LibreOffice
//      available, and PDFKit's built-in fonts can't shape Arabic at all.
//   2. A .docx that Word/LibreOffice/Google Docs opens will always shape
//      and display the Arabic correctly, since we're just writing
//      structured text - not rasterizing it ourselves.
//   Sending a professional Word invoice as an email attachment is a
//   completely normal business practice.

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const TEMPLATES = {
  fr: path.join(__dirname, '..', '..', 'assets', 'templates', 'facture_fr.docx'),
  en: path.join(__dirname, '..', '..', 'assets', 'templates', 'facture_en.docx'),
  ar: path.join(__dirname, '..', '..', 'assets', 'templates', 'facture_ar.docx')
};

const DESIGNATION = {
  fr: 'Fret aérien',
  en: 'Air freight',
  ar: 'الشحن الجوي'
};

// ---------------------------------------------------------------------------
// Number-to-words, one implementation per language, for the
// "amount in words" line every invoice ends with.
// ---------------------------------------------------------------------------

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

// Arabic amount-in-words ("تفقيط"). Implements the standard pattern used
// in financial documents. NOTE: Arabic number/noun grammatical agreement
// (gender polarity, dual forms) has many edge cases - this covers the
// common ones well but a native speaker should spot-check real invoices.
const AR_UNITS = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = ['', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

function numberToArabicWords(n) {
  n = Math.floor(n);
  if (n === 0) return 'صفر';

  function belowThousand(num) {
    if (num === 0) return '';
    if (num < 20) return AR_UNITS[num];
    if (num < 100) {
      const ten = Math.floor(num / 10);
      const unit = num % 10;
      if (unit === 0) return AR_TENS[ten];
      return AR_UNITS[unit] + ' و' + AR_TENS[ten];
    }
    const hundred = Math.floor(num / 100);
    const rest = num % 100;
    let word = AR_HUNDREDS[hundred];
    if (rest > 0) word += ' و' + belowThousand(rest);
    return word;
  }

  const parts = [];
  const millions = Math.floor(n / 1000000);
  const thousands = Math.floor((n % 1000000) / 1000);
  const rest = n % 1000;

  if (millions > 0) {
    if (millions === 1) parts.push('مليون');
    else if (millions === 2) parts.push('مليونان');
    else parts.push(belowThousand(millions) + ' مليون');
  }
  if (thousands > 0) {
    if (thousands === 1) parts.push('ألف');
    else if (thousands === 2) parts.push('ألفان');
    else if (thousands <= 10) parts.push(belowThousand(thousands) + ' آلاف');
    else parts.push(belowThousand(thousands) + ' ألفاً');
  }
  if (rest > 0) parts.push(belowThousand(rest));

  return parts.join(' و') || 'صفر';
}

function numberToWords(n, lang) {
  if (lang === 'en') return numberToEnglishWords(n);
  if (lang === 'ar') return numberToArabicWords(n);
  return numberToFrenchWords(n);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CURRENCY_WORD = { fr: 'Dirhams', en: 'Dirhams', ar: 'درهم' };

/**
 * @param {object} params
 * @param {string} params.lang - 'fr' | 'en' | 'ar', defaults to 'fr'
 * @param {string} params.invoiceNumber
 * @param {Date}   params.date
 * @param {string} params.flightNumber
 * @param {string} params.provenance
 * @param {string} params.destination
 * @param {string} params.nature
 * @param {number} params.packages
 * @param {string} params.lta
 * @param {number} params.weightKg
 * @param {string} [params.ice]
 * @param {string} [params.designation] - defaults to "Fret aérien" / "Air freight" / "الشحن الجوي"
 * @param {number} [params.qte] - defaults to 1
 * @param {number} params.taxable - montant soumis à la TVA
 * @param {number} params.nonTaxable - montant hors champ de la TVA
 * @param {string} [params.volume]
 * @returns {Buffer}
 */
function generateInvoiceDocx(params) {
  const lang = TEMPLATES[params.lang] ? params.lang : 'fr';
  const templatePath = TEMPLATES[lang];

  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

  const dateLocale = lang === 'en' ? 'en-GB' : 'fr-FR';
  const taxable = params.taxable || 0;
  const nonTaxable = params.nonTaxable || 0;
  const amountHT = Math.round((taxable + nonTaxable) * 100) / 100;
  const amountTVA = Math.round(taxable * 0.20 * 100) / 100;
  const amountTTC = Math.round((amountHT + amountTVA) * 100) / 100;
  const words = capitalize(numberToWords(Math.round(amountTTC), lang));

  doc.render({
    invoiceNumber: params.invoiceNumber || '',
    date: params.date ? params.date.toLocaleDateString(dateLocale) : '',
    flightNumber: params.flightNumber || '—',
    volume: params.volume || '—',
    provenance: params.provenance || '',
    destination: params.destination || '',
    nature: params.nature || '',
    packages: params.packages != null ? String(params.packages) : '—',
    lta: params.lta || '—',
    weightKg: params.weightKg != null ? String(params.weightKg) : '—',
    ice: params.ice || '—',
    designation: params.designation || DESIGNATION[lang],
    qte: params.qte != null ? String(params.qte) : '1',
    taxable: `${taxable.toFixed(2)} DHS`,
    nonTaxable: `${nonTaxable.toFixed(2)} DHS`,
    amountHT: amountHT.toFixed(2),
    amountTVA: amountTVA.toFixed(2),
    amountTTC: amountTTC.toFixed(2),
    amountWords: `${words} ${CURRENCY_WORD[lang]}`
  });

  return { buffer: doc.getZip().generate({ type: 'nodebuffer' }), amountHT, amountTVA, amountTTC };
}

module.exports = { generateInvoiceDocx, numberToFrenchWords, numberToEnglishWords, numberToArabicWords };

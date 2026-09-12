// src/services/excelReports.js
//
// Generates downloadable .xlsx versions of the three reports, one month at
// a time (Recouvrement is not split by month, per how that report works).

const ExcelJS = require('exceljs');

const FULL_COLUMNS = [
  { header: 'Ordre Facture', key: 'invoiceNumber', width: 14 },
  { header: 'LTA', key: 'lta', width: 16 },
  { header: 'Fournisseur', key: 'fournisseur', width: 14 },
  { header: 'Date', key: 'date', width: 12 },
  { header: 'Colis', key: 'colis', width: 8 },
  { header: 'Poids Kg', key: 'poidsKg', width: 10 },
  { header: 'Poids Vol', key: 'poidsVol', width: 10 },
  { header: 'Nature', key: 'nature', width: 14 },
  { header: 'Dest', key: 'dest', width: 8 },
  { header: 'Client', key: 'client', width: 20 },
  { header: 'Tarif AF', key: 'tarifAF', width: 10 },
  { header: 'Tarif UTS', key: 'tarifUTS', width: 10 },
  { header: 'Fact Comp', key: 'factComp', width: 12 },
  { header: 'Fact Nego/Autre', key: 'factNego', width: 14 },
  { header: 'Facturation UTS', key: 'facturationUTS', width: 15 },
  { header: 'Nette UTS', key: 'netteUTS', width: 12 },
  { header: 'Autre Frais', key: 'autreFrais', width: 12 },
  { header: 'Statut', key: 'statut', width: 12 },
  { header: 'Mode Régl.', key: 'mode', width: 12 },
  { header: 'Date Régl.', key: 'dateRegl', width: 12 }
];

function rowFromInvoice(inv) {
  return {
    invoiceNumber: inv.invoiceNumber,
    lta: inv.lta || '',
    fournisseur: inv.fournisseur || '',
    date: inv.createdAt ? new Date(inv.createdAt) : null,
    colis: inv.client?.packages ?? '',
    poidsKg: inv.client?.weightKg ?? '',
    poidsVol: inv.poidsVol ?? '',
    nature: inv.client?.nature || '',
    dest: inv.client?.destination || '',
    client: inv.client?.name || '',
    tarifAF: inv.flatRate ? '' : (inv.tarifAF ?? ''),
    tarifUTS: inv.flatRate ? '' : (inv.tarifUTS ?? ''),
    factComp: inv.factComp ?? '',
    factNego: inv.factNego ?? '',
    facturationUTS: inv.facturationUTS ?? inv.amountTTC ?? '',
    netteUTS: inv.netteUTS ?? '',
    autreFrais: inv.autreFrais ?? '',
    statut: inv.paid ? 'REGLÉ' : 'EN ATTENTE',
    mode: inv.paidMode || '',
    dateRegl: inv.paidDate ? new Date(inv.paidDate) : null
  };
}

function styleHeader(sheet) {
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  ['date', 'dateRegl'].forEach((key) => {
    try {
      const col = sheet.getColumn(key);
      if (col) col.numFmt = 'dd/mm/yyyy';
    } catch (err) {
      // column doesn't exist on this sheet - fine, just skip formatting it
    }
  });
}

async function generateFacturesExcel(invoices, label) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Factures ${label}`.slice(0, 31));
  sheet.columns = FULL_COLUMNS;
  invoices.forEach((inv) => sheet.addRow(rowFromInvoice(inv)));
  styleHeader(sheet);
  return workbook.xlsx.writeBuffer();
}

async function generateCashExcel(invoices, label) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Cash ${label}`.slice(0, 31));
  sheet.columns = FULL_COLUMNS;
  invoices.forEach((inv) => sheet.addRow(rowFromInvoice(inv)));
  styleHeader(sheet);
  return workbook.xlsx.writeBuffer();
}

async function generateRecouvrementExcel(invoices) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Recouvrement');
  sheet.columns = [
    { header: 'LTA', key: 'lta', width: 16 },
    { header: 'Client', key: 'client', width: 20 },
    { header: 'N° Facture', key: 'invoiceNumber', width: 14 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Montant dû', key: 'montant', width: 14 },
    { header: 'Note', key: 'note', width: 24 }
  ];
  invoices.forEach((inv) => {
    sheet.addRow({
      lta: inv.lta || '',
      client: inv.client?.name || '',
      invoiceNumber: inv.isPlaceholder ? 'S/F' : inv.invoiceNumber,
      date: inv.createdAt ? new Date(inv.createdAt) : null,
      montant: inv.facturationUTS ?? inv.amountTTC ?? '',
      note: inv.notes || (inv.isPlaceholder ? 'Sans facture' : '')
    });
  });
  sheet.getColumn('date').numFmt = 'dd/mm/yyyy';
  styleHeader(sheet);
  return workbook.xlsx.writeBuffer();
}

module.exports = { generateFacturesExcel, generateCashExcel, generateRecouvrementExcel };

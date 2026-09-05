// src/services/report.js
const PDFDocument = require('pdfkit');

/**
 * @param {object} data
 * @param {string} data.monthLabel - e.g. "September 2026"
 * @param {Array}  data.invoices - [{invoiceNumber, clientName, amountTTC, createdAt}]
 * @param {object} data.counts - {shipped, late, problem, cancelled}
 * @param {number} data.totalRevenue
 */
function generateMonthlyReportPdf(data) {
  const { monthLabel, invoices, counts, totalRevenue } = data;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).font('Helvetica-Bold').text('United Transport Solutions');
    doc.fontSize(12).font('Helvetica').fillColor('#4E657E').text(`Rapport mensuel — ${monthLabel}`);
    doc.fillColor('#000000');
    doc.moveDown(1.5);

    doc.fontSize(11).font('Helvetica-Bold').text('Résumé');
    doc.font('Helvetica').fontSize(10);
    doc.text(`Commandes livrées (factures émises) : ${invoices.length}`);
    doc.text(`Chiffre d'affaires total (TTC) : ${totalRevenue.toFixed(2)} DHS`);
    doc.text(`Envois expédiés : ${counts.shipped}`);
    doc.text(`Retards signalés : ${counts.late}`);
    doc.text(`Problèmes signalés : ${counts.problem}`);
    doc.text(`Commandes annulées : ${counts.cancelled}`);
    doc.moveDown(1.5);

    doc.font('Helvetica-Bold').fontSize(11).text('Factures émises ce mois');
    doc.moveDown(0.5);

    const colX = [50, 180, 350, 450];
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('N° Facture', colX[0], doc.y, { continued: false });
    doc.text('Client', colX[1], doc.y - doc.currentLineHeight());
    doc.text('Date', colX[2], doc.y - doc.currentLineHeight());
    doc.text('Montant TTC', colX[3], doc.y - doc.currentLineHeight());
    doc.moveDown(0.5);
    doc.font('Helvetica');

    invoices.forEach((inv) => {
      const y = doc.y;
      doc.text(inv.invoiceNumber, colX[0], y, { width: 120 });
      doc.text(inv.clientName, colX[1], y, { width: 160 });
      doc.text(new Date(inv.createdAt).toLocaleDateString('fr-FR'), colX[2], y, { width: 90 });
      doc.text(`${inv.amountTTC.toFixed(2)} DHS`, colX[3], y, { width: 100 });
      doc.moveDown(0.6);
    });

    doc.end();
  });
}

module.exports = { generateMonthlyReportPdf };

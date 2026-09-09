// src/services/report.js
const PDFDocument = require('pdfkit');

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('fr-FR') : '—';
}

/**
 * @param {object} data
 * @param {string} data.label - e.g. "septembre 2026"
 * @param {Array}  data.invoices - [{invoiceNumber, clientName, amountTTC, createdAt}]
 * @param {object} data.counts - {shipped, late, problem, cancelled}
 * @param {number} data.totalRevenue
 * @param {Array}  data.enTransit - TruckShipment[] currently in transit
 * @param {Array}  data.arrivees - TruckShipment[] arrived this month
 */
function generateMonthlyReportPdf(data) {
  const { label, invoices, counts, totalRevenue, enTransit = [], arrivees = [] } = data;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ---------------------------------------------------------------------
    // Page 1 (portrait): summary + invoices
    // ---------------------------------------------------------------------
    doc.fontSize(18).font('Helvetica-Bold').text('United Transport Solutions');
    doc.fontSize(12).font('Helvetica').fillColor('#4E657E').text(`Rapport mensuel — ${label}`);
    doc.fillColor('#000000');
    doc.moveDown(1.5);

    doc.fontSize(11).font('Helvetica-Bold').text('Résumé');
    doc.font('Helvetica').fontSize(10);
    doc.text(`Envois livrés (factures émises) : ${invoices.length}`);
    doc.text(`Chiffre d'affaires total (TTC) : ${totalRevenue.toFixed(2)} DHS`);
    doc.text(`Envois expédiés : ${counts.shipped}`);
    doc.text(`Retards signalés : ${counts.late}`);
    doc.text(`Problèmes signalés : ${counts.problem}`);
    doc.text(`Envois annulés : ${counts.cancelled}`);
    doc.moveDown(1.5);

    doc.font('Helvetica-Bold').fontSize(11).text('Factures émises ce mois');
    doc.moveDown(0.5);

    if (invoices.length === 0) {
      doc.font('Helvetica').fontSize(10).text('Aucune facture ce mois.');
    } else {
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
        doc.text(fmtDate(inv.createdAt), colX[2], y, { width: 90 });
        doc.text(`${inv.amountTTC.toFixed(2)} DHS`, colX[3], y, { width: 100 });
        doc.moveDown(0.6);
      });
    }

    // ---------------------------------------------------------------------
    // Page 2 (landscape): truck-shipment tracking - wide table, matches
    // the RAPPORT_TRUCK spreadsheet columns exactly.
    // ---------------------------------------------------------------------
    doc.addPage({ size: 'A4', layout: 'landscape', margin: 40 });

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000').text('Suivi des expéditions par camion');
    doc.moveDown(1);

    function truckTable(title, rows, showRemarque) {
      doc.fontSize(11).font('Helvetica-Bold').text(title);
      doc.moveDown(0.4);

      if (rows.length === 0) {
        doc.font('Helvetica').fontSize(9).text('Aucune expédition.');
        doc.moveDown(1);
        return;
      }

      const headers = showRemarque
        ? ['LTA N°', 'Date Récep.', 'Colis', 'Poids', 'Destination', 'ETD Truck', 'ETA CDG', 'Vol Connex.', 'Commentaires', 'Remarque']
        : ['LTA N°', 'Date Récep.', 'Colis', 'Poids', 'Destination', 'ETD Truck', 'ETA CDG', 'Vol Connex.', 'Commentaires'];
      const widths = showRemarque
        ? [85, 62, 40, 45, 65, 62, 62, 62, 130, 100]
        : [90, 68, 45, 50, 75, 68, 68, 68, 200];

      let x = doc.page.margins.left;
      const startY = doc.y;
      doc.fontSize(8).font('Helvetica-Bold');
      headers.forEach((h, i) => {
        doc.text(h, x, startY, { width: widths[i] });
        x += widths[i];
      });
      doc.moveDown(0.8);
      doc.font('Helvetica').fontSize(8);

      rows.forEach((t) => {
        const y = doc.y;
        x = doc.page.margins.left;
        const values = showRemarque
          ? [t.ltaNumber, fmtDate(t.dateReception), t.colis ?? '—', t.poids ?? '—', t.destination || '—', fmtDate(t.etdTruck), fmtDate(t.etaTruckCdg), fmtDate(t.dateFlightConex), t.comments || '—', t.remarque || '—']
          : [t.ltaNumber, fmtDate(t.dateReception), t.colis ?? '—', t.poids ?? '—', t.destination || '—', fmtDate(t.etdTruck), fmtDate(t.etaTruckCdg), fmtDate(t.dateFlightConex), t.comments || '—'];
        values.forEach((v, i) => {
          doc.text(String(v), x, y, { width: widths[i] });
          x += widths[i];
        });
        doc.moveDown(0.7);
      });
      doc.moveDown(1);
    }

    truckTable('En transit', enTransit, true);
    truckTable('Arrivées ce mois', arrivees, false);

    doc.end();
  });
}

module.exports = { generateMonthlyReportPdf };

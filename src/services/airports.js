// src/services/airports.js
//
// When staff send a tarif ("Prêt à travailler"), they pick an arrival
// airport per quote option. That list used to be one fixed set of mostly
// French/European airports for every client, regardless of where the
// shipment is actually going - which made no sense once a client's
// destination was somewhere like Dallas, USA.
//
// This maps a destination country (as chosen on the quote form - see
// COUNTRIES below, shared with the public website's dropdown) to the
// airports actually worth suggesting there. Client.destinationCountry is
// matched against this list; if there's no match (older client predating
// this feature, or a country not in COUNTRIES), every airport is offered
// instead of narrowing down to nothing.

const AIRPORTS_BY_COUNTRY = {
  'France': [
    'Paris - Charles de Gaulle (CDG)',
    'Paris - Orly (ORY)',
    'Lyon - Saint-Exupéry (LYS)',
    'Marseille Provence (MRS)'
  ],
  'Belgique': ['Bruxelles (BRU)'],
  'Pays-Bas': ['Amsterdam - Schiphol (AMS)'],
  'Allemagne': ['Francfort (FRA)', 'Munich (MUC)', 'Berlin (BER)'],
  'Espagne': ['Madrid - Barajas (MAD)', 'Barcelone - El Prat (BCN)'],
  'Italie': ['Milan - Malpensa (MXP)', 'Rome - Fiumicino (FCO)'],
  'Royaume-Uni': ['Londres - Heathrow (LHR)', 'Londres - Gatwick (LGW)'],
  'Suisse': ['Genève (GVA)', 'Zurich (ZRH)'],
  'Hongrie': ['Budapest - Ferenc Liszt (BUD)'],
  'Canada': ['Montréal - Trudeau (YUL)', 'Toronto - Pearson (YYZ)'],
  'États-Unis': [
    'New York - JFK (JFK)',
    'New York - Newark (EWR)',
    'Dallas/Fort Worth (DFW)',
    'Dallas - Love Field (DAL)',
    'Los Angeles (LAX)',
    'Chicago - O\'Hare (ORD)',
    'Houston (IAH)',
    'Miami (MIA)',
    'Atlanta (ATL)',
    'Washington - Dulles (IAD)'
  ],
  'Émirats Arabes Unis': ['Dubaï (DXB)', 'Abou Dabi (AUH)'],
  'Turquie': ['Istanbul (IST)'],
  'Qatar': ['Doha - Hamad (DOH)']
};

// Shown on the public quote form's "Pays de destination" dropdown, and
// reused wherever the dashboard needs the same list (e.g. the manual
// client-creation form). "Autre" lets a client/staff type a country we
// don't have a curated airport list for yet - matching just falls back to
// every airport (see getAirportsForCountry) rather than an empty list.
const COUNTRIES = [...Object.keys(AIRPORTS_BY_COUNTRY), 'Autre'];

const ALL_AIRPORTS = Object.values(AIRPORTS_BY_COUNTRY).flat();

/**
 * @param {string|null|undefined} country - Client.destinationCountry
 * @returns {string[]} airports to suggest, narrowed to that country when we
 *   recognize it, otherwise every airport (never an empty list, so staff
 *   always has something to pick from or type over).
 */
function getAirportsForCountry(country) {
  if (country && AIRPORTS_BY_COUNTRY[country]) return AIRPORTS_BY_COUNTRY[country];
  return ALL_AIRPORTS;
}

module.exports = { AIRPORTS_BY_COUNTRY, COUNTRIES, getAirportsForCountry };

// Must match exactly the Choice values of the SharePoint columns Categorie / SousCategorie.
export const HR_CATEGORY = '06 — Human Resources';

export const TAXONOMY: { category: string; subs: string[] }[] = [
  {
    category: '01 — Corporate & Governance',
    subs: ['Statuts', 'Extraits registre de commerce', 'Organigrammes', "PV d'AG", 'Décisions du conseil', 'Nominations', 'Délégations de pouvoirs', 'Procurations', 'Registres légaux'],
  },
  {
    category: '02 — Legal & Contracts',
    subs: ['NDA', 'Accords-cadres', 'Conventions intragroupe', 'Contentieux', 'Accords transactionnels'],
  },
  {
    category: '03 — Finance & Accounting',
    subs: ['États financiers', "Rapports d'audit", 'Lettres de mission', 'Politiques et conventions comptables', 'Rapports financiers', 'Confirmations de soldes'],
  },
  {
    category: '04 — Treasury & Banking',
    subs: ['Contrats bancaires', 'Ouvertures de comptes', 'Procurations bancaires', 'Lignes de crédit', 'Emprunts', 'Leasing', 'Factoring', 'Garanties', 'Cautions'],
  },
  {
    category: '05 — Tax & Transfer Pricing',
    subs: ['Déclarations fiscales', 'Documentation TP', 'Benchmarks', 'Rulings / rescrits', 'Contrôles fiscaux', 'Conventions fiscales', 'Dossiers douaniers'],
  },
  {
    category: HR_CATEGORY,
    subs: ['Contrats de travail', 'Règlements internes', 'Rémunération', 'Documents disciplinaires', 'Délégations RH', 'Permis de travail', 'Accords collectifs'],
  },
  {
    category: '07 — Operations & Manufacturing',
    subs: ['Contrats de sous-traitance', 'Dossiers industriels', 'Procédures de production', 'Investissements CAPEX', 'Maintenance', "Qualifications d'équipements"],
  },
  {
    category: '08 — Quality & Regulatory',
    subs: ['Certifications ISO', 'Audits qualité', 'SOP', 'Fiches de sécurité', 'Conformité cosmétique', 'Dossiers réglementaires', 'Réclamations qualité', 'Rapports de non-conformité'],
  },
  {
    category: '09 — Commercial & Customers',
    subs: ['Contrats clients', 'Accords commerciaux', 'CGV', 'Contrats de distribution', 'Tarifs contractuels', 'Exclusivités'],
  },
  {
    category: '10 — Procurement & Suppliers',
    subs: ["Contrats d'achat", 'Contrats de prestation', 'CGA', 'Accords de fourniture', 'Référencement fournisseurs', 'Certifications fournisseurs'],
  },
  {
    category: '11 — IT & Data Protection',
    subs: ['Contrats logiciels', 'Licences', 'Contrats SaaS', 'DPA / RGPD', 'Politiques de cybersécurité', "Conventions d'hébergement", 'Maintenance informatique'],
  },
  {
    category: '12 — Insurance, Property & HSE',
    subs: ["Polices d'assurance", 'Sinistres', 'Baux', 'Contrats immobiliers', 'Assurances transport', 'Responsabilité civile', 'Incendie', 'Sécurité au travail', 'Environnement'],
  },
];

export const CATEGORIES = TAXONOMY.map((t) => t.category);

export function subsOf(category: string): string[] {
  return TAXONOMY.find((t) => t.category === category)?.subs ?? [];
}

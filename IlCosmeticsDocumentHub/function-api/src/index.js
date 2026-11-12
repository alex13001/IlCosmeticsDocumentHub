import { app } from '@azure/functions';
import { DefaultAzureCredential } from '@azure/identity';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const tenant = process.env.AZURE_TENANT_ID;
const audience = process.env.API_AUDIENCE; // e.g. api://<API_APP_CLIENT_ID>
const permittedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
const credential = new DefaultAzureCredential();
let jwks;

function cors(origin) {
  return origin && permittedOrigins.includes(origin) ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Document-Name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  } : {};
}
function response(status, obj, origin) {
  return { status, jsonBody: obj, headers: { ...cors(origin), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } };
}
async function verifyUser(auth) {
  if (!tenant || !audience) throw new Error('Configuration Entra manquante : AZURE_TENANT_ID / API_AUDIENCE');
  const raw = /^Bearer (.+)$/i.exec(auth || '')?.[1];
  if (!raw) return false;
  jwks ||= createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`));
  try {
    const { payload } = await jwtVerify(raw, jwks, {
      audience: audience.split(',').map(x => x.trim()),
      issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
      algorithms: ['RS256'],
    });
    const scopes = String(payload.scp || '').split(' ');
    const allowedClient = process.env.ALLOWED_CLIENT_ID;
    // Caller must be our SPA, and have the delegated permission to analyze documents.
    return scopes.includes('Document.Analyze') && (!allowedClient || payload.azp === allowedClient) && Boolean(payload.oid);
  } catch { return false; }
}
async function azureToken(scope) {
  return (await credential.getToken(scope)).token;
}
async function withRetry(fn, max = 4) {
  for (let a = 0; ; a++) {
    const resp = await fn();
    if (![429, 500, 502, 503, 504].includes(resp.status) || a >= max) return resp;
    const seconds = Number(resp.headers.get('retry-after'));
    await new Promise(r => setTimeout(r, Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 30000) : Math.min(2000 * (a + 1) ** 2, 30000)));
  }
}
async function readDocument(bytes) {
  const endpoint = process.env.DOCUMENT_INTELLIGENCE_ENDPOINT?.replace(/\/$/, '');
  if (!endpoint) throw new Error('DOCUMENT_INTELLIGENCE_ENDPOINT manquant');
  const url = `${endpoint}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30&outputContentFormat=text`;
  const token = await azureToken('https://cognitiveservices.azure.com/.default');
  const r = await withRetry(() => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf' }, body: bytes }));
  if (r.status !== 202) throw new Error(`Document Intelligence HTTP ${r.status}: ${(await r.text()).slice(0, 280)}`);
  const location = r.headers.get('operation-location');
  if (!location) throw new Error('Document Intelligence : operation-location absent');
  for (let i = 0; i < 75; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const s = await withRetry(() => fetch(location, { headers: { Authorization: `Bearer ${token}` } }));
    if (!s.ok) throw new Error(`Document Intelligence polling HTTP ${s.status}`);
    const j = await s.json();
    if (j.status === 'succeeded') {
      const pages = (j.analyzeResult?.pages || []).map(p => {
        const text = (p.lines || []).map(l => l.content).join('\n');
        return { page: p.pageNumber, text };
      });
      if (!pages.length) throw new Error('Aucun texte détecté dans le PDF.');
      return pages;
    }
    if (j.status === 'failed' || j.status === 'canceled') throw new Error(`Document Intelligence : ${j.status}`);
  }
  throw new Error('Analyse OCR trop longue. Réessayez avec un fichier plus petit.');
}
const taxonomy = [
  ['01 — Corporate & Governance', ['Statuts', 'Extraits registre de commerce', 'Organigrammes', "PV d'AG", 'Décisions du conseil', 'Nominations', 'Délégations de pouvoirs', 'Procurations', 'Registres légaux']],
  ['02 — Legal & Contracts', ['NDA', 'Accords-cadres', 'Conventions intragroupe', 'Contentieux', 'Accords transactionnels']],
  ['03 — Finance & Accounting', ['États financiers', "Rapports d'audit", 'Lettres de mission', 'Politiques et conventions comptables', 'Rapports financiers', 'Confirmations de soldes']],
  ['04 — Treasury & Banking', ['Contrats bancaires', 'Ouvertures de comptes', 'Procurations bancaires', 'Lignes de crédit', 'Emprunts', 'Leasing', 'Factoring', 'Garanties', 'Cautions']],
  ['05 — Tax & Transfer Pricing', ['Déclarations fiscales', 'Documentation TP', 'Benchmarks', 'Rulings / rescrits', 'Contrôles fiscaux', 'Conventions fiscales', 'Dossiers douaniers']],
  ['06 — Human Resources', ['Contrats de travail', 'Règlements internes', 'Rémunération', 'Documents disciplinaires', 'Délégations RH', 'Permis de travail', 'Accords collectifs']],
  ['07 — Operations & Manufacturing', ['Contrats de sous-traitance', 'Dossiers industriels', 'Procédures de production', 'Investissements CAPEX', 'Maintenance', "Qualifications d'équipements"]],
  ['08 — Quality & Regulatory', ['Certifications ISO', 'Audits qualité', 'SOP', 'Fiches de sécurité', 'Conformité cosmétique', 'Dossiers réglementaires', 'Réclamations qualité', 'Rapports de non-conformité']],
  ['09 — Commercial & Customers', ['Contrats clients', 'Accords commerciaux', 'CGV', 'Contrats de distribution', 'Tarifs contractuels', 'Exclusivités']],
  ['10 — Procurement & Suppliers', ["Contrats d'achat", 'Contrats de prestation', 'CGA', 'Accords de fourniture', 'Référencement fournisseurs', 'Certifications fournisseurs']],
  ['11 — IT & Data Protection', ['Contrats logiciels', 'Licences', 'Contrats SaaS', 'DPA / RGPD', 'Politiques de cybersécurité', "Conventions d'hébergement", 'Maintenance informatique']],
  ['12 — Insurance, Property & HSE', ["Polices d'assurance", 'Sinistres', 'Baux', 'Contrats immobiliers', 'Assurances transport', 'Responsabilité civile', 'Incendie', 'Sécurité au travail', 'Environnement']],
];
const system = `Tu es documentaliste juridique du groupe IL Cosmetics. Tu analyses uniquement les preuves fournies.
AUCUNE invention : champ inconnu = chaîne vide. Ne confonds pas date de contrat, date de signature et date d'effet. Si le document dit 'signé électroniquement' mais aucune date de signature attestée, dateSignature vide. Dates ISO YYYY-MM-DD uniquement si explicitement prouvées; ne calcule pas une échéance implicite. Les signataires sont des personnes, mais n'invente aucun email. Le champ 'entite' vaut uniquement IL, LX, ILCG, ILCPL, ILCIT ou ILCBG. Choisis categorie et sousCategorie UNIQUEMENT dans le dictionnaire ci-dessous, sousCategorie correspond à categorie. Si aucune sous-catégorie ne convient, laisse vide. Confidentialité Restricted pour RH et documents contenant des données personnelles sensibles. Ne considère pas un document comme signé sur la seule base de sa rédaction.
Dictionnaire: ${JSON.stringify(taxonomy)}.
Réponds uniquement avec un objet JSON aux clés: title, entite, categorie, sousCategorie, contrepartie, dateSignature, dateEffet, dateEcheance, resumeIA, confidentialite, justification, pointsVigilance, sources.
resumeIA: synthèse claire en français 80-140 mots, contractants, objet, obligations, durée, résiliation et risques utiles. pointsVigilance tableau de chaînes. sources tableau de références de pages 'p. X'. Tous les champs texte sont des chaînes. confidentialite 'Normal' ou 'Restricted'.`;
async function aiCall(messages, outputTokens = 1800) {
  const base = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, '');
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  if (!base || !deployment) throw new Error('Endpoint ou deployment OpenAI manquant');
  const token = await azureToken('https://cognitiveservices.azure.com/.default');
  const url = `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=2025-01-01-preview`;
  const r = await withRetry(() => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, response_format: { type: 'json_object' }, max_completion_tokens: outputTokens }) }));
  if (!r.ok) throw new Error(`Azure OpenAI HTTP ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j = await r.json();
  const val = j.choices?.[0]?.message?.content;
  if (!val) throw new Error('Réponse IA vide (limite de tokens ou modèle incompatible)');
  try { return JSON.parse(val); } catch { throw new Error('Réponse IA non conforme au format JSON'); }
}
function sections(pages, maxChars = 21000) {
  const chunks = []; let acc = '';
  for (const p of pages) {
    const section = `\n[[PAGE ${p.page}]]\n${p.text}\n`;
    if (acc && acc.length + section.length > maxChars) { chunks.push(acc); acc = ''; }
    if (section.length <= maxChars) acc += section;
    else for (let i = 0; i < section.length; i += maxChars) { if (acc) {chunks.push(acc); acc='';} chunks.push(section.slice(i, i + maxChars)); }
  }
  if (acc) chunks.push(acc);
  return chunks;
}
function safeOutput(j) {
  const val = k => typeof j[k] === 'string' ? j[k].trim() : '';
  const entite = ['IL','LX','ILCG','ILCPL','ILCIT','ILCBG'].includes(val('entite')) ? val('entite') : '';
  const cat = taxonomy.find(x => x[0] === val('categorie'));
  const categorie = cat?.[0] || '';
  const sousCategorie = cat?.[1].includes(val('sousCategorie')) ? val('sousCategorie') : '';
  const date = k => /^\d{4}-\d{2}-\d{2}$/.test(val(k)) && !Number.isNaN(Date.parse(val(k))) ? val(k) : '';
  return {
    title: val('title').slice(0, 230), entite, categorie, sousCategorie, contrepartie: val('contrepartie').slice(0, 230),
    dateSignature: date('dateSignature'), dateEffet: date('dateEffet'), dateEcheance: date('dateEcheance'),
    resumeIA: val('resumeIA').slice(0, 6000), confidentialite: val('confidentialite') === 'Restricted' || categorie === '06 — Human Resources' ? 'Restricted' : 'Normal',
    justification: val('justification').slice(0, 1200),
    pointsVigilance: Array.isArray(j.pointsVigilance) ? j.pointsVigilance.filter(x => typeof x === 'string').slice(0, 10) : [],
    sources: Array.isArray(j.sources) ? j.sources.filter(x => typeof x === 'string').slice(0, 12) : [],
  };
}
app.http('analyze-document', {
  methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'analyze-document',
  handler: async (request, context) => {
    const origin = request.headers.get('origin');
    if (request.method === 'OPTIONS') return { status: permittedOrigins.includes(origin) ? 204 : 403, headers: cors(origin) };
    if (!await verifyUser(request.headers.get('authorization'))) return response(401, { error: 'Jeton Entra non autorisé pour Document Hub.' }, origin);
    if (!permittedOrigins.includes(origin)) return response(403, { error: 'Origine non autorisée.' }, origin);
    if (!request.headers.get('content-type')?.startsWith('application/pdf')) return response(415, { error: 'PDF obligatoire.' }, origin);
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 8 * 1024 * 1024) return response(413, { error: 'PDF trop volumineux (8 Mo maximum).' }, origin);
    try {
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 8 * 1024 * 1024) return response(413, { error: 'PDF trop volumineux.' }, origin);
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') return response(415, { error: 'Le fichier ne semble pas être un PDF.' }, origin);
      const pages = await readDocument(bytes);
      const parts = sections(pages);
      // No truncation: each section is analyzed before the final synthesis.
      const extracted = [];
      for (let i = 0; i < parts.length; i++) {
        extracted.push(await aiCall([
          { role: 'system', content: 'Tu identifies factuellement les informations du segment. Retourne seulement un JSON {"faits": ["fait précis (page)"]}. Inclure parties, dates, fin, préavis, prix, clauses, objets, sociétés. Ne rien inventer.' },
          { role: 'user', content: `Segment ${i+1}/${parts.length}:\n${parts[i]}` },
        ], 1300));
      }
      const evidence = extracted.flatMap(x => Array.isArray(x.faits) ? x.faits.filter(y => typeof y === 'string') : []).slice(0, 160);
      const result = await aiCall([{ role: 'system', content: system }, { role: 'user', content: `Document de ${pages.length} pages. Faits extraits de TOUS les segments (avec pages):\n${JSON.stringify(evidence)}` }], 2400);
      context.log(`Document analysis: pages=${pages.length}, chunks=${parts.length}`);
      return response(200, safeOutput(result), origin);
    } catch (e) {
      context.error('Analysis failed', e?.message);
      return response(502, { error: 'Analyse IA impossible : ' + String(e?.message || e).slice(0, 240) }, origin);
    }
  },
});

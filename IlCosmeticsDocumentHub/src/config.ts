export const config = {
  aiApiUrl: (import.meta.env.VITE_AI_API_URL || '').replace(/\/$/, ''),
  aiApiScope: import.meta.env.VITE_AI_API_SCOPE || '', 
  clientId: '51b03139-b873-4456-870b-622e4c2cf3d0',
  authority: 'https://login.microsoftonline.com/ilcosmetics.com',
  siteHost: 'ilcosmetics.sharepoint.com',
  sitePath: '/sites/ILCosmeticsDocuments',
  scopes: ['User.Read', 'Mail.Send', 'Sites.Selected'],
  // Above this size the PDF is sent as a link rather than an attachment (Graph sendMail limit ~4 MB per request).
  maxAttachmentBytes: 3 * 1024 * 1024,
};

export const ENTITIES = ['IL', 'LX', 'ILCG', 'ILCPL', 'ILCIT', 'ILCBG'] as const;
export type Entity = (typeof ENTITIES)[number];

export const RESTRICTED = 'Restricted';
export const DOC_LIBRARIES: string[] = [...ENTITIES, RESTRICTED];

export const STATUTS = ['À signer', 'Envoyé', 'Signé', 'Annulé'] as const;
export type Statut = (typeof STATUTS)[number];

export const TYPES_SIGNATURE = ['Manuscrite', 'Électronique'] as const;
export const ORIGINES = ['Flux', 'Import historique'] as const;

/**
 * Navigation entre hubs (en-tête). Même liste dans Finance Hub, Document Hub et
 * Business Hub : à mettre à jour dans les trois applis si une URL change.
 */
export const HUB_LINKS = [
  { id: 'finance', label: 'Finance Hub', url: 'https://ashy-mud-01680b903.2.azurestaticapps.net' },
  { id: 'document', label: 'Document Hub', url: 'https://brave-plant-01801d910.1.azurestaticapps.net' },
  { id: 'business', label: 'Business Hub', url: 'https://icy-field-0ed4a7503.6.azurestaticapps.net' },
] as const;

/** Liens vers les autres hubs : comptes internes uniquement (pas les invités B2B). */
export const INTERNAL_EMAIL_DOMAIN = '@ilcosmetics.com';

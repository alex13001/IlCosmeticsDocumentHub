export const config = {
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

# Document Hub — analyse IA (déploiement)

## Fichiers
- `src/ai.ts`, `src/auth.ts`, `src/config.ts`, `src/components/UploadDialog.tsx` : frontend
- `function-api/` : API Azure Functions Node.js 24 séparée (Flex Consumption)

## IMPORTANT — Entra ID
L'application SPA utilise aujourd'hui un token Graph. Ce token **ne doit pas** être envoyé à notre API. Créer dans Entra ID une *App registration* distincte `ILC-DocumentHub-AI-API` (single tenant), exposer un scope délégué `Document.Analyze` (`api://<API_APP_CLIENT_ID>/Document.Analyze`) puis ajouter cette permission API à la SPA existante `51b03139-b873-4456-870b-622e4c2cf3d0`, avec consentement administrateur. Il ne faut **aucun** client secret dans Vite.

## Application settings de la Function App `ilc-documenthub-api`
```
AZURE_TENANT_ID=<tenant GUID Microsoft Entra>
API_AUDIENCE=api://<API_APP_CLIENT_ID>
ALLOWED_CLIENT_ID=51b03139-b873-4456-870b-622e4c2cf3d0
ALLOWED_ORIGINS=https://brave-plant-01801d910.1.azurestaticapps.net
DOCUMENT_INTELLIGENCE_ENDPOINT=<endpoint existant>
AZURE_OPENAI_ENDPOINT=<endpoint existant>
AZURE_OPENAI_DEPLOYMENT=ilc-doc-analyzer
```
Le rôle **Cognitive Services OpenAI User** doit être attribué à l'identité managée de la Function App sur la ressource Foundry, et **Cognitive Services User** sur Document Intelligence (déjà effectué).

## Paramètres de build du site React (GitHub Actions / Azure SWA)
```
VITE_AI_API_URL=https://<HOSTNAME EXACT DE LA FUNCTION APP>
VITE_AI_API_SCOPE=api://<API_APP_CLIENT_ID>/Document.Analyze
```
Ces deux variables publiques doivent exister **à la compilation Vite**, pas seulement dans les paramètres de la Static Web App. Ajoutez-les aux `env:` de l'étape de build GitHub Actions. Les jetons sont obtenus silencieusement par MSAL après consentement.

## Déploiement de l'API
Le dossier `function-api` est un projet Azure Functions autonome. Exécuter `npm ci` dans ce dossier, puis déployer **ce dossier** (et non le frontend) sur la Function App existante `ilc-documenthub-api`. Le déploiement peut être configuré via Deployment Center / GitHub Actions avec chemin `IlCosmeticsDocumentHub/function-api`.

## Vérifications
1. La Function App expose `POST /api/analyze-document`; sans jeton elle renvoie 401.
2. Le frontend affiche le bouton après sélection PDF. L'utilisateur connecté lance une analyse, sans enregistrement automatique.
3. Valider le résultat sur deux PDF Crowe (11 et 58 pages), sans extrapoler les dates de signature.
4. Tester un membre non autorisé, un PDF >8 Mo, une panne IA et un document RH (à ne pas analyser sans décision RGPD).
5. Mettre un budget Azure et des alertes. À 20K TPM, les gros contrats peuvent prendre plusieurs minutes ou dépasser le délai HTTP ; réduire le nombre de chunks ou opter plus tard pour une analyse asynchrone.

## Limites et sécurité
L'API vérifie JWT Entra (audience, signature, issuer, scope, application cliente) et l'origine web. La présence d'Entra sur le site ne suffit pas à protéger l'API. La Function est `anonymous` au sens Functions Keys **mais elle vérifie obligatoirement** le Bearer Entra. Pour la production, garder TLS et compléter avec restrictions réseau / défense en profondeur selon politique IT. Aucun document n'est conservé par l'API et rien n'est envoyé dans Application Insights sauf compte de pages/chunks. Aucune IA n'attribue le statut `Signé`.

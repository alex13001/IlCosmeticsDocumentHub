import { config } from './config';
import { getAiApiToken } from './auth';

export interface AnalysisResult {
  title: string;
  entite: string;
  categorie: string;
  sousCategorie: string;
  contrepartie: string;
  dateSignature: string;
  dateEffet: string;
  dateEcheance: string;
  resumeIA: string;
  confidentialite: 'Normal' | 'Restricted';
  justification: string;
  pointsVigilance: string[];
  sources: string[];
  warning?: string;
}

export async function analyzeDocument(file: File): Promise<AnalysisResult> {
  if (!config.aiApiUrl) throw new Error('VITE_AI_API_URL non configurée sur Azure Static Web Apps.');
  if (file.size > 8 * 1024 * 1024) throw new Error('PDF de plus de 8 Mo : réduire le fichier avant analyse.');
  const token = await getAiApiToken();
  const resp = await fetch(`${config.aiApiUrl}/api/analyze-document`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf', 'X-Document-Name': encodeURIComponent(file.name) },
    body: file,
  });
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(payload.error || `Analyse impossible (${resp.status}).`);
  return payload as AnalysisResult;
}

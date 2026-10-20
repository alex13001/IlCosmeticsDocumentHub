// Shared UI pieces — Finance Hub visual identity, green variant.
import type { ReactNode } from 'react';

export type Tone = 'green' | 'orange' | 'red' | 'blue' | 'violet' | 'grey';

export const STATUT_TONE: Record<string, Tone> = {
  'À signer': 'orange',
  Envoyé: 'blue',
  Signé: 'green',
  Annulé: 'grey',
};

export function Badge({ children, tone = 'grey', small }: { children: ReactNode; tone?: Tone; small?: boolean }) {
  return <span className={`badge t-${tone}${small ? ' small' : ''}`}>{children}</span>;
}

export function StatTile(props: { label: string; value: ReactNode; sub?: string; tone?: Tone; icon?: string; active?: boolean; onClick?: () => void }) {
  const { label, value, sub, tone = 'green', icon, active, onClick } = props;
  return (
    <div className={`tile t-${tone}${onClick ? ' click' : ''}${active ? ' on' : ''}`} onClick={onClick}>
      <div className="tile-top">
        <div className="tile-label">{label}</div>
        {icon && <span className="tile-icon">{icon}</span>}
      </div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="section">
      <div className="section-head">
        <div className="section-title">
          <span className="section-bar" />
          {title}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ title, sub, icon }: { title: string; sub?: ReactNode; icon?: string }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {sub && <div className="empty-sub">{sub}</div>}
    </div>
  );
}

export function Field({ label, required, children, full }: { label: string; required?: boolean; children: ReactNode; full?: boolean }) {
  return (
    <label className={`field${full ? ' full' : ''}`}>
      <span className="field-label">
        {label}
        {required && <span className="req">*</span>}
      </span>
      {children}
    </label>
  );
}

import React from 'react';
import { calculateCashTender } from '../../utils/cashTender';

export default function CashTenderFields({ due, value, onChange, disabled = false }) {
  const result = calculateCashTender(due, value);
  return <>
    <label>Montant remis
      <input type="number" min="0" step="1" value={value ?? ''} disabled={disabled}
        onChange={(event) => onChange(event.target.value)} />
    </label>
    <div className="staff-cash-change">
      <span>Monnaie a rendre</span>
      <output aria-label="Monnaie a rendre">{result.change == null ? '-' : `${result.change.toLocaleString('fr-FR')} Ar`}</output>
      {result.error ? <small role="status">{result.error}</small> : null}
    </div>
  </>;
}

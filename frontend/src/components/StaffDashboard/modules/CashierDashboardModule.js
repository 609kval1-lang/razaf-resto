import React from 'react';
import { CashierOverviewModule } from './CashierModules';
import { CashierAvailabilityModule } from './CashierAvailabilityModule';

export function CashierDashboardModule() {
  return <div className="cashier-dashboard">
    <CashierOverviewModule>
      <CashierAvailabilityModule />
    </CashierOverviewModule>
  </div>;
}

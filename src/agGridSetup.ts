import { ModuleRegistry } from 'ag-grid-community';
import { AllEnterpriseModule } from 'ag-grid-enterprise';
import { AgChartsCommunityModule } from 'ag-charts-community';

ModuleRegistry.registerModules([AllEnterpriseModule.with(AgChartsCommunityModule)]);

// Optional: import { LicenseManager } from 'ag-grid-enterprise';
// LicenseManager.setLicenseKey('YOUR_AG_GRID_ENTERPRISE_KEY');

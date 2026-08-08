/** Sidebar grouping — same IA as MarketsGrid Feature Lab. */
export interface LabCategory {
  id: string;
  label: string;
  tabIds: string[];
}

export const LAB_CATEGORIES: LabCategory[] = [
  { id: 'getting-started', label: 'Getting Started', tabIds: ['home', 'overview'] },
  {
    id: 'formatting-display',
    label: 'Formatting & Display',
    tabIds: ['formatting', 'renderers', 'conditional', 'toolbar', 'visual-excel'],
  },
  { id: 'columns-layout', label: 'Columns & Layout', tabIds: ['groups', 'calc'] },
  { id: 'filtering-data', label: 'Filtering & Live Data', tabIds: ['filters', 'live', 'alerts'] },
  { id: 'editing', label: 'Editing', tabIds: ['editing', 'bulk-update', 'plus-minus', 'shortcuts'] },
  { id: 'profiles', label: 'Profiles & Persistence', tabIds: ['profiles'] },
];

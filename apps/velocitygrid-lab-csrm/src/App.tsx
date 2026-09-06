import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from './lab/Sidebar';
import { HomeTab } from './lab/HomeTab';
import { LabTab } from './lab/LabTab';
import { tabById } from './lab/catalog';
import { DEFAULT_THEME, GRID_THEMES, type GridThemeId } from './lab/theme';

/** The tab lives in the hash so a link to a feature is a link a colleague can
 *  open — the single most useful thing a lab like this can offer a team. */
function tabFromHash(): string {
  const id = location.hash.replace(/^#\/?/, '');
  return id && (id === 'home' || tabById(id)) ? id : 'home';
}

export function App() {
  const [active, setActive] = useState(tabFromHash);
  const [theme, setTheme] = useState<GridThemeId>(DEFAULT_THEME);

  useEffect(() => {
    const onHash = () => setActive(tabFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const select = useCallback((id: string) => {
    location.hash = `/${id}`;
    setActive(id);
  }, []);

  const tab = active === 'home' ? null : tabById(active);

  return (
    <div className="lab">
      <Sidebar active={active} onSelect={select} mode="Client-side row model" />
      <div className="lab-body">
        {tab
          // Keying on the tab id makes a tab switch a real unmount: the grid,
          // its worker and its stream all go away together. Reusing one grid
          // across tabs would leak the previous tab's column state into the
          // next one, which is exactly the confusion a lab must not create.
          ? <LabTab key={tab.id} tab={tab} theme={theme} onTheme={setTheme} themes={GRID_THEMES} />
          : <HomeTab onSelect={select} />}
      </div>
    </div>
  );
}

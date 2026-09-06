import { LAB_TABS, TAB_GROUPS } from './catalog';

export interface SidebarProps {
  active: string;
  onSelect: (id: string) => void;
  /** Row-model name shown under the brand. */
  mode: string;
}

export function Sidebar({ active, onSelect, mode }: SidebarProps) {
  return (
    <nav className="lab-nav" aria-label="Feature tabs">
      <div className="lab-brand">
        <h1>VelocityGrid Lab</h1>
        <span className="mode">{mode}</span>
      </div>
      <div className="lab-nav-scroll">
        <div className="lab-nav-group">
          <button
            type="button"
            className="lab-nav-item"
            aria-current={active === 'home' ? 'page' : undefined}
            onClick={() => onSelect('home')}
          >
            Home
          </button>
        </div>
        {TAB_GROUPS.map((group) => {
          const tabs = LAB_TABS.filter((t) => t.group === group);
          if (!tabs.length) return null;
          return (
            <div className="lab-nav-group" key={group}>
              <span>{group}</span>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className="lab-nav-item"
                  aria-current={active === tab.id ? 'page' : undefined}
                  onClick={() => onSelect(tab.id)}
                  title={tab.hint}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

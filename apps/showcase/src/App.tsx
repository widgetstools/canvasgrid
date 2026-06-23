import { PositionsGrid } from './grid/PositionsGrid';
import { DEFAULT_STOMP_CONFIG } from './types';

export function App() {
  return (
    <div className="app">
      <PositionsGrid config={DEFAULT_STOMP_CONFIG} />
    </div>
  );
}

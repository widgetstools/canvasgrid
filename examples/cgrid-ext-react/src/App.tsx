import { VelocityExtGrid } from './VelocityExtGrid';

export function App() {
  return (
    <div className="page">
      <header className="page-header">
        <h1>VelocityGridExt · React</h1>
        <p>
          Installed from <code>dist/tarballs/*.tgz</code>, not the monorepo workspace.
        </p>
      </header>
      <VelocityExtGrid />
    </div>
  );
}

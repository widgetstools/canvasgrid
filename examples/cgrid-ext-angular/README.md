# VelocityGridExt · Angular

Vite + Angular (JIT) consuming packed tarballs from `dist/tarballs/`, not workspace `*` links.

The Angular CLI type-checker compiles source-direct tarballs and fails; Vite
transpiles them the same way the React example does.

```bash
# from repo root
npm run examples:install
npm run dev:ext-angular
```

Opens [http://localhost:5203](http://localhost:5203).

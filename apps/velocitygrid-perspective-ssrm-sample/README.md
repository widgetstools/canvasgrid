# Perspective SSRM + VelocityGridExt sample

**VelocityGridExt** with Customize → **Data provider** using the **real**
shared DataProvider editor (`openProviderEditorPopout`).

**Apply** maps the catalog STOMP config onto `StompPerspectiveProvider` (SSRM).

## Flow

1. Customize → Data → Data provider  
2. **Edit…** / **Manage…** → full DataProvider editor (Connection / Fields / Columns / Behaviour / Diagnostics)  
3. **Apply** → Perspective SSRM bind  

## Run

```bash
npm run build:kernel
npm run dev:stomp
npm run dev:perspective-ssrm-sample
# → http://localhost:5201
```

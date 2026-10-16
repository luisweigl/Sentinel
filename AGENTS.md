# Agent Instructions

- strictly typescript, no javascript
- React + Vite frontend
- Node.js + Express backend
- Sqlite database
- keep architecture simple
- no unnecessary dependencies
- focus on small, effective changes
- always run tests on changes
- prefer simple solutions over unnecessary abstractions
- Before making architectural changes, read PROJECT.md.
- After changing a file, run format

## Frontend / UI

- Never implement an entire screen from a vague UI request.
- For new screens, propose the information hierarchy and layout first.
- Wait for an approved layout before implementation.
- Implement UI incrementally, one logical section at a time.
- Use mock data before connecting new UI to backend APIs.
- Do not introduce a component library without explicit approval.
- Avoid unnecessary cards, gradients, excessive border radii, and decorative UI.
- Prefer information density and clear hierarchy over visual decoration.
- avoid unnecessary circles and dots

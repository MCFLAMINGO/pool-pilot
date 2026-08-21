# Demo videos (Playwright)

Record a captioned walkthrough of **Arrive → Swap**:

```bash
npm install
npx playwright install ffmpeg   # once — Playwright’s video encoder
npm run demo:arrive
```

Output:
- `demo/out/arrive-demo.webm` (raw Playwright)
- `demo/out/arrive-demo.mp4` (+ copy at `assets/arrive-demo.mp4`)

Uses system Chrome (`DEMO_CHANNEL=chrome`) and a tiny static server on port `4173` (`DEMO_PORT` to override).

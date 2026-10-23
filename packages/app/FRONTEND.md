# Frontend (packages/app)

Expo / React Native app.

Read before building anything:
- Designs: https://app.notion.com/p/3b8541c6b441819f9a81f70c0432d313. They are runnable HTML mockups in a local Open Design folder, not Figma. Read the design before building a screen or a shared component.
- Running on a real phone or the emulator: https://app.notion.com/p/3b7541c6b44181508d22e598bab63842. `bun app` runs it on a phone over USB. The page also covers the emulator setup and the ABI trap.

Before you report a change as done:
- Test it by hand in the app, not just with `bun test`. Start the emulator with `bun emu` (`bun emu:build` after a native change), then go through the change the way the clinic would use it.
- Try the edge cases too: empty lists, cancelled and no-show bookings, going back without saving, saving twice, and Arabic. A test for one case is not proof that the others work.
- Say what you tested and what you didn't. Never call something done that you haven't seen working on screen.
- If the dev build says "There was a problem loading the project" with a code signing error, a release build last generated `android/`. Run `bunx expo prebuild --platform android --no-install` with `LUSTRE_UPDATES_URL` unset, then `bun emu:build`.

Rules:
- `useEffect` is banned and `bun lint` enforces it. Use it only to sync with something outside React: a timer, an animation, a native listener, a subscription. Work out derived state during render. A reaction to a tap goes in the handler. If you truly need it, suppress it on the import: `// biome-ignore lint/style/noRestrictedImports: <the outside thing>`.
- Localize errors from `ERROR_CODE`. Never parse the server's message text.
- Styling uses only the tokens in `src/theme/tokens.ts`, through `StyleSheet.create`.
- `src/components/ui` imports only react, react-native, the theme and its own siblings. `ui/boundaries.test.ts` enforces this.
- Import the API from the `src/api` barrel, never from files inside it. Read failures only through `classifyError`.
- Mutations are never retried. A failed write shows as failed; nothing is queued. Presses that write go through `usePendingAction`.
- Dates from the server arrive as ISO strings even though the inferred type says `Date`. Parse them where you use them.
- `/ws` carries IDs only, never patient data.

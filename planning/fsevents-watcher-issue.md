# Vite dev server not detecting file changes (2026-08-14)

## Symptom

The running `vite` dev server stopped picking up source file edits. No HMR
update fired in the terminal, and the browser kept serving stale bundles no
matter how files were changed (via the editor, or directly on disk).

## Diagnosis steps

1. Confirmed edits were actually landing on disk (`Read`, `git status`,
   `git diff` all showed the real changes).
2. Confirmed the *running* vite server was serving stale content by
   `curl`ing its dev endpoint directly (e.g. `/src/components/FundCard.tsx`)
   and comparing against the file on disk — mismatch confirmed the server,
   not the edit, was the problem.
3. Appended a throwaway marker line directly to a file (bypassing any
   editor/save-tooling) and confirmed via `curl` that even that never
   appeared in what vite served — ruled out editor-specific atomic-write
   quirks.
4. Killed and restarted the dev server (`npm run dev`). This didn't fully
   fix it: a *fresh* server instance still failed to detect a live edit to
   `MarketLayout.tsx`; the only HMR line that printed named an unrelated
   file (`FundCard.tsx`) that had been edited earlier in the session — most
   likely a stale/backlogged filesystem event getting flushed on startup,
   not a live detection.
5. Ruled out config/dependency-graph explanations:
   - `vite.config.ts` has no `watch`/`ignore` overrides.
   - `MarketLayout.tsx` and `FundCard.tsx` don't import each other (both
     are siblings under `FundsPage.tsx`), so there's no HMR-propagation
     reason editing one would ever reference the other.
   - `fsevents` (vite/chokidar's native macOS watcher backend) loads fine
     with the correct arch (universal binary, arm64 present) — not a
     broken/missing native module.
6. Ran the dev server with full debug logging (`DEBUG=vite:*`, added
   temporarily as a `warrior-dev-debug` entry in `.claude/launch.json`) and
   made a real edit. **Zero** log output was produced for that edit — not
   even the routine internal `vite:load [fs]` lines that fire for every
   file during normal operation. This is the key finding: the watcher
   isn't seeing the change at the OS level, in any process, regardless of
   debug verbosity.
7. Checked the filesystem itself: `/Users/michael/code/warrior-market` is
   on a plain local APFS volume (`/dev/disk3s5`, journaled, local — not a
   network mount, not synced storage, no symlinks in the path). Ruled out
   a virtualized/network-mount explanation.

## Conclusion

Real file writes land on disk correctly and are visible to every
POSIX-level tool (`git`, `stat`, `grep`, `curl` against vite's own
transform endpoint eventually reflects them after a restart). But the
FSEvents kernel-notification stream — which `fsevents`/chokidar rely on to
tell vite "this file changed" — isn't reaching any Node process in this
environment, immediately from a cold start, no matter how the dev server
is launched. That points to something restricting access to the FSEvents
notification channel itself in this session's environment, not a bug in
vite, the project's config, or the edits being made.

## Actions taken

- Killed the original stale dev server process and restarted it (temporary
  relief only — did not fix live detection going forward).
- Added and later removed a temporary `warrior-dev-debug` entry in
  `.claude/launch.json` (ran `npm run dev` with `DEBUG=vite:*`) purely for
  diagnosis; it has been removed and `launch.json` is back to its original
  single `warrior-dev` entry.
- No changes were made to `vite.config.ts` or any other project file as
  part of this investigation (test marker lines added to `MarketLayout.tsx`
  during diagnosis were removed afterward).

## Suggested fix (not yet applied)

Add polling-based watching to `client/vite.config.ts`, which bypasses
FSEvents entirely and just re-stats files on an interval:

```ts
export default defineConfig({
  // ...
  server: {
    watch: {
      usePolling: true,
    },
    // ...
  },
})
```

This costs a bit of CPU/battery but sidesteps the root cause regardless of
why FSEvents isn't propagating. Until applied, expect to need a manual dev
server restart to pick up file changes.

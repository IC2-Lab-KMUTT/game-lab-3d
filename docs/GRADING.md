# Grading guide: checking a submission

This is individual work. Each student hands in **`<studentId>_<Student_Name>.zip`** (made by `npm run submit`,
e.g. `66070501234_Somchai_Jaidee.zip`) and **a link** to the deployed game.

The **build ID** is the first 8 hex digits of a SHA-256 over the sorted paths and contents of `src/`,
`index.html`, `package.json` and the `public/` assets the game uses (all of `public/assets/` if no
`startGame` is set). Text files are hashed with LF line endings, so Windows and Mac/Linux checkouts agree
(see `scripts/build-id.mjs`). Every build shows it in the game's bottom-left corner (`build 3f9a1c2b`) and
logs `Game Lab 3D build 3f9a1c2b` to the console.

## Quick check (2 minutes)

1. Open the student's link. Read the build ID in the bottom-left corner (or press F12 → Console).
2. It must equal the `Build ID:` line in `SUBMISSION.txt` inside the zip (also in the `.txt` next to the zip).
3. The `Student ID:` and `Name:` lines in `SUBMISSION.txt` should match the file name and the student.
4. Optional: compare the zip's fingerprint with the `.txt` the student handed in:
   `sha256sum <zip>` (Linux/Mac) or `Get-FileHash <zip>` (Windows PowerShell).

## Full check (rebuild from source)

```
unzip 66070501234_Somchai_Jaidee.zip -d somchai && cd somchai
npm ci
npm run build-id     # recomputes the ID from the source: must print the ID shown on the live page
npm test             # optional: SUBMISSION.txt also records whether tests passed
npm run build        # rebuilds dist/; `npx vite preview` serves it at http://localhost:4173
```

- If `npm run build-id` prints the same ID the live page shows, the deployed game came from this source.
- The zip carries only the kit assets the game uses plus anything the student added or changed, so
  it rebuilds on its own without the full kit.
- `SUBMISSION.txt` lists the sha256 of every file in the zip, the UTC time it was made, and the test result.
- The zip already contains the student's built `dist/` and `dist-single/index.html`. You can open
  `dist-single/index.html` straight from disk to play offline (double-click; no server needed).

Caveats:
- The ID covers the game source and the assets it uses, not `tests/`, `scripts/` or `docs/`.
- A student could deploy code that differs from the zip only by also faking the label in the page. That
  takes deliberate effort; rebuilding and comparing behaviour catches it.
- The build ID changes with any edit, including re-running `npm run submit` after a tiny fix. Grade the zip
  whose ID matches the link.

## Claude artifact links

Students on the class Claude organisation can share an artifact with the organisation, and graders in the
same organisation can open it. Students who used a **personal account** (Pro/Max) must share the artifact
**publicly**; `docs/DEPLOY.md` tells them to check the link in a private window.

Artifact limits to know: one HTML file of at most 16 MiB, nothing loaded from other sites (except a few
script CDNs), no downloads. The kit's single-file build packs everything in and refuses to build over 15 MiB.

## Netlify Drop

Sites deployed **without an account are deleted after about an hour** unless the student claims them. A
dead `*.netlify.app` link usually means they forgot. The zip still lets you play: open
`dist-single/index.html` or serve `dist/`.

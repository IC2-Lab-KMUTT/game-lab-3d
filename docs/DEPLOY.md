# Submitting and deploying your game

This is **individual work**. At the end of the exam you hand in **two things**:

1. **Your code, frozen**: the zip made by `npm run submit`, named with your student ID and name,
   e.g. `submission/66070501234_Somchai_Jaidee.zip`.
2. **A link to your game, deployed**, so graders can play it in a browser without running your code.

Both carry the same **build ID**, a short code like `3f9a1c2b` computed from your source files.
The running game shows it in tiny text in the **bottom-left corner** (`build 3f9a1c2b`) and in the
browser console (F12). `npm run submit` prints it and writes it into `SUBMISSION.txt` inside the zip.
If the ID on the live page matches the zip, the grader knows the link runs the code you handed in.
Change one character in `src/` and the ID changes, so **deploy again after your last edit**.

> Checked on 2026-10-14. Hosting sites change their buttons often; if a step looks different, go
> with what the site says. Steps marked *(not verified end-to-end)* were checked against the
> provider's docs but not actually clicked through by us.

---

## 0. Freeze your code (do this first, every time you deploy)

1. In `src/config.js`, fill in who you are and which game opens first:
   ```js
   studentId: '66070501234',
   studentName: 'Somchai Jaidee',
   startGame: 'my-game',
   ```
   `startGame` makes the link open straight into your game instead of the menu. It also keeps the deploy
   small: `dist/`, the single file and the zip then carry only the assets your game uses, not the whole
   100+ MB library. (The asset paths must be written out in your code; see A.)
2. Run:
   ```
   npm run submit
   ```
   (or `npm run submit -- 66070501234 "Somchai Jaidee"` to pass your ID and name directly).

What it does:
- runs `npm test`. **Failing tests do not stop the submission**: handing in on time matters more. The
  result is written into `SUBMISSION.txt` and graders will see it.
- builds `dist/` (the normal website) and `dist-single/index.html` (the whole game in one file).
  If `dist/` fails to build, it stops: fix the error first.
- writes `submission/<studentId>_<Student_Name>.zip` (source + `dist/` + `dist-single/` + `SUBMISSION.txt`)
  and `submission/<studentId>_<Student_Name>.txt` (the same info, the build ID and the zip's sha256 fingerprint).
- warns you if your student ID is still the placeholder `6xxxxxxxxxx` or isn't 11 digits.

It prints the build ID at the end. Deploy, then check that the live page shows the same ID.

**Ask your agent:**
> Set studentId to "66070501234", studentName to "Somchai Jaidee" and startGame to my game in src/config.js, run `npm run submit`, and tell me the build ID and the zip path.

Other commands, if you need them on their own:

| Command | Makes |
|---|---|
| `npm run build` | `dist/`: a normal website folder (GitHub Pages, Netlify, Vercel, Render) |
| `npm run build:single` | `dist-single/index.html`: one self-contained file (Claude artifact) |
| `npm run preview:artifact` | serves that one file at http://localhost:4180 with artifact-like security rules, so you can test it first |
| `npm run build-id` | prints the build ID of the current source |

---

## A. Claude Code artifact (main option)

Claude Code can publish **one HTML file** as a page on claude.ai, and you can share it with a link.
`npm run build:single` makes that file: the code, styles, and every model, texture, and sound your game
uses are packed inside it.

Rules the artifact page enforces (from code.claude.com/docs/en/artifacts):
- **At most 16 MB.** Our build stops at 15 MB and lists your biggest assets. Assets get about a third bigger when packed.
- Nothing can be loaded from the internet or from other files. That's why everything is packed in.
- Your code must mention every asset path as a full string, e.g. `'/assets/models/tree.glb'`. A path built
  at runtime like `` `/assets/models/${name}.glb` `` can't be found by the build. Add a list somewhere in
  your game: `export const ASSETS = ['/assets/models/tree.glb', '/assets/models/rock.glb'];`
- The menu's "☰ Games" button reloads the page with `?game=…`. That might not work inside the artifact
  viewer *(not verified)*, so set `startGame` in `src/config.js`.

**Ask your agent:**
> Run `npm run submit`. Then test `dist-single/index.html` with `npm run preview:artifact` and fix any console errors. Then publish `dist-single/index.html` as an artifact and give me the link.

**Do it yourself:**
1. `npm run submit` (or just `npm run build:single`).
2. Optional check: `npm run preview:artifact`, open http://localhost:4180, play, and look for red errors or "Refused to…" in the console (F12).
3. In Claude Code, ask it to publish `dist-single/index.html` as an artifact.
4. Open the artifact on claude.ai → **Share** → copy the link.
5. Check the link opens and the corner shows your build ID.

Who can open the link:
- **Your class Claude account (the shared organisation):** share it with the organisation. Graders are in
  the same organisation, so they can open it.
- **A personal account (Pro/Max) or anything outside the class organisation:** make the link **public**
  (Share → public link), then open it in a private/incognito window to check it works without logging in.
  If graders can't open your link, it doesn't count.

---

## B. GitHub Pages (free, no build server)

1. On github.com: **New repository** → name it → **Public** → **Create**. (On a personal GitHub account,
   Pages only works for free on public repositories, and graders must be able to open it.)
2. Upload the **contents** of `dist/` (`index.html` and the `assets` folder) to the repo root:
   **uploading an existing file** → drag them in → **Commit changes**.
3. `dist/` also contains an empty `.nojekyll` file. File pickers often hide it, so if it didn't upload:
   **Add file → Create new file**, name it `.nojekyll`, leave it empty, **Commit**. (Without it, GitHub hides
   files starting with `_` and parts of the game can break.)
4. **Settings → Pages** → Source: **Deploy from a branch** → `main` / `(root)` → **Save**.
5. A minute later: `https://<user>.github.io/<repo>/`. The build works from a sub-path like that.
   Check the build ID in the corner. *(The sub-path part was tested locally; the GitHub clicks were not
   tested end-to-end.)*

Your agent can't create repositories or upload for you here (pushing to GitHub is blocked on exam
computers). These browser steps are yours.

---

## C. Netlify Drop (no account needed, but you MUST claim the site)

1. `npm run submit` (or `npm run build`).
2. Go to **https://app.netlify.com/drop**.
3. Drag the **`dist` folder** (the folder itself, not the zip and not the whole project) onto the page.
4. You get a link like `https://random-name-123.netlify.app`.
5. **Claim the site right away** (sign up or log in with the link on the page). Sites made without an account are
   **deleted after about an hour** unless you claim them. Netlify's docs say anonymous deploys "can be claimed
   within one hour"; we couldn't confirm the exact wording for Drop.
6. Open the link and check the build ID in the corner.

To update it: log in → your site → **Deploys** → drag the new `dist` folder onto the drop area at the bottom.

**Ask your agent:**
> Run `npm run submit` and tell me where the `dist` folder is so I can drag it to app.netlify.com/drop.

(Your agent can't drag files or log in for you. Those browser steps are yours.)

---

## D. Vercel Drop (needs a free Vercel account)

1. `npm run submit`.
2. Log in at vercel.com (the free "Hobby" plan is enough) and go to **https://vercel.com/drop**.
3. Drop the **`dist` folder** (a `.zip` of just `dist` also works).
4. Wait for the deploy, then open the `….vercel.app` link and check the build ID.

Each drop creates a **new project** (it doesn't update the old one), so hand in the newest link. *(not verified end-to-end)*

---

## E. Render static site (via a GitHub repo you create in the browser)

1. On github.com: **New repository** → name it → **Public** → **Create**.
2. Unzip your `submission/<studentId>_<Student_Name>.zip` into a new folder. It holds only the assets your
   game uses, so it's small. On github.com click **uploading an existing file** and drag in everything from
   that folder **except** `dist`, `dist-single` and `SUBMISSION.txt`. Don't upload the project folder itself:
   its `public/assets` has the whole library (2000+ files). The web uploader takes at most 100 files at a
   time; upload in batches if needed. **Commit changes**.
3. On **https://render.com** (free account): **New → Static Site** → connect GitHub → pick the repo.
4. Build Command: `npm ci && npm run build` · Publish Directory: `dist` → **Create Static Site**.
5. After the deploy you get `https://<name>.onrender.com`. Check the build ID matches. If you uploaded
   exactly the same files, it will. *(not verified end-to-end)*

---

## Check that the link matches your zip

- The live page's corner says `build XXXXXXXX`. The same ID is printed by `npm run submit`, and is in
  `SUBMISSION.txt` inside your zip and in `submission/<studentId>_<Student_Name>.txt`.
- If they differ, you changed code after building. Run `npm run submit` again and redeploy.

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| **Blank page** on GitHub Pages/Netlify/Vercel/Render | You uploaded the wrong folder. Upload the contents of `dist` (it has `index.html` directly inside), not the project or `src`. On Render, the publish directory must be `dist`. |
| Blank page, console says a `.js` file is 404 on GitHub Pages | `.nojekyll` is missing; see B step 3. |
| `build:single` says **too big** | Shrink or remove the listed assets: lower-poly models, 1024px or smaller textures, `.ogg`/`.mp3` instead of `.wav`, shorter music. Or use options B–E, which have no 16 MB limit. |
| Artifact loads but a **model/sound is missing** | Its path isn't written out as a full string in `src/`. Add it to an `ASSETS` list (see A) and rebuild. The console says "not embedded in this single-file build". |
| Artifact console shows **"Refused to load…"** | Something loads from the internet (a font, CDN script, image URL). Download it into `public/assets/` instead. |
| Graders can't open your **artifact link** | It was made on a personal account and isn't public. Share → public link, or also deploy with B. |
| **Netlify site vanished** | You didn't claim it within the hour. Deploy again and claim it right away. |
| `npm run submit` warns about **studentId / studentName** | Fill them in in `src/config.js` (11-digit ID) and run it again. |
| `npm run submit` says *source files changed while submitting* | Something edited files during the run. Stop editing and run it again. |
| Build ID in the game says **`dev`** | You're looking at `npm run dev`. Only builds have a real ID. |

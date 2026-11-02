# ICC Pulse - Part 3, Stage 3

Test a manual event refresh on GitHub and explicitly deploy the accepted result.
Daily scheduling is not enabled. The website, collector, and accepted data are
not replaced by this package.

## Added files

- `.github/workflows/refresh-and-deploy.yml`: manual refresh and deployment.
- `prepare_pages.py`: validates accepted data using the existing collector and
  assembles only the public website files. `--check` does not write files.
- `HOSTING_STAGE3_README.md`: this guide.

## Install on Windows

Extract the ZIP somewhere temporary. Copy its `.github` folder and both root
files into your existing ICC Pulse folder. The workflow must end up at:

`ICC Pulse\.github\workflows\refresh-and-deploy.yml`

The Python helper must sit beside `refresh_events.py`, not in a nested package
folder. If these new filenames already exist with personal edits, retain those
edits and compare before replacing.

In the VS Code PowerShell terminal, run each command separately. Stop on errors.

```powershell
Set-Location "C:\Users\Justi\OneDrive\Desktop\Pandas Projects\ICC\ICC Pulse"
git pull --ff-only
python prepare_pages.py --check
python refresh_events.py --self-test
git add -- .github/workflows/refresh-and-deploy.yml prepare_pages.py HOSTING_STAGE3_README.md
git --no-pager diff --cached --stat
git commit -m "Add manual event refresh and Pages deployment"
git push
```

Expected: accepted-data validation passes, all 10 collector safety checks pass,
and the staged change includes exactly three new files. The check does not
download new events or change your accepted JSON. Its accepted-data validation
does not require the saved file to be freshly collected today.

## Change Pages to use the workflow

1. Wait for any existing branch-based Pages deployment to finish.
2. Open https://github.com/Zellet/icc-pulse/settings/pages.
3. Under Build and deployment, change Source to **GitHub Actions**.
4. Do not create a suggested starter workflow: this package supplies one.

This source change keeps the public address. New deployments will now use the
custom workflow. During Stage 3, pushing edits alone will not publish them;
start the manual workflow to refresh and deploy. The previous published site
remains available while a new run is being prepared.

## Run once

1. Open https://github.com/Zellet/icc-pulse/actions.
2. Select **ICC Pulse - Refresh and deploy** in the sidebar.
3. Select **Run workflow**, choose **main**, then confirm **Run workflow**.
4. Open the new run. Wait for **Refresh and prepare** and **Deploy website**.

Avoid editing/pushing the project while this test runs. The workflow serializes
its runs and rejects a push if main has advanced during collection. It never
force-pushes or automatically resolves a concurrent change.

No personal access token, password, or new repository secret is needed. The
workflow requests repository-write permission only for the refresh job and
Pages/OIDC permissions only for deployment. If account policy or branch rules
block those permissions, send the error rather than disabling protections.

## What happens

1. A GitHub-hosted Ubuntu runner checks out current main and uses Python 3.13.
   Your Windows Python installation does not need to change.
2. It installs requirements, validates existing accepted data and website files,
   and runs the original collector's 10 safety tests.
3. It runs `python refresh_events.py` with no count-change override. The public
   API and RSS must both succeed and pass the collector's existing validation.
4. It validates and copies the accepted data and website to a temporary folder.
5. It commits only `data/events.json` to main using GitHub's built-in bot token.
6. It uploads the prepared website and explicitly deploys it to GitHub Pages.

The public package contains HTML, CSS, JavaScript, the logo, accepted JSON,
and `.nojekyll`. It excludes Python, samples, documentation, and diagnostics.
The repository still contains those tracked development files.

The collector's log says it has not deployed a website. That remains accurate:
the separate workflow deployment job performs publication afterward.

An explicit deployment is necessary because commits pushed with GITHUB_TOKEN
do not themselves trigger a branch-based Pages build.

## Verification

- Both workflow jobs finish green.
- The Collect and validate fresh events step reports success and an event count.
- The run summary shows the accepted timestamp and accepted-data commit.
- Main has a new `Refresh accepted ICC Pulse events` commit.
- Reload https://zellet.github.io/icc-pulse/ (Ctrl+F5 on Windows). Confirm its
  update timestamp represents the same instant as the run summary; the site
  may display Pacific time while the JSON shows UTC.
- Check an event popup and another calendar view on the public site.

Counts can legitimately change. Do not require exactly 20 events.

Finally bring the runner-created commit back to your computer:

```powershell
git pull --ff-only
python preview_website.py --check
git status
```

Expected: local accepted timestamp matches GitHub and the working tree is clean.
If local changes block the pull, stop and retain them; do not reset or overwrite
your local JSON. Share the error to reconcile the files safely.

## Failure behavior

- Failed safety tests, source downloads, or candidate validation stop the job.
  No data commit or deployment follows; the existing repository data and live
  site remain unchanged.
- A missing website file or invalid accepted file prevents packaging/deployment.
- A concurrent push or rejected write prevents artifact upload and deployment.
- If the data commit succeeds but upload/deployment fails, repository data may
  be newer than the live site. The existing deployment remains available. Fix
  the error and start a new manual run; do not report a new live timestamp until
  deployment and public-site checks succeed.
- The collector backup and reports are on the temporary runner and are not
  committed. Previous accepted versions remain in Git history. Reports appear
  in the collector step's log; save the error text if troubleshooting is needed.
- If the fresh result is held for suspicious loss or empty data, investigate it
  rather than adding `--accept-count-change` to the workflow.

If publication must return to the previous branch-based setup, first inspect
main's accepted file, then change Pages Source to Deploy from a branch, main,
root. This republishes current main, which might differ from the older live
site if a data commit succeeded before deployment failed.

## Checks performed before delivery

The unchanged collector passed all 10 safety tests. Isolated packaging checks
verified exact accepted-data copying, source preservation, public-file
selection, rejection of candidate data, wrong counts, duplicate IDs, missing
assets, and refusal to overwrite an existing output folder. YAML structure,
shell syntax, manual-only triggering, and deployment dependencies were checked.

GitHub-hosted source access, repository permissions, and actual Pages deployment
must still be verified by the first run above. A local test is not proof that
GitHub can reach DVC Synch. Daily scheduling and monitoring belong to Stage 4.

## Official references

- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://github.com/actions/checkout
- https://github.com/actions/setup-python

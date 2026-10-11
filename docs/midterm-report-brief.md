# Brief: write the Preflux mid-term progress report

**Attach these files with this brief:**
1. `preflux_synopsis.pdf`: our approved synopsis. It's the source for the project description, objectives, literature and methodology.
2. `mid_term.pdf`: a sample mid-term report from another project (WebLingua). **Copy its structure, chapter order, headings, formatting and level of detail exactly. Do not copy its content.**
3. Optional: `docs/ml-evaluation.md` and `docs/features.md` from the Preflux repo, for exact ML numbers and feature definitions.

**Your task:** write the mid-term progress report for **Preflux – A Pre-Push Code Security and Risk Analysis System**. Follow the sample's structure section by section. Fill it with Preflux content from the synopsis and from the **actual progress described below**. Every number in this brief is real and measured; use them as given.

---

## 0. Ground rules (important)

- **Be honest about progress.** Objective 1 (secret detection) is complete. Half of Objective 2 (bug-risk prediction) is complete. Structural conflict detection, the Push Safety Score, the LLM explanations and the team dashboard are **not built yet**. Describe those as *designed / planned*. Never write that they work.
- **Don't invent numbers, screenshots, test results or users.** Where a screenshot is needed, put a clearly marked placeholder (see section 9).
- **Stack change from the synopsis.** The synopsis said MERN (MongoDB, Express, React, Node). We changed the dashboard and backend to **Next.js + Supabase (PostgreSQL)**. Mention this once, with the justification in section 4.
- **Tone:** formal academic English, like the sample. Paragraphs of 4–7 lines. Bold module names in bullet lists, as the sample does.
- **Length:** about 22–28 pages, similar to the sample.

---

## 1. Format (match the sample)

- **Output:** LaTeX source plus the compiled **PDF**. The sample is LaTeX: Times font, about 1.5 line spacing, justified text, page numbers centred at the bottom, a clickable table of contents with boxed links (hyperref), numbered figures with captions *below* them. If LaTeX isn't possible, produce a .docx with the same look.
- Front matter, in order: **Cover page → Contents (2 pages) → List of Figures → List of Tables** (we have tables; the sample didn't) → Chapter 1 …
- Numbering: chapters `1`, sections `1.1`, subsections `4.1.1`, exactly like the sample.
- Diagrams: draw them as the sample does (TikZ or equivalent), with rounded rectangles in soft colours, labelled arrows, and DFD processes as numbered circles (`1.0`, `2.0`, …). **No hand-drawn or AI-image diagrams.**

### Cover page (same layout as the sample)
```
A Midterm Progress Report
On

Preflux – A Pre-Push Code Security and Risk Analysis System

Submitted in partial fulfillment of the requirements for the award of the degree of

BACHELOR OF TECHNOLOGY
(Computer Science and Engineering)

SUBMITTED BY
CHARU (2302502)
BHUMI (2302500)
ADITI KAUSHAL (2302459)

OCTOBER 2026

[GNDEC logo]

Department of Computer Science & Engineering
GURU NANAK DEV ENGINEERING COLLEGE, LUDHIANA
```
Names are in the synopsis's order. The team may change the order or the month.

---

## 2. Chapter-by-chapter content

### 1 Introduction
**1.1 Project Overview.** Base it on the synopsis Introduction and Rationale, about 1 page:
- Developers accidentally push API keys, passwords and tokens to GitHub, where bots scrape them within minutes (Meli et al., NDSS 2019).
- Existing tools (GitHub Secret Scanning, GitGuardian, Gitleaks, TruffleHog) mostly detect secrets **after** the code reaches the remote. Git's merge-conflict detection is text-based, and code review doesn't use historical defect data.
- Preflux runs **locally as a Git pre-push hook**, before code leaves the machine. It combines three analyses:
  - **secret detection:** regex + Shannon entropy
  - **bug-risk prediction:** XGBoost trained on Git history, labelled with SZZ
  - **structural conflict detection:** Tree-sitter ASTs
- Results are combined into a **Push Safety Score**, explained in plain English by an LLM. The LLM never makes the decision.
- Feedback comes through a CLI, plus a web dashboard for teams.
- Design principle from the synopsis: each problem uses the most suitable technique, and AI is used responsibly.

**1.2 Objectives.** Use the synopsis's three objectives, each in bold with a 2–3 line explanation, as in the sample:
1. **To detect and block exposed secrets such as API keys, credentials and access tokens using regex and Shannon entropy analysis locally, before any network call.**
2. **To predict code-change risk using XGBoost trained on Git history, and detect logic-level conflicts using AST-based Tree-sitter analysis beyond traditional text diffs.**
3. **To develop a web dashboard that combines findings into a Push Safety Score, with an LLM providing plain-English explanations and centralised project-wise visibility.** In the synopsis this says "MERN-based dashboard". Write "web dashboard (Next.js + Supabase)", or keep the synopsis wording and add a note about the stack change.

### 2 System Requirements
Same layout as the sample (hardware, then software, as bullet lists). Use these **actual** versions:

**Hardware:**
- *Developer side:* Intel Core i3/i5 or AMD equivalent (development was done on a 4-core machine). 8 GB RAM minimum, 16 GB recommended for model training. 20–30 GB free disk (the mined repositories and venv take about 2 GB). Internet for dependencies, mining public repositories, and the hosted LLM API (later).
- *End user (developer using Preflux):* any Windows/macOS/Linux machine with Git and Node.js. The dashboard needs only a browser.

**Software:**
- **Version control and hooks:** Git 2.x with the pre-push hook. Husky 9 for Node.js projects; a plain `.git/hooks/pre-push` for other projects.
- **CLI:** Node.js 20+ (developed on 23.6) and TypeScript 5.9, with commander, chalk, tsup (bundler) and vitest (testing).
- **ML service:** Python 3.10, FastAPI and Uvicorn, XGBoost 3.2, scikit-learn 1.7, pandas 2.3, NumPy 2.2, PyDriller 2.12 (Git mining), pytest.
- **Dashboard:** Next.js 16 (App Router), React 19, Tailwind CSS 4, `@supabase/supabase-js`.
- **Database / Auth:** Supabase (PostgreSQL with Row-Level Security and Supabase Auth).
- **Structural parsing (Phase 3):** Tree-sitter (`web-tree-sitter`, WebAssembly) with JavaScript, TypeScript and Python grammars.
- **Hosting (planned):** Vercel (dashboard), Render (ML service), Supabase (database), npm registry (CLI).
- **Tools:** VS Code, Git/GitHub, Chrome. OS: Windows 10/11, macOS or Linux.

### 3 Software Requirement Analysis
**3.1 Problem Definition.** About 3 paragraphs, like the sample:
- Security checks happen *after* the push (CI, PR review), when secrets are already in permanent history.
- Secret scanners don't predict defect risk, and Git conflict detection is line-based.
- Preflux moves these checks to the earliest point: the developer's machine, at `git push`.

**3.2 System Modules and Functionalities.** Five modules, each a bold bullet with a short paragraph (as in the sample):
- **Module 1: Secret Detection Module.** 16 vendor-specific regex rules plus keyword-based detection plus Shannon-entropy detection. It scans every added line of every commit being pushed, masks secrets in all output, and **blocks the push** if any secret is found.
- **Module 2: Bug-Risk Prediction Module.** It extracts 11 change-level features locally, an ML service returns a calibrated probability per file, and the result is shown in the terminal.
- **Module 3: Structural Conflict Detection Module.** *(planned)* It parses the base, local and remote versions of files changed on both sides with Tree-sitter, and flags the same function edited on both sides, a signature change against new call sites, and deleted or renamed symbols still referenced.
- **Module 4: Push Safety Score and AI Explanation Module.** *(planned)* `score = 100 × (1 − (0.6·bugRisk + 0.4·conflictRisk))`. Any secret forces BLOCK. ≥ 70 ALLOW, 40–69 WARN, < 40 BLOCK. An LLM, behind a pluggable provider interface, turns findings into plain-English explanations after redaction.
- **Module 5: Team Dashboard Module.** *(planned; landing page done)* Login, projects, push history, bug-risk trends and an audit trail of blocked/allowed pushes. The CLI uploads **masked** results with a per-project token.

---

## 3. Chapter 4 – Software Design (draw all six diagrams)

Intro paragraph: the design keeps everything security-critical local, sends only redacted or numeric data over the network, and keeps each component replaceable.

### 4.1 System Architecture Diagram (Figure 1)
Boxes and arrows:
```
Developer → git push → [Git pre-push hook] → [Preflux CLI (Node.js)]
   inside the CLI: Secret Scanner (local) | Feature Extractor (local) | Conflict Analyzer (planned) | Report
[Preflux CLI] --numeric features only--> [ML Service (FastAPI + XGBoost)]
[Preflux CLI] --masked results (planned)--> [Dashboard (Next.js)] → [Supabase (PostgreSQL)]
[ML Service] --(planned)--> [LLM Provider] (explanations only)
Decision: exit 0 = push allowed / exit 1 = push blocked
```
Then four subsections like the sample's tiers:
- **4.1.1 Developer / CLI Tier.** The Git hook and the `preflux` CLI. It reads the pushed refs from Git, collects the added lines, runs the local analyses, prints the report and returns allow/block.
- **4.1.2 Local Analysis Tier.** The secret detection engine and the feature extractor. Secret checking makes **no network calls**, and it **fails closed**: if the scan cannot run, the push is blocked.
- **4.1.3 ML Service Tier.** FastAPI with `/health` and `/predict`, serving the XGBoost model. It receives only numbers and opaque ids, never code or file names. It **fails open**: if it's down, the push continues with "bug risk skipped".
- **4.1.4 Dashboard and Database Tier.** Next.js plus Supabase PostgreSQL with Row-Level Security (planned for Phase 5; the landing page and DB connection helper exist).

### 4.2 Entity-Relationship Diagram (Figure 2)
This is the planned Supabase schema. Use the sample's table-box style, with PK/FK and 1–M labels:
- **Team** (team_id PK, name, created_at)
- **User/Profile** (user_id PK, name, email)
- **TeamMember** (team_id FK, user_id FK, role): the link between User and Team (M–N)
- **Project** (project_id PK, team_id FK, name, repo_url, score_config): Team 1–M Project
- **ProjectToken** (token_id PK, project_id FK, token_hash, last_used_at): Project 1–M ProjectToken
- **PushEvent** (push_id PK, project_id FK, branch, from_sha, to_sha, author, score, decision, created_at): Project 1–M PushEvent
- **Finding** (finding_id PK, push_id FK, kind (secret/bug_risk/conflict), severity, file, line, rule, masked_snippet, fingerprint, explanation): PushEvent 1–M Finding
- **FileRisk** (risk_id PK, push_id FK, file, probability, features JSON): PushEvent 1–M FileRisk

**4.2.1 Entity Identification and Attribute Design:** a numbered list explaining each entity in 1–2 lines, as the sample does. Note that the database never stores raw secrets, only masked snippets and fingerprints, and that tokens are stored hashed.

### 4.3 Use Case Diagram (Figure 3)
- **Actors:** Developer, Team Lead (dashboard), Git (system actor), ML Service (system actor).
- **Developer:** Install Preflux (`preflux init`); Push code (`git push`); Scan manually (`preflux scan`, `--staged`); View report; Allowlist a false positive.
- **Team Lead:** View project health; View push history; Review blocked pushes (the last two are planned).

### 4.4 Level 0 DFD / Context Diagram (Figure 4)
- **Centre:** `0.0 Preflux System`.
- **Developer → system:** Push request (commits). **System → Developer:** Report + allow/block.
- **Git Repository ↔ system:** Commit history / diffs.
- **System → ML Service:** Feature vectors. **ML Service → system:** Risk probabilities.
- **System → Dashboard DB:** Masked results (planned).
- Follow it with "Inbound Data Flows" / "Outbound Data Flows" bullets, as in the sample.

### 4.5 Level 1 DFD (Figure 5)
- Processes: **1.0** Read Push Refs → **2.0** Extract Added Lines → **3.0** Detect Secrets → **4.0** Extract Change Features → **5.0** Predict Bug Risk → **6.0** Decide & Report.
- Data stores: **D1** Git Repository (feeds 1.0, 2.0, 4.0), **D2** Allowlist/Config (`.prefluxignore`, `.prefluxrc.json`; feeds 3.0), **D3** Trained Model (feeds 5.0).
- Output: report to the Developer, and exit code to Git.

### 4.6 Sequence Diagram (Figure 6)
- **Lifelines:** Developer, Git, Preflux CLI, ML Service, Remote (GitHub).
- **Messages:**
  1. git push
  2. run pre-push hook (sends the ref list)
  3. collect added lines (git log)
  4. scan secrets (local)
  5. extract features (local)
  6. POST /predict (numbers only)
  7. probabilities
  8. print report
  9. exit code 0/1
  10. if 0, upload commits to Remote; if 1, push cancelled

---

## 4. Justification of the stack change (one short paragraph, in 6.1 or 2)
The synopsis proposed MERN. During design we chose **Next.js + Supabase**:
- Supabase provides PostgreSQL, authentication and **Row-Level Security** built in. RLS lets the database itself guarantee that team members only see their own projects' push data.
- Next.js route handlers replace a separate Express server, so there's one deployable unit on Vercel.
- The relational schema (teams → projects → pushes → findings) fits PostgreSQL naturally.

The objectives and features are unchanged.

---

## 5. Chapter 5 – Testing Module

### 5.1 Proposal of Testing Techniques
Bullets, as in the sample:
- **Unit Testing:** entropy maths, diff parsing, allowlist glob matching, masking, each secret rule.
- **Detection Accuracy Testing:** positive cases (one fake key per supported format) and negative cases (normal code that must not be flagged). This measures recall and precision.
- **Integration Testing:** CLI ↔ ML service, using a stub server that also checks that no file paths or code are sent.
- **System (End-to-End) Testing:** real Git repositories and a local bare remote, with real `git push` runs through the installed hook.
- **Parity Testing:** a fixture repository with fixed authors and dates. The Python extractor (training) and the TypeScript extractor (CLI) must produce identical features.
- **ML Evaluation:** a time-ordered train/validation/test split, baselines, and leave-one-project-out validation.
- **Dogfooding:** running Preflux on Preflux's own source code.

Mention that test secrets are **generated at runtime** from a seeded random generator, so no real or realistic key is ever stored in the repository.

### 5.2 Test Cases
Same format as the sample (bold title, then Objective / Execution Steps (a), (b), … / Expected Result). **Also add "Actual Result: Pass"**, because these were all run. Use these 8:

1. **TC01: Installing the pre-push hook.**
   - Steps: `git init` → commit → `preflux init`.
   - Expected: "✔ preflux installed". `.git/hooks/pre-push`, `.prefluxrc.json` and `.prefluxignore` are created. An existing hook from another tool is not overwritten without `--force`.
2. **TC02: Blocking a push that contains an AWS key.**
   - Steps: commit `config.js` containing a fake AWS access key ID → `git push`.
   - Expected: "PUSH BLOCKED", with `CRITICAL aws-access-key-id config.js:1`. The key is shown masked as `AKIA********(20 chars)`. The remote branch is unchanged.
3. **TC03: Secret deleted in a later commit is still caught.**
   - Steps: after TC02, replace the key with `process.env.AWS_KEY` in a new commit → push.
   - Expected: still blocked, because the key exists in the history being pushed. After rewriting history (`git reset` + a clean commit), the push is allowed.
4. **TC04: No false alarms on normal code.**
   - Steps: scan lines such as placeholders (`"your-password-here"`), `os.environ["SECRET"]`, `${DB_PASS}` URLs, commit hashes, UUIDs, data-URI images, SRI hashes and the AWS documentation example key.
   - Expected: PUSH ALLOWED, 0 findings (21 such lines are in the test suite).
5. **TC05: Handling a genuine false positive.**
   - Steps: add `preflux:allow` to the line, or add `fingerprint:<id>` to `.prefluxignore`.
   - Expected: that finding is skipped, and the push is allowed.
6. **TC06: Bug-risk prediction on push.**
   - Steps: start the ML service → commit changes to two source files → push.
   - Expected: the report shows "bug risk: 2 files analysed" with a percentage and a LOW/MED/HIGH level per file, and the push is allowed. Real run on a copy of the koa repository: `lib/application.js` 37% HIGH, `lib/context.js` 22% HIGH.
7. **TC07: ML service unavailable (fail-open).**
   - Steps: stop the ML service → push.
   - Expected: "bug risk skipped (ML service not reachable…)", and the push is still allowed. If the push contains a secret, it is still blocked.
8. **TC08: Live web scanner.**
   - Steps: open the website → "Try it" → click "Load example".
   - Expected: "PUSH BLOCKED: 5 secrets found" (Stripe, AWS, GitHub, password, database URL), each masked. The 4 "safe" example lines are not flagged. Nothing is uploaded; the scan runs in the browser.

Close with a summary table:

| Suite | Tests | Result |
|---|---|---|
| CLI unit + detection accuracy (vitest) | 51 | all pass |
| Feature parity (vitest) | 6 | all pass |
| ML client (vitest) | 5 | all pass |
| End-to-end with real git push (vitest) | 15 | all pass |
| ML service: features, SZZ, training, API (pytest) | 14 | all pass |
| **Total** | **91** | **all pass** |

(The vitest total is 77 across 5 files; pytest is 14.)

---

## 6. Chapter 6 – Performance of the Project Developed (so far)

### 6.1 Current Development Status
Two short paragraphs, then this table:

| Phase | Work | Status |
|---|---|---|
| 0 | Project setup: monorepo, Next.js app, Supabase connection, architecture documents | Completed |
| 1 | Secret detection engine, `preflux` CLI (`init`, `scan`), pre-push hook, live web scanner | Completed |
| 2 | Bug-risk prediction: dataset mining, SZZ labelling, XGBoost model, FastAPI service, CLI integration | Completed |
| 3 | Structural conflict detection (Tree-sitter) | In progress / next |
| 4 | Push Safety Score, redaction, LLM explanations | Planned |
| 5 | Team dashboard: login, projects, push history (Supabase) | Planned |
| 6 | Comparison with Gitleaks/TruffleHog, deployment, final documentation | Planned |

Roughly: Objective 1 is done, Objective 2 is half done, and Objective 3's foundation (website, database connection) is ready.

### 6.2 Module-Wise Performance Evaluation
Bold bullets as in the sample, with these real figures:

- **Secret Detection:**
  - **16** known key formats: AWS access key and secret, GitHub (classic and fine-grained), GitLab, Slack token and webhook, Stripe, Google, OpenAI, Anthropic, SendGrid, npm, private keys, JWT, database URLs with passwords.
  - Keyword detection, plus Shannon-entropy detection (≥ 4.5 bits/char for random strings of 20+ characters; ≥ 3.0 for values assigned to names like `password`).
  - All 16 formats are detected, with **0 false positives** on 21 tricky normal-code lines.
  - Secrets are masked everywhere.
  - Every commit in the push is scanned, not just the final version.
  - **Fail-closed:** an error blocks the push.
  - Running Preflux on its own code first found a real test password (correctly flagged) and an alphabet string. That led to an improvement: random keys almost never contain 6 sequential characters.

- **Bug-Risk Prediction (Machine Learning).** Put these in a table, "Table: Bug-risk model performance on the test set".
  - **Dataset:** 6 open-source repositories (requests, flask, httpie: Python; axios, express, koa: JavaScript), mined with PyDriller. Labelled with **SZZ**, which traces each bug-fix commit back to the commits that introduced the fixed lines.
  - **21,004** labelled changes; **14.6%** bug-inducing. Changes from each repository's last 180 days were excluded, because their bugs may not have been found yet.
  - **Features (11, from Kamei et al. 2013):**
    - lines added and deleted
    - files changed
    - change entropy
    - prior changes to the file
    - number of developers
    - age since the last change
    - prior bug fixes
    - author experience
    - whether the commit is a fix
    - file size
  - **Split:** time-ordered per repository: 70% train (14,700), 10% validation (2,099), 20% test (4,205). The model only ever learns from the past.
  - **Results on test:**

    | Model | Precision | Recall | F1 | ROC-AUC |
    |---|---|---|---|---|
    | **XGBoost (Preflux)** | 0.213 | 0.578 | **0.311** | **0.754** |
    | Logistic regression (baseline) | 0.211 | 0.610 | 0.313 | 0.760 |
    | Size rule (lines changed > 100) | 0.245 | 0.128 | 0.168 | 0.542 |

  - **Interpretation, stated honestly:**
    - Both learned models are clearly far better than the size rule.
    - XGBoost and logistic regression perform about the same on these 11 features.
    - The results are in line with published just-in-time defect prediction (F1 ≈ 0.3–0.5, AUC ≈ 0.75).
    - A 24-configuration hyperparameter search plateaued, so performance is limited by the data, not by tuning.
    - **Leave-one-project-out:** ROC-AUC 0.68–0.72 on repositories the model never saw.
    - **Most important feature:** lines added (about 40% of gain).
    - **Calibration:** probabilities are Platt-calibrated, so they read as real chances. Average predicted 14.4% against an actual 9.9% on the newest data (Brier score 0.085), so they're best read as *relative* risk.
  - **Privacy:** only 11 numbers per file are sent to the model service, never code or file names.
  - **Speed:** feature extraction was optimised from 6.5 s to **0.9 s** for the test repository by batching Git calls, which keeps the pre-push hook fast.
  - **Consistency:** Python (training) and TypeScript (CLI) feature code produce identical results, checked automatically.

- **Website / Dashboard Foundation.**
  - Responsive landing page, with a **live in-browser secret scanner** that uses the same detection engine as the CLI.
  - Database (Supabase) connection helper and a health check.
  - Mobile layout verified at 375 px width.

### 6.3 Ongoing Work and Future Enhancements
Bold bullets:
- **Structural Conflict Detection (next):** Tree-sitter parsing of JS/TS/Python, and a 3-way symbol comparison between local, remote and their common ancestor.
- **Push Safety Score:** a weighted score with a hard block for secrets, and allow/warn/block thresholds.
- **AI Explanation Layer:** client-side redaction plus an LLM, choosing between providers, for plain-English fixes.
- **Team Dashboard:** Supabase Auth login, projects and tokens, push history, risk trends, and an audit trail of blocked/allowed pushes.
- **Evaluation and Deployment:**
  - a detection comparison with Gitleaks and TruffleHog on the same test data
  - deployment to Vercel, Render and Supabase
  - publishing the CLI on npm so that `npx preflux init` works

---

## 7. Chapter 7 – Output Screens
One subsection per screenshot. Each gets 1–2 explanatory paragraphs and a numbered figure caption, as in the sample. **Use placeholders like `[SCREENSHOT: …]`. The team will capture the real images** (instructions in section 9).
- **7.1 Homepage:** the Preflux landing page hero: "Stop leaked secrets before they leave your laptop."
- **7.2 Live Secret Scanner:** after "Load example": PUSH BLOCKED, 5 secrets, masked values.
- **7.3 Blocked Push in the Terminal:** `git push` output with a CRITICAL `aws-access-key-id` finding, masked key, fix steps, "PUSH BLOCKED".
- **7.4 Bug-Risk Report in the Terminal:** push output with "bug risk: 2 files analysed" and percentages per file, then PUSH ALLOWED.
- **7.5 ML Service Health Check:** browser at `http://127.0.0.1:8000/health` showing `"status":"ok"` and the model version.
- **7.6 Automated Test Results:** terminal showing `77 passed` (vitest) and `14 passed` (pytest).
- **7.7 Model Evaluation Report:** the results table from `docs/ml-evaluation.md`.

---

## 8. References
IEEE-style numbered list, like the sample. Include the synopsis references, plus the ones we actually used:
1. M. Meli, M. R. McNiece, B. Reaves, "How Bad Can It Git? Characterizing Secret Leakage in Public GitHub Repositories," NDSS, 2019.
2. Y. Kamei et al., "A Large-Scale Empirical Study of Just-in-Time Quality Assurance," IEEE TSE, 39(6), 757–773, 2013.
3. J. Śliwerski, T. Zimmermann, A. Zeller, "When Do Changes Induce Fixes?," ACM SIGSOFT SEN, 30(4), 1–5, 2005.
4. T. Chen, C. Guestrin, "XGBoost: A Scalable Tree Boosting System," ACM SIGKDD, 785–794, 2016.
5. J. Platt, "Probabilistic Outputs for Support Vector Machines and Comparisons to Regularized Likelihood Methods," Advances in Large Margin Classifiers, 1999. *(the calibration method)*
6. Z. Feng et al., "CodeBERT: A Pre-Trained Model for Programming and Natural Languages," Findings of EMNLP, 2020.
7. Gitleaks. [Online]. Available: https://github.com/gitleaks/gitleaks
8. Tree-sitter Documentation. [Online]. Available: https://tree-sitter.github.io/tree-sitter/
9. PyDriller Documentation. [Online]. Available: https://pydriller.readthedocs.io/
10. XGBoost Documentation. [Online]. Available: https://xgboost.readthedocs.io/
11. FastAPI Documentation. [Online]. Available: https://fastapi.tiangolo.com/
12. Next.js Documentation. [Online]. Available: https://nextjs.org/docs
13. Supabase Documentation. [Online]. Available: https://supabase.com/docs
14. Git Hooks (pre-push). [Online]. Available: https://git-scm.com/docs/githooks

---

## 9. For the team: how to capture each screenshot (Windows PowerShell)
These are not part of the report. They tell you how to replace each placeholder.

| Figure | How |
|---|---|
| 7.1, 7.2 | `cd D:\charu\Preflux; npm run dev:web`, then open http://localhost:3000, screenshot the top. Then go to "Try it" → "Load example" and screenshot the results. |
| 7.3 | In a demo repo where you ran `preflux init`, commit a file with a fake AWS key → `git push` → screenshot the terminal. |
| 7.4 | Start the ML service (`cd D:\charu\Preflux\services\ml; .\.venv\Scripts\python -m uvicorn app.main:app --port 8000`), then in a second terminal commit changes to 2 `.js`/`.py` files and push. |
| 7.5 | With the service running, open http://127.0.0.1:8000/health in a browser. |
| 7.6 | `cd D:\charu\Preflux; npm run test:cli`, then `cd services\ml; .\.venv\Scripts\python -m pytest`. |
| 7.7 | Open `docs\ml-evaluation.md` in VS Code (Markdown preview) and screenshot the first table. |

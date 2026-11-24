# Team setup: run Preflux on your own laptop

Written for teammates on **Windows**. Run every command in **PowerShell**, inside VS Code's terminal (**Terminal → New Terminal**).
Copy one command at a time and press Enter.

---

## 0. Install these once

| Tool | Get it from | Check it works |
|---|---|---|
| Git | git-scm.com | `git --version` |
| Node.js 20 or newer (LTS) | nodejs.org | `node --version` |
| Python 3.10 or newer | python.org (tick **"Add python.exe to PATH"**) | `python --version` |
| VS Code | code.visualstudio.com | |

Tell Git who you are (once per laptop):
```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

---

## 1. Get the code

**Clone, don't fork.** Charu adds you as a collaborator (GitHub → Preflux → Settings → Collaborators → Add people), and you accept the email invite.
We all push to the **same** repository. That is what lets Preflux's Collision Radar see each other's branches; a fork is a separate copy, so the Radar can't see it.

```powershell
cd D:\
git clone https://github.com/charu1110/Preflux.git
cd Preflux
code .
```

---

## 2. Install and build

```powershell
npm install
npm run build:cli
cd packages\cli
npm link
cd ..\..
preflux --version
```
The last command should print `0.1.0`. `npm link` puts the `preflux` command on your laptop, so Git hooks can find it.

**If `npm install` fails with a certificate / SSL error** (common on college Wi-Fi), run this once in the same window and try again:
```powershell
$env:NODE_OPTIONS = "--use-system-ca"
```

---

## 3. Start the bug-risk service (ML)

```powershell
cd services\ml
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```
Leave this window open. In a browser, open http://127.0.0.1:8000/health: it should show `"status":"ok"`.
The trained model is already in the repository (`services/ml/models`), so you don't need to train anything.

**If pip fails with an SSL error,** use your normal Python's pip to install into the venv:
```powershell
python -m pip install --python .\.venv\Scripts\python.exe -r requirements.txt
```

---

## 4. Check everything works (tests)

Open a **second** terminal (the + button), go to the Preflux folder and run:
```powershell
npm run test:cli
```
You should see all tests **passed**. Then the ML tests:
```powershell
cd services\ml
.\.venv\Scripts\python -m pytest -q
cd ..\..
```

---

## 5. Try Preflux yourself (5 minutes)

Make a practice repository **outside** the Preflux folder:
```powershell
mkdir D:\preflux-practice
cd D:\preflux-practice
git init
"function add(a, b) { return a + b }" | Out-File -Encoding utf8 calc.js
git add .
git commit -m "first commit"
preflux init
```

**Test 1: a secret gets blocked.** This makes a *fake* key in the AWS format (random letters, not a real key) and commits it:
```powershell
$fake = "AKIA" + -join ((1..16) | ForEach-Object { "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[(Get-Random -Maximum 32)] })
"const accessKeyId = `"$fake`";" | Out-File -Encoding utf8 config.js
git add config.js
git commit -m "add config"
preflux scan --range HEAD~1..HEAD
```
You should see **PUSH BLOCKED**, with the key shown masked as `AKIA********`.

**Test 2: undo it.**
```powershell
git reset --hard HEAD~1
```
(This deletes the practice commit. Only run it in the practice folder.)

**Test 3: the website.** Back in the Preflux folder:
```powershell
cd D:\Preflux
npm run dev:web
```
Open http://localhost:3000 and click **Try the scanner → Load example**.

---

## 6. The team dashboard (optional)

1. Copy the example settings file:
   ```powershell
   Copy-Item apps\web\.env.example apps\web\.env.local
   ```
2. Ask Charu for the two Supabase values in a **private message** and paste them into `apps\web\.env.local`.
   This file is git-ignored, so it never goes to GitHub. **Never** paste keys into code, README files or group chats.
3. `npm run dev:web`, open http://localhost:3000/dashboard, and create an account with your own email.
4. Charu adds you to the project (project page → **Team**).

**AI explanations:** open any push and click **✨ Explain with AI**. This works on the dashboard server that has the Claude key: the deployed dashboard (once it's on Vercel), or Charu's laptop during a demo. The key lives only on that server. On your own laptop's copy you'll see "AI explanations are not set up", and that's expected: **don't ask for the key, and never put it in a chat or a file you commit.**

---

## 7. Test as a team (the Collision Radar)

Charu creates a small GitHub repository (for example `preflux-playground`) with a `calc.js` that has two functions, and adds everyone as collaborators. Then:

1. Everyone clones it and runs `preflux init` inside it.
2. **Person A** edits the **first** function and pushes to `main`.
3. **Person B**, *without pulling*, makes a branch, edits the **same** function on different lines, and pushes:
   ```powershell
   git checkout -b b/my-change
   git commit -am "my change"
   git push -u origin b/my-change
   ```
   Preflux warns that the same function was changed on `main`, and names Person A.
4. **Person C** edits the **second** function on their own branch and pushes it. When Person B pushes again, Preflux shows a **TEAM heads-up** naming Person C's branch.

---

## Safety rules for everyone

- Never commit `.env` or `.env.local` files. `.gitignore` already blocks them.
- Never share real keys in chats or screenshots.
- If Preflux blocks your push, read the "How to fix" lines. Don't bypass it with `--no-verify` unless you are sure it is a false alarm.
- Pull before you start work: `git pull`.

## Stuck?

| Problem | Fix |
|---|---|
| `preflux` is not recognised | Run step 2 again (`npm link` inside `packages\cli`), then open a new terminal |
| `bug risk skipped (ML service not reachable)` | The ML window from step 3 is closed: start it again |
| `conflicts skipped (no remote named "origin")` | Normal in the practice folder: it has no GitHub remote |
| Scripts are disabled in PowerShell | Run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |

# LabLend: submission sheet

Everything the hackathon asks for, in order, ready to copy into the form.
Fill in the four `<…>` placeholders (live link, repository link, team, roles) before submitting.

---

## Project name

LabLend

## One-line description

A trusted platform that helps a university and its community safely share underused labs, studios and specialist equipment, with eligibility checks, fair allocation, condition records and an auditable history.

## Short description (if the form asks for a summary)

LabLend lets university departments and community partners share equipment and spaces that sit idle (laser cutters, 3D printers, CNC routers, cameras, podcast studios, seminar rooms, GPU workstations) with students, researchers and verified local makers.

Before anyone can book, LabLend checks identity, user group, training certificates and booking limits, and explains how to fix anything missing. Competing requests are ranked by a published priority score, and the losing requests join a waiting list that moves up automatically. Users record the condition of each item at check-in and return, so earlier damage is never blamed on them. No-shows, late returns and damage are detected automatically, but only a person can apply a penalty, and every penalty can be disputed. Every important action is stored in a tamper-evident, hash-chained activity log.

The demo covers the complete lifecycle for students, lab managers, resource owners and administrators. All demo data is fictional.

---

## 1. Link to the functioning product

```
<your deployed URL, e.g. https://lablend.onrender.com>
```

How to get it (about 10 minutes, free):
1. Push the code to GitHub (see item 2).
2. Go to https://render.com, sign in with GitHub, and choose **New → Blueprint**.
3. Select the LabLend repository. Render reads `render.yaml` and creates the service automatically.
4. Wait for the first deploy to finish, then open the URL Render gives you.
5. Optional: under **Environment**, add `ANTHROPIC_API_KEY` to switch on the Claude-powered matching and incident summaries. Without it, rule-based versions are used and everything still works.

Note: Render's free plan sleeps after about 15 minutes of inactivity, so the first visit can take up to a minute to load. The demo data regenerates when the server wakes, which keeps the time-based examples fresh for each judge. Open the link once yourself just before judging starts.

## 2. Source-code repository

```
<your GitHub repository URL>
```

How to create it:
1. On https://github.com/new create a **public** repository named `lablend` (don't add a README or .gitignore; the project already has them).
2. In a terminal, from the project folder, run:

```bash
git init && git add . && git commit -m "LabLend: resource-sharing platform for the Unlock Underused Equipment hackathon"
```

```bash
git branch -M main && git remote add origin https://github.com/<your-username>/lablend.git && git push -u origin main
```

If you keep the repository private, add the judges' GitHub accounts as collaborators instead.

## 3. Project document

Link to `PROJECT_DOCUMENT.md` in your repository:

```
<your GitHub repository URL>/blob/main/PROJECT_DOCUMENT.md
```

It covers everything the brief lists:

| Required topic | Section |
|---|---|
| Selected use case | 1 |
| Target users and resource owners | 2 |
| Evidence or reasoning showing why the problem matters | 3 |
| Proposed solution | 4 |
| Complete product workflow (diagram + all 10 lifecycle steps) | 5 |
| Features developed during the hackathon | 6 |
| Technology stack and system architecture | 7 |
| AI tools, APIs, frameworks and external services | 8 |
| Privacy, security and fairness | 9 |
| Known limitations | 10 |
| Future development | 11 |
| Testing instructions and credentials | 12 |
| Team and participants | 13 |
| Disclosures | 14 |

Before submitting, add your own evidence to section 3 (for example a quick survey of classmates or a conversation with a lab technician) and fill in section 13. If the form wants a file, open the document on GitHub and use the browser's Print → Save as PDF.

## 4. Testing instructions and credentials

Copy this into the form:

> Open the live link and click **Explore resources** or **Sign in**, then choose a sample user. Every account uses the password **demo1234**. All data is fictional.
>
> Sample users:
> - Aisha Khan (student): aisha@northfield.edu
> - Sameer Patel (lab manager): sameer@northfield.edu
> - Dr. Meera Iyer (resource owner): meera@northfield.edu
> - Priya Nair (platform admin): priya@northfield.edu
> - Anand Kulkarni (media & library owner): anand@northfield.edu
> - Rohan Mehta (community maker): rohan@makers.community
> - Kavya Reddy (researcher): kavya@northfield.edu
> - Arjun Fernandes (student with one strike): arjun@northfield.edu
> - Ishaan Malhotra (new, unverified community member): ishaan@gmail.example
> - Farhan Qureshi (makerspace owner): farhan@makers.community
>
> Full lifecycle in about 8 minutes (also shown on the Home page after signing in):
> 1. As **Aisha**, open the 3D print that starts now and **check in**, marking one item as an issue.
> 2. **Record the return** and mark a different item as damaged; a damage report opens and the before/after comparison highlights it.
> 3. **Discover → Laser Cutter**, pick tomorrow afternoon, watch the live eligibility checks and priority score, and send the request.
> 4. Switch to **Sameer** (Demo button, bottom-right) → **Review queue**. Approve the top-ranked request; the others go to the waiting list with a written reason.
> 5. As Sameer, open **In use & returns** to inspect returns, and **Incidents** to settle the CNC damage report.
> 6. As **Anand**, open **Verifications** and verify Aisha's media training. Sameer's list flags Arjun's certificate as a duplicate of another user's.
> 7. Use the demo clock **+1 day**: reminders, no-shows (with proposed strikes) and overdue returns are detected automatically.
> 8. As **Priya**, verify Ishaan's identity in **People & roles**, then open **Activity log** to verify the tamper-evident chain. Dr. Meera can **List a resource** with her own conditions.
>
> The Demo button also lets you switch users, move the clock and regenerate fresh data. If the sample data looks out of date, click **Regenerate data**.
>
> To run locally: `npm install && npm start`, then open http://localhost:3000. Automated tests: `npm test`.

## 5. Team and participant details

```
Team name: <team name>
Members:
- <Full name>, <college / course / year>, <email>
- <Full name>, <college / course / year>, <email>
```

## 6. Role and contribution of each member

```
- <Name>: <role, e.g. product & research> — <what they did, e.g. defined the use case, researched how labs manage bookings, wrote the project document, tested the workflows>
- <Name>: <role, e.g. development> — <what they did, e.g. built and tested the booking rules, the review workflow and the interface, deployed the app>
```

Be specific and accurate. Judges may ask for development history as evidence.

## 7. Disclosure of templates, libraries, existing components, pre-existing code and AI use

Copy this into the form (adjust the AI sentence so it accurately describes how your team worked):

> - **Templates / pre-existing code:** none. The project was built from scratch during the hackathon window.
> - **Libraries:** Express (MIT licence) for the web server; `@anthropic-ai/sdk` (MIT, optional) to call the Claude API. Everything else uses Node.js and browser built-ins.
> - **Assets:** all illustrations and icons are original SVG made for this project. Fonts (Geist, Geist Mono, Instrument Serif) are loaded from Google Fonts under the SIL Open Font License. No stock images.
> - **AI-assisted development:** the code, demo data, tests and documentation were produced with substantial assistance from Claude Code (Anthropic's AI coding assistant), directed, reviewed and tested by the team.
> - **AI inside the product:** optional. With an API key, Claude suggests matching resources, summarises incident reports and adds notes to training-certificate checks. It never makes access, safety or penalty decisions; a person always decides, and rule-based fallbacks are used when AI is not configured.
> - **Data:** all people, organisations and records in the demo are fictional.

---

## Final checklist before you press Submit

- [ ] App deployed, link opens and you can sign in as Aisha
- [ ] Repository is public (or judges added) and the link works in a private browser window
- [ ] `PROJECT_DOCUMENT.md` section 3 has your own evidence; section 13 has your team
- [ ] Team details and member roles filled in (items 5 and 6)
- [ ] AI-use disclosure accurately describes how you worked
- [ ] All links tested from a signed-out browser
- [ ] Submitted before the deadline, and nothing changed afterwards

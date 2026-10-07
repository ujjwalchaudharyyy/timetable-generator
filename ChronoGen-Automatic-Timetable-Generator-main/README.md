#  ChronoGen — Automatic Timetable Generator.

**Team Tech4ALL &nbsp;·&nbsp; Watch The Code 2026 &nbsp;·&nbsp; Graphic Era Hill University**

ChronoGen automatically generates conflict-free school timetables using a **Genetic Algorithm written from scratch in JavaScript** — no external GA library used. It enforces 7 hard constraints and 8 soft constraints, streams live evolution progress to the browser, and exports the final timetable as CSV, JSON, or a self-contained HTML file.

---
## 🎥 DEMO
 [Watch Demo](./assets/chronogen-demo.mp4)

## 🧠 System Design & Planning

We used Miro to design the architecture, genetic algorithm flow, and system workflow before implementation.

🔗 Miro Board (Planning & Architecture):
https://miro.com/app/board/uXjVGg-IDJ8=/

## 🚀 Quick Start.

### Prerequisites:
- [Node.js](https://nodejs.org/) v18 or higher
- [MySQL](https://dev.mysql.com/downloads/) 8.0 or higher

### 1 — Clone and install dependencies:
```bash
git clone https://github.com/your-username/chronogen.git
cd chronogen
npm install
```

### 2 — Create the database.

**Windows (PowerShell):**
```powershell
Get-Content database/schema.sql | mysql -u root -p
```

**macOS / Linux:**
```bash
mysql -u root -p < database/schema.sql
```

> If your MySQL root account has a password, open `backend/db.js` and set the `DB_PASS` field, or set the environment variable:
> ```powershell
> $env:DB_PASS="your_password"; npm start
> ```

### 3 — Start the server:
```bash
npm start         # production
npm run dev       # development (auto-restarts on file changes via nodemon)
```

Open **http://localhost:3000** in your browser. ✅

---

## 🧭 How to Use:

| Step | Page | What to do |
|------|------|------------|
| 1 | **Input Data** `/input` | Click **Load Demo Data** to instantly load 3 classes, 6 teachers, 6 subjects, and 6 rooms. Or enter your own data manually / via CSV upload. |
| 2 | **Generate** `/generate` | Adjust GA parameters (or leave defaults), then click **Start Evolution**. Watch the fitness chart update live as the algorithm runs. |
| 3 | **Timetable** `/output` | View the generated timetable in Class, Teacher, or Room view. Export as CSV, JSON, or HTML. |

---

## 🗂️ Project Structure.

```
🗂 Project Structure
chronogen/
├── Backend/
│   ├── server.js            # Express entry point
│   ├── db.js                # MySQL pool + startup migrations
│   ├── routes/
│   │   ├── upload.js        # Data input: manual, CSV, demo
│   │   ├── generate.js      # GA run, SSE stream, attendance
│   │   └── export.js        # CSV / JSON / HTML export
│   └── ga/
│       ├── genetic.js       # Evolution engine (evolve function)
│       ├── fitness.js       # Fitness = 10000 − penalties
│       ├── constraints.js   # Hard (H1–H6+HU) & soft (S1–S9) checks
│       └── operators.js     # Selection, crossover, mutation
├── Frontend/
│   ├── src/
│   │   └── input.css        # Tailwind source (edit this)
│   ├── output.css          # Compiled Tailwind (auto-generated)
│   ├── index.css
│   ├── index.html           # Landing page
│   ├── index.js
│   ├── input.html           # Data input page
│   ├── input.js
│   ├── generate.html        # GA run + live chart page
│   ├── generate.js
│   ├── output.html          # Timetable viewer page
│   └── output.js
├── Database/
│   └── schema.sql           # Full schema (safe to re-run)
├── uploads/                 # Temp CSV files (git-ignored)
├── .env.example
├── .gitignore
├──  LICENSE
├──  package-lock.json
├──  package.json
├──  README.md
└──  tailwind.config.js

```

---

## 📂 System Architecture:
<img width="1356" height="770" alt="image" src="https://github.com/user-attachments/assets/fe488b85-3789-4cb1-8714-9978c0b31a65" />



## 🛠️ Tech Stack.

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js + Express.js |
| **Database** | MySQL 8.0 (via `mysql2` promise pool) |
| **Algorithm** | Genetic Algorithm — written from scratch, zero external GA libraries |
| **Frontend** | HTML5 + Tailwind CSS (CDN) + Vanilla JavaScript |
| **Charts** | Chart.js — live fitness graph during evolution |
| **Icons** | Remix Icons |

---

## 🧬 Algorithm Overview.

ChronoGen evolves a **population of timetables** over many generations. Each timetable is a chromosome — a flat list of gene objects, one per scheduled lecture. See [`ENCODING.md`](./ENCODING.md) for the full technical specification.

### Evolution Loop (each generation).
1. **Evaluate** — Score every chromosome using the fitness function (10,000 − penalties)
2. **Elitism** — Keep the top N chromosomes unchanged
3. **Selection** — Tournament selection to pick parents
4. **Crossover** — Day-block crossover to produce children
5. **Mutation** — Randomly apply one of 4 mutation operators per gene
6. **Repeat** — Until max generations or target fitness (9,800) is reached

### Stagnation Handling.
If fitness doesn't improve for 50 consecutive generations, the mutation rate is temporarily boosted from `0.02` → `0.08` to escape local optima. It resets automatically when a new best is found.

---

## ✅ Constraints.

### Hard Constraints — violations make the timetable invalid.

| Code | Description | Penalty |
|------|-------------|---------|
| **H1** | Teacher teaching two classes at the same time | 1,000 |
| **H2** | Class scheduled in two rooms at the same time | 1,000 |
| **H3** | Room occupied by two classes at the same time | 1,000 |
| **H4** | Class has two different subjects in the same period | 1,000 |
| **H5** | Teacher assigned a subject they are not qualified to teach | 1,000 |
| **H6** | Room capacity smaller than the class size | 500 |
| **HU** | Teacher scheduled during their marked unavailable period | 800 |

### Soft Constraints — violations reduce quality, not validity.

| Code | Description | Penalty |
|------|-------------|---------|
| **S1** | Subject has fewer lectures than its `min_per_week` requirement | 10 each |
| **S2** | Teacher exceeds their `max_lectures_per_week` | 5 each |
| **S3** | Teacher has more consecutive back-to-back lectures than allowed | 3 each |
| **S4** | A class has the same subject more than once in a single day | 2 each |
| **S5** | A class has a free-period gap between two occupied periods | 1 each |
| **S6** | A teacher has a free-period gap in their daily schedule | 1 each |
| **S7** | A subject is not scheduled in its required room type (lab, gym, etc.) | 8 each |
| **S8** | A morning-preference teacher gets an afternoon slot | 2 each |

---

## 🗄️ Database Schema.

The MySQL database has 9 tables:

| Table | Purpose |
|-------|---------|
| `institution` | Global settings (days/week, periods/day, lunch break) |
| `teachers` | Teacher records with preferences and limits |
| `subjects` | Subjects and their room type requirements |
| `rooms` | Rooms with capacity and type |
| `classes` | Class/section records |
| `teacher_subjects` | Many-to-many: which teacher can teach which subject |
| `teacher_unavailable` | Specific (day, period) slots a teacher cannot be scheduled |
| `curriculum` | Which class needs which subject, taught by whom, how many times/week |
| `timetable_genes` | The generated timetable (one row per lecture slot) |
| `ga_runs` | Log of each GA run with fitness score and status |

---

## 📡 API Endpoints.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/upload/data` | Fetch all teachers, rooms, subjects, classes, curriculum |
| `POST` | `/api/upload/teacher` | Add a single teacher |
| `POST` | `/api/upload/room` | Add a single room |
| `POST` | `/api/upload/subject` | Add a single subject |
| `POST` | `/api/upload/class` | Add a single class |
| `POST` | `/api/upload/demo` | Load the built-in demo dataset |
| `DELETE` | `/api/upload/clear` | Clear all data |
| `POST` | `/api/generate` | Start a GA run — returns `{ sessionId }` |
| `GET` | `/api/generate/progress/:sid` | SSE stream of live generation-by-generation progress |
| `GET` | `/api/generate/timetable` | Fetch the saved timetable from DB |
| `GET` | `/api/export/csv` | Download timetable as CSV |
| `GET` | `/api/export/json` | Download timetable as JSON |
| `GET` | `/api/export/html` | Download timetable as self-contained HTML |
| `GET` | `/api/health` | Server health check |

---

## ⚙️ GA Configuration Parameters.

All parameters can be tuned from the Generate page UI:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `population_size` | 100 | Number of timetables evolved simultaneously |
| `max_generations` | 300 | Maximum number of evolution cycles |
| `crossover_rate` | 0.85 | Probability of crossover between two parents |
| `mutation_rate` | 0.02 | Probability of mutation per gene |
| `tournament_size` | 5 | Number of candidates compared in selection |
| `elitism_count` | 2 | Number of top chromosomes preserved each generation |
| `random_seed` | 42 | Seed for the deterministic PRNG (same seed = same result) |

---
## System Diagrams:

![WhatsApp Image 2026-03-29 at 18 58 11](https://github.com/user-attachments/assets/2622ccaa-724f-4afa-8ef1-1eeb2b7ed549)


![WhatsApp Image 2026-03-29 at 18 58 12](https://github.com/user-attachments/assets/5c0391ca-a2f3-4eec-801c-a17c9e54a635)


---
## 👥 Team.

**Team Tech4ALL** — Watch The Code 2026, Graphic Era Hill University

---

## 📄 License.

This project was built for the Watch The Code 2026 competition. All rights reserved by Team Tech4ALL.



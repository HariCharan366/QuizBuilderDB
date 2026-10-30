# QuizBuilder – Secure Online Examination System
## Comprehensive Technical Documentation, File-by-File Reference & Complete Deployment Guide

QuizBuilder is a production-grade, full-stack, responsive online examination platform engineered for secure academic and institutional testing. It features full-screen browser lockdown, anti-cheat violation tracking, server-side 40-question randomized sampling, certified backend score evaluation against MongoDB Atlas, and a centralized multi-device Admin Dashboard for real-time live monitoring.

---

## 📑 Table of Contents
1. [System Overview & Architecture](#-system-overview--architecture)
2. [File-by-File Purpose & Technical Reference](#-file-by-file-purpose--technical-reference)
   - [Root Project Files](#1-root-project-files)
   - [Frontend Architecture (`frontend/`)](#2-frontend-architecture-frontend)
   - [Backend Architecture (`backend/`)](#3-backend-architecture-backend)
3. [Security, Integrity & Anti-Cheat System](#-security-integrity--anti-cheat-system)
4. [Complete Local Setup Guide](#-complete-local-setup-guide)
5. [Automated Verification & Testing](#-automated-verification--testing)
6. [Complete Production Deployment Guide](#-complete-production-deployment-guide)
   - [Step 1: MongoDB Atlas Setup](#step-1-mongodb-atlas-database-configuration)
   - [Step 2: Render.com Backend Deployment](#step-2-rendercom-backend-web-service)
   - [Step 3: Vercel.com Frontend Deployment](#step-3-vercelcom-frontend-static-hosting)
7. [Comprehensive REST API Reference](#-comprehensive-rest-api-reference)

---

## 🏗️ System Overview & Architecture

QuizBuilder is designed around a decoupled, single-source-of-truth architecture. All exams, questions, active sessions, student credentials, and certified results are persisted exclusively in MongoDB Atlas. Client devices (desktop browsers, tablets, and smartphones) communicate via authenticated REST APIs over HTTPS.

```text
                               ┌──────────────────────────────────────────────┐
                               │             MongoDB Atlas Cluster            │
                               │  (Users, Exams, Questions, Sessions, Results)│
                               └──────────────────────┬───────────────────────┘
                                                      │ Mongoose Connection
                                                      ▼
                               ┌──────────────────────────────────────────────┐
                               │           Node.js & Express Backend          │
                               │  - Port 5000 (Local) / Render Web Service    │
                               │  - JWT Verification & Role-Based Middleware  │
                               │  - 40-Question Randomized Engine (No Leaks)  │
                               │  - Certified Evaluation & Anti-Cheat Logger  │
                               └──────────────┬────────────────┬──────────────┘
                                              │                │
                        REST APIs / JSON / JWT│                │REST APIs / JSON / JWT
                                              ▼                ▼
                ┌───────────────────────────────────┐    ┌───────────────────────────────────┐
                │          Student Portal           │    │          Admin Portal             │
                │  - Registration & Secure Login    │    │  - 9 Dynamic MongoDB Metrics      │
                │  - Fullscreen Anti-Cheat Lockdown │    │  - Live Multi-Device Exam Feed    │
                │  - Progressive Auto-Save          │    │  - Candidate Roster & Exam History│
                │  - Certified Results Review       │    │  - RFC 4180 CSV Question Import   │
                └───────────────────────────────────┘    └───────────────────────────────────┘
```

---

## 📂 File-by-File Purpose & Technical Reference

### 1. Root Project Files

#### `package.json`
* **Main Purpose**: Defines the application manifest, package dependencies, and command-line execution scripts.
* **Key Components**:
  - `scripts.start`: Launches production backend server (`node backend/server.js`).
  - `scripts.dev`: Launches development environment with auto-reload (`nodemon backend/server.js`).
  - `scripts.test`: Executes the 43-point automated non-destructive audit test suite (`node test_complete_final_audit.js`).
  - Core dependencies: `express`, `mongoose`, `jsonwebtoken`, `bcryptjs`, `cors`, `dotenv`, and `express-rate-limit`.

#### `server.js`
* **Main Purpose**: Root bridge script that exports the main backend Express server (`module.exports = require('./backend/server');`).
* **Interaction**: Allows hosting environments (such as Render or Heroku) that expect an entry point in the repository root to start the server seamlessly without path reconfigurations.

#### `.env.example`
* **Main Purpose**: Template for required environment variables. Contains safe placeholder values and detailed documentation for every configuration key.
* **Interaction**: Copied to `backend/.env` during setup. Excluded from Git tracking to prevent credential leaks.

#### `.gitignore`
* **Main Purpose**: Instructs Git to ignore sensitive and transient files.
* **Protected Items**: Ignores `node_modules/`, all `.env` files (`.env`, `backend/.env`), runtime logs, and test data, while explicitly whitelisting `.env.example` (`!.env.example`) so templates can be committed.

#### `.npmignore`
* **Main Purpose**: Prevents packaging of internal files, environment secrets, and test scripts if published or bundled.

#### `vercel.json`
* **Main Purpose**: Vercel deployment configuration file placed at root.
* **Key Settings**: Specifies `outputDirectory: "frontend"` and enables `cleanUrls: true` for clean browser navigation (e.g., `/admin` instead of `/admin.html`).

#### `test_complete_final_audit.js`
* **Main Purpose**: Automated 43-point end-to-end integration test runner that verifies all backend, database, authentication, multi-device, and anti-cheat requirements.
* **Key Safety Mechanisms**: Requires `MONGO_URI_TEST` pointing to an isolated database (`quizbuilder_test`). Automatically verifies that the production database (`quizbuilder`) is never touched, creates isolated temporary test exams/students, and executes clean teardowns upon completion.

---

### 2. Frontend Architecture (`frontend/`)

#### `frontend/index.html`
* **Main Purpose**: Public Student Portal entry point providing student registration, secure login, and password recovery interfaces.
* **Key Features**: Tabbed switcher between Login and Registration, modern responsive design, real-time input validation, and password recovery modal. Communicates with `frontend/js/auth.js`.

#### `frontend/admin.html`
* **Main Purpose**: Centralized, secure Administrator Management Dashboard.
* **Key Features**:
  - Displays 9 dynamic MongoDB statistics cards (total candidates, total attempts, submissions, active exams, pass rates, average score, etc.).
  - Real-time multi-device live examination activity monitoring table with expandable answer reviews.
  - Candidate roster management (search, view historical attempts, toggle block/unblock, delete).
  - Question bank CRUD management (add, edit in modal, delete, keyword search).
  - RFC 4180 CSV question import interface and non-destructive reset controls.
  - Exam duration configuration modal connected directly to MongoDB.

#### `frontend/exam.html`
* **Main Purpose**: Secure examination lockdown interface where students complete their tests.
* **Key Features**:
  - Full-screen enforcement modal with hardware keyboard interceptors (blocks ESC, Alt+Tab, F11, DevTools).
  - Synchronized countdown timer with visual urgency indicators.
  - 40-question interactive navigation grid showing answered, marked-for-review, and unanswered badges.
  - Real-time anti-cheat warning strip (auto-submits upon receiving 3 warnings).
  - Progressive answer save status indicators.

#### `frontend/result.html`
* **Main Purpose**: Certified examination results viewer.
* **Key Features**:
  - Displays certified final score, total questions, correct/wrong counts, total time taken, and security warnings recorded.
  - Expandable question-by-question review section detailing the candidate's chosen answer versus the correct answer.
  - Queries results directly from MongoDB using the student's JWT token, preventing cross-student snooping.

#### `frontend/css/style.css`
* **Main Purpose**: Master styling system providing unified visual identity across the entire platform.
* **Key Features**: CSS variables for corporate colors (Navy, Blue, Slate, Crimson), responsive grid layouts, card designs, accessible form controls, clean modals, badge indicators, and animated pulse effects for live activity.

#### `frontend/js/config.js`
* **Main Purpose**: Intelligent API routing configuration for hybrid local and cloud deployments.
* **Key Logic**: Detects whether the frontend is running locally (routes to `""` relative paths) or hosted separately on Vercel (routes automatically to the production Render backend `DEFAULT_REMOTE_BACKEND_URL`). Supports runtime overrides via `window.__API_BASE_URL__`.

#### `frontend/js/auth.js`
* **Main Purpose**: Client-side authentication logic for student registration, login, and password recovery.
* **Key Logic**: Sends credentials to `/api/auth/register` and `/api/auth/login`, manages JWT tokens in `sessionStorage`, handles form alerts, and redirects candidates to `exam.html`.

#### `frontend/js/admin.js`
* **Main Purpose**: Client-side logic powering the Administrator Dashboard.
* **Key Features**:
  - Manages administrator authentication state via signed JWT Bearer tokens.
  - Implements 10-second background polling (`startAutoRefresh`) fetching stats and multi-device activity.
  - Renders live activity with expandable question reviews.
  - Handles candidate search, account status toggles, and exam history modals.
  - Performs question creation, editing, deletion, and RFC 4180 CSV uploads.
  - Exports activity records to Excel (.xls) and CSV (.csv) formats.

#### `frontend/js/exam.js`
* **Main Purpose**: Master engine driving the secure examination session on client devices.
* **Key Features**:
  - Requests `/api/exams/start-session` to retrieve the randomized 40 questions (with answer keys shielded).
  - Handles question rendering, options selection, and mark-for-review state.
  - Progressively auto-saves selected options to MongoDB in real time via `/api/exams/save-progress`.
  - Enforces fullscreen mode; detects focus loss, tab switching, and window resizing; logs warnings via `/api/exams/record-warning`.
  - Dispatches certified exam submission to `/api/results` and redirects to `result.html?id=...`.

#### `frontend/js/questions.js`
* **Main Purpose**: Multi-domain programming default question bank containing 75 curated technical questions (Python, JavaScript, Data Structures, OOP, SQL, Web Security, Algorithms).
* **Usage**: Used by `backend/server.js` and `backend/controllers/examController.js` during initial database setup or non-destructive defaults restoration.

#### `frontend/vercel.json`
* **Main Purpose**: Directory-level Vercel configuration ensuring clean URL rewrites when the `frontend/` folder is deployed as the project root.

---

### 3. Backend Architecture (`backend/`)

#### `backend/server.js`
* **Main Purpose**: Main Express web application and HTTP server entry point.
* **Key Features**:
  - Connects to MongoDB Atlas via `connectDB()`.
  - Runs system initializers (`initSystem`): syncs admin credentials from environment variables and seeds initial questions/exams if empty.
  - Applies strict production CORS policies rejecting unauthorized origins and disallowing wildcard `*`.
  - Implements security middleware blocking public access to `.env`, `package.json`, and backend folders.
  - Configures rate limiters and mounts API routes (`/api/auth`, `/api/admin`, `/api/exams`, `/api/results`).
  - Serves static frontend files and exposes `/api/health`.

#### `backend/config/db.js`
* **Main Purpose**: Database connection manager using Mongoose.
* **Key Logic**: Detects `NODE_ENV === 'test'` or presence of `MONGO_URI_TEST` to connect safely to the test database (`quizbuilder_test`), otherwise connects to production (`quizbuilder`). Logs connected host and active database name.

#### `backend/middleware/authMiddleware.js`
* **Main Purpose**: Authentication and authorization middleware.
* **Key Components**:
  - `protect`: Extracts and verifies JWT Bearer tokens from request headers; attaches authenticated `req.user`.
  - `adminOnly`: Restricts route access strictly to users with `role: 'admin'`. Returns `403 Forbidden` for students.
  - `apiLimiter`: Rate-limiting middleware preventing denial-of-service and brute-force attacks on API endpoints.

#### `backend/models/User.js`
* **Main Purpose**: Mongoose schema for Student and Administrator user accounts.
* **Key Fields**: `fullName`, `username` (unique, lowercase), `email` (unique, lowercase), `password` (hashed via bcryptjs before saving), `role` (`'student'` or `'admin'`), `isBlocked`, `loginAttempts`, `createdAt`.

#### `backend/models/Exam.js`
* **Main Purpose**: Mongoose schema for examination definitions and parameters.
* **Key Fields**: `title`, `code`, `description`, `durationMinutes` (default: 15), `totalQuestions` (default: 40), `maxWarnings` (default: 3), `passingPercentage` (default: 50), `isActive`.

#### `backend/models/Question.js`
* **Main Purpose**: Mongoose schema for the centralized question bank.
* **Key Fields**: `exam` (reference to Exam), `question`, `optionA`, `optionB`, `optionC`, `optionD`, `correct` (hidden by default via `select: false`), `domain`, `isDefault`. Includes compound indexes for efficient lookups.

#### `backend/models/ExamSession.js`
* **Main Purpose**: Mongoose schema tracking active candidate examination sessions.
* **Key Fields**: `sessionId` (unique UUID), `student` (reference to User), `exam` (reference to Exam), `assignedQuestions` (array of 40 randomized Question ObjectIDs), `savedAnswers` (Map of questionId to selected option index), `markedForReview`, `warnings`, `startTime`, `expiresAt`, `status` (`'active'`, `'submitted'`, `'terminated'`).

#### `backend/models/Result.js`
* **Main Purpose**: Mongoose schema for certified examination results.
* **Key Fields**: `session` (unique reference ensuring idempotent submission), `student` (reference to User), `exam` (reference to Exam), `username`, `studentName`, `email`, `examName`, `score` (percentage), `rawScore`, `correct`, `wrong`, `unanswered`, `totalQuestions`, `warnings`, `timeTakenSeconds`, `submissionStatus` (`'Passed'` or `'Failed'`), `answers` (audit log of questions, chosen options, and correct answers), `submittedAt`.

#### `backend/routes/authRoutes.js`
* **Main Purpose**: Express route declarations for student authentication and password recovery.
* **Endpoints**: `POST /register`, `POST /login`, `POST /forgot-password`, `POST /reset-password`.

#### `backend/routes/adminRoutes.js`
* **Main Purpose**: Express route declarations for administrator management.
* **Protection**: All routes protected with `protect` and `adminOnly` middleware (except `POST /login`).
* **Endpoints**: `POST /login`, `GET /stats`, `GET /exam-activity`, `GET /activity`, `GET /students`, `GET /students/:id`, `PUT /students/:id/toggle-block`, `DELETE /students/:id`, `DELETE /results`.

#### `backend/routes/examRoutes.js`
* **Main Purpose**: Express route declarations for candidate exam access and administrator question management.
* **Endpoints**:
  - Candidate: `GET /` (available exams), `POST /start-session`, `POST /save-progress`, `POST /record-warning`.
  - Administrator: `POST /` (create exam), `PUT /:id`, `DELETE /:id`, `GET /admin/questions`, `POST /questions`, `PUT /questions/:id`, `DELETE /questions/:id`, `POST /reset-defaults`, `POST /import-csv`, `PUT /settings`.

#### `backend/routes/resultRoutes.js`
* **Main Purpose**: Express route declarations for exam submission and result retrieval.
* **Endpoints**:
  - `POST /`: Evaluates and records certified exam result (requires student JWT).
  - `GET /`: Admin-only retrieval of all results.
  - `GET /my-results`: Retrieves authenticated student's exam history.
  - `GET /:id`: Retrieves single result (isolated by student ownership or admin privileges).
  - `DELETE /`: Admin-only clear all results.

#### `backend/controllers/authController.js`
* **Main Purpose**: Controller logic for candidate authentication.
* **Key Functions**: Validates registration data, checks duplicate emails/usernames, hashes passwords with bcrypt, verifies login credentials, and issues signed JWT tokens containing user ID, username, and role.

#### `backend/controllers/adminController.js`
* **Main Purpose**: Controller logic for the Administrator Dashboard.
* **Key Functions**:
  - `getAdminStats`: Runs MongoDB aggregation pipelines to calculate dynamic statistics (Total Students, Attempts, Submissions, Active Exams, Average Score, Pass Rate, High/Low Scores, Question Bank Count).
  - `getExamActivity`: Aggregates active sessions from `ExamSession` and completed submissions from `Result` into a unified real-time monitoring feed.
  - `getStudentsList`: Returns registered student accounts with attempt counters.
  - `getStudentHistory`: Retrieves individual candidate profile and complete examination attempt history.
  - `toggleBlockStudent` & `deleteStudent`: Manages candidate account status.

#### `backend/controllers/examController.js`
* **Main Purpose**: Master controller for examination sessions, question sampling, and question CRUD.
* **Key Functions**:
  - `startExamSession`: Verifies question bank threshold (>= 40 questions), generates randomized 40-question subset using Fisher-Yates shuffle, saves question IDs to `ExamSession`, and returns session with answer keys shielded. If resuming an active session, restores the identical 40 questions and answer state.
  - `saveAnswerProgress`: Progressively writes candidate's answer selections to MongoDB.
  - `recordWarning`: Increments session warnings; auto-submits when warning limit is reached.
  - `importQuestionsCSV`: Custom RFC 4180 CSV parser supporting embedded commas and quotes; associates imported rows with the target examination ID.
  - `resetDefaultQuestions`: Restores 75 default questions for the targeted exam while preserving all custom administrator questions.
  - `updateExamSettings`: Updates exam duration in MongoDB.

#### `backend/controllers/resultController.js`
* **Main Purpose**: Certified result calculation and score evaluation.
* **Key Functions**:
  - `submitExam`: Compares submitted answer indices against correct answers loaded directly from MongoDB questions. Computes raw score, percentage, and pass/fail status. Enforces idempotent submission (retries return the existing result with `200 OK` rather than creating duplicates).
  - `getResultById`: Enforces strict privacy isolation: students can access only their own records, while administrators can review any candidate's results.

---

## 🔒 Security, Integrity & Anti-Cheat System

1. **Centralized Authority**: No critical database operations depend on browser LocalStorage. All data is fetched and updated directly via MongoDB Atlas REST APIs.
2. **Answer Key Shielding**: Question payloads delivered to candidate devices omit `correct` and `correctIndex` (`select: -correct -correctIndex`). Inspecting network traffic or browser memory reveals no answer keys.
3. **Certified Backend Scoring**: Scores submitted by the frontend are strictly ignored. The backend retrieves the session's 40 assigned questions from MongoDB, evaluates submitted options against database truth, and calculates certified results.
4. **Anti-Cheat Monitoring**:
   - Fullscreen lockdown on exam start.
   - Window blur, tab switching, and developer shortcuts (F12, Ctrl+Shift+I, Alt+Tab) trigger immediate warning counters.
   - At 3 warnings, the examination automatically locks and finalizes submission.
5. **Session Recovery**: If a candidate accidentally closes their browser or loses connectivity, re-authenticating and loading `exam.html` resumes their active session with the identical 40 questions, preserved timer, and previously saved answers.
6. **Strict CORS Policy**: Disallows wildcard `*` in production. Only explicitly configured frontend domains listed in `ALLOWED_ORIGINS` are granted access.

---

## 🚀 Complete Local Setup Guide

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher ([nodejs.org](https://nodejs.org/))
- **MongoDB Atlas Account**: Free Shared Cluster ([cloud.mongodb.com](https://cloud.mongodb.com/))
- **Git**: Installed for version control

### 2. Clone / Open Project
```bash
cd c:\Users\chara\Downloads\QuizBuilder
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Configure Environment Variables
Create a file named `.env` inside the `backend/` directory based on `.env.example`:
```env
# Server Runtime
PORT=5000
NODE_ENV=development

# MongoDB Atlas Database URI
MONGO_URI=mongodb+srv://<USERNAME>:<PASSWORD>@cluster0.mongodb.net/quizbuilder?retryWrites=true&w=majority

# Isolated Test Database URI (For npm test)
MONGO_URI_TEST=mongodb+srv://<USERNAME>:<PASSWORD>@cluster0.mongodb.net/quizbuilder_test?retryWrites=true&w=majority

# JWT Authentication
JWT_SECRET=quizbuilder_development_jwt_secret_token_key_32_characters_min!
JWT_EXPIRES_IN=24h

# Administrator Credentials
ADMIN_ID=admin
ADMIN_PASSWORD=Admin@SecureExam#2026!

# Allowed Origins (Development)
ALLOWED_ORIGINS=http://localhost:5000,http://127.0.0.1:5000
```

### 5. Start the Application
```bash
npm start
```

### 6. Access Portals
- **Student Portal**: [http://localhost:5000/index.html](http://localhost:5000/index.html)
- **Admin Dashboard**: [http://localhost:5000/admin.html](http://localhost:5000/admin.html)
- **API Health Check**: [http://localhost:5000/api/health](http://localhost:5000/api/health)

---

## 🧪 Automated Verification & Testing

QuizBuilder includes an automated 43-point non-destructive test suite that verifies database connections, multi-device flows, anti-cheat mechanisms, and score evaluation.

### Running Tests
```bash
npm test
```

### Test Suite Safety Features
- **Database Safety Guard**: Automatically verifies that the database name in `MONGO_URI_TEST` contains `test` (e.g. `quizbuilder_test`). If pointed at the production database, the suite immediately aborts execution.
- **Isolated Entities**: Uses dedicated temporary test examinations, test questions, and test student accounts.
- **Automated Teardown**: Cleans up all created test entities upon completion, leaving zero leftover artifacts.

---

## 🌐 Complete Production Deployment Guide

### Step 1: MongoDB Atlas Database Configuration
1. Sign in to your [MongoDB Atlas Console](https://cloud.mongodb.com/).
2. Under **Security > Network Access**:
   - Click **Add IP Address**.
   - Select **Allow Access From Anywhere** (`0.0.0.0/0`) so dynamic cloud IPs from Render can connect.
   - Click **Confirm**.
3. Under **Security > Database Access**:
   - Create a database user (e.g., `quizadmin`) with **Read and write to any database** privileges.
4. Under **Database > Clusters**:
   - Click **Connect > Drivers > Node.js**.
   - Copy the connection string and replace `<password>` with your database user password:
     ```text
     mongodb+srv://quizadmin:<password>@cluster0.mongodb.net/quizbuilder?retryWrites=true&w=majority
     ```

---

### Step 2: Render.com (Backend Web Service)
1. Sign in to [Render.com](https://render.com/) and navigate to the **Dashboard**.
2. Click **New + > Web Service**.
3. Connect your GitHub repository.
4. Configure service build settings:
   - **Name**: `quizbuilder-backend`
   - **Region**: Select region closest to your users
   - **Branch**: `main`
   - **Root Directory**: Leave blank (root of repository)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node backend/server.js`
5. In the **Environment Variables** section, add:
   | Key | Value |
   | :--- | :--- |
   | `NODE_ENV` | `production` |
   | `PORT` | `5000` |
   | `MONGO_URI` | `mongodb+srv://quizadmin:<password>@cluster0.mongodb.net/quizbuilder?retryWrites=true&w=majority` |
   | `JWT_SECRET` | *(64-character random cryptographic secret)* |
   | `JWT_EXPIRES_IN` | `24h` |
   | `ADMIN_ID` | `admin` |
   | `ADMIN_PASSWORD` | *(Your secure production administrator password)* |
   | `ALLOWED_ORIGINS` | `https://quizbuilder-frontend.vercel.app` *(Your Vercel URL)* |
6. Click **Create Web Service**. Once deployed, copy your assigned Render URL (e.g., `https://quizbuilder-backend.onrender.com`).

---

### Step 3: Vercel.com (Frontend Static Hosting)
1. Sign in to [Vercel.com](https://vercel.com/) and click **Add New... > Project**.
2. Import your GitHub repository.
3. Configure project settings:
   - **Framework Preset**: `Other`
   - **Root Directory**: Click Edit and select `frontend`.
   - **Build Command**: Leave empty (Static HTML/CSS/JS).
   - **Output Directory**: Leave empty.
4. In `frontend/js/config.js`, confirm that `DEFAULT_REMOTE_BACKEND_URL` matches your deployed Render URL:
   ```javascript
   const DEFAULT_REMOTE_BACKEND_URL = "https://quizbuilder-backend.onrender.com";
   ```
5. Click **Deploy**.
6. Once deployed, copy your assigned Vercel URL (e.g., `https://quizbuilder-frontend.vercel.app`) and paste it into Render's `ALLOWED_ORIGINS` environment variable to finalize the secure CORS handshake.

---

## 📡 Comprehensive REST API Reference

| Endpoint | Method | Access | Purpose & Description |
| :--- | :---: | :---: | :--- |
| `/api/health` | GET | Public | Health status check, verifying active MongoDB Atlas connection. |
| `/api/auth/register` | POST | Public | Registers a new student account; validates unique email/username and hashes password. |
| `/api/auth/login` | POST | Public | Authenticates student credentials and returns a signed JWT token. |
| `/api/auth/forgot-password` | POST | Public | Initiates a password reset request. |
| `/api/auth/reset-password` | POST | Public | Completes password reset using verification code. |
| `/api/admin/login` | POST | Public | Authenticates administrator credentials and returns an admin JWT token. |
| `/api/admin/stats` | GET | Protected (Admin) | Returns 9 dynamic MongoDB statistics calculated via aggregation pipelines. |
| `/api/admin/exam-activity` | GET | Protected (Admin) | Returns unified multi-device examination activity (active sessions & completed results). |
| `/api/admin/students` | GET | Protected (Admin) | Returns registered candidate roster with individual completed attempt counts. |
| `/api/admin/students/:id` | GET | Protected (Admin) | Returns specific student details and full historical examination attempts. |
| `/api/admin/students/:id/toggle-block` | PUT | Protected (Admin) | Toggles active or blocked account status for a candidate. |
| `/api/admin/students/:id` | DELETE | Protected (Admin) | Permanently deletes a candidate account and related session data. |
| `/api/admin/questions` | GET | Protected (Admin) | Retrieves question bank with answer keys and domain filters. |
| `/api/admin/questions` | POST | Protected (Admin) | Creates a new question with 4 options and designated correct answer. |
| `/api/admin/questions/:id` | PUT | Protected (Admin) | Updates question text, options, or correct answer by MongoDB ID. |
| `/api/admin/questions/:id` | DELETE | Protected (Admin) | Permanently deletes a question from the question bank. |
| `/api/admin/reset-defaults` | POST | Protected (Admin) | Restores 75 default questions for targeted exam; preserves all custom questions. |
| `/api/admin/results` | DELETE | Protected (Admin) | Clears all exam results and resets candidate attempt counters. |
| `/api/exams` | GET | Public | Returns available examination definitions and duration parameters. |
| `/api/exams/start-session` | POST | Protected (Student) | Starts or resumes a 40-question randomized session with answer keys shielded. |
| `/api/exams/save-progress` | POST | Protected (Student) | Progressively saves candidate option selections (0..3) to MongoDB in real time. |
| `/api/exams/record-warning` | POST | Protected (Student) | Logs an anti-cheat violation to MongoDB; auto-submits upon 3 warnings. |
| `/api/exams/import-csv` | POST | Protected (Admin) | RFC 4180 CSV parser importing bulk questions linked to selected examination. |
| `/api/exams/settings` | PUT | Protected (Admin) | Updates examination duration settings directly in MongoDB Atlas. |
| `/api/results` | POST | Protected (Student) | Backend certified evaluation of submitted answers against MongoDB question bank. |
| `/api/results` | GET | Protected (Admin) | Retrieves all examination results with search, sort, and status filtering. |
| `/api/results/my-results` | GET | Protected (Student) | Retrieves authenticated student's personal examination attempt history. |
| `/api/results/:id` | GET | Protected (Student/Admin) | Retrieves single exam result. Isolated so candidates can only view their own results. |

---

## 📄 License & Attribution
Designed and built for secure, tamper-resistant, multi-device online examinations.  
**QuizBuilder – Secure Online Examination System**. All rights reserved.

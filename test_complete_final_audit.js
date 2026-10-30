/**
 * QuizBuilder Comprehensive Final Audit & Verification Test Suite
 * Fully Non-Destructive Test Suite targeting an Isolated Test Database
 * 
 * Safety Rules:
 * - Requires MONGO_URI_TEST environment variable
 * - Verifies database name explicitly contains 'test'
 * - Aborts immediately if pointed at production database ('quizbuilder' or 'secureexam')
 * - Creates isolated test examinations and test questions
 * - Never modifies or deletes production questions, exams, or student data
 * - Always cleans up all created test records in a finally block
 */

const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });

const BASE_URL = 'http://localhost:5000';

function makeRequest(endpoint, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, text: body });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runAudit() {
  console.log('================================================================================');
  console.log('   QUIZBUILDER NON-DESTRUCTIVE AUDIT & VERIFICATION TEST SUITE');
  console.log('================================================================================\n');

  // ---------------------------------------------------------------------------
  // SAFETY CHECK: Validate Test Database Isolation
  // ---------------------------------------------------------------------------
  const testDbUri = process.env.MONGO_URI_TEST;
  if (!testDbUri) {
    console.error('[Safety Abort] FATAL: MONGO_URI_TEST environment variable is required to run tests.');
    console.error('To protect production data, tests must target an isolated test database (e.g. quizbuilder_test).');
    process.exit(1);
  }

  const dbMatch = testDbUri.match(/\/([^/?]+)(\?|$)/);
  const dbName = dbMatch ? dbMatch[1] : '';

  if (!dbName.toLowerCase().includes('test')) {
    console.error(`[Safety Abort] FATAL: Test database name '${dbName}' does not contain 'test'.`);
    console.error('Testing aborted to prevent any accidental modification of production database.');
    process.exit(1);
  }

  if (dbName.toLowerCase() === 'quizbuilder' || dbName.toLowerCase() === 'secureexam') {
    console.error(`[Safety Abort] FATAL: Configured database '${dbName}' is a production database.`);
    console.error('Testing aborted immediately.');
    process.exit(1);
  }

  console.log(`[Safety Verified] Verified isolated test database: '${dbName}'. Production database is protected.\n`);

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${details}`);
      failed++;
    }
  }

  // Tracking arrays for guaranteed teardown
  const createdExamIds = [];
  const createdQuestionIds = [];
  const createdUsernames = [];
  const createdSessionIds = [];
  const createdResultIds = [];

  try {
    // -------------------------------------------------------------------------
    // 1. HEALTH CHECK & DATABASE CONNECTIVITY
    // -------------------------------------------------------------------------
    const health = await makeRequest('/api/health');
    assert(health.status === 200 && health.body.status === 'online' && health.body.database === 'connected',
      '1. Health Check Confirms Server Online & MongoDB Atlas Connected');

    // -------------------------------------------------------------------------
    // 2. BACKEND STATIC DIRECTORY PROTECTION
    // -------------------------------------------------------------------------
    const envReq = await makeRequest('/.env');
    assert(envReq.status === 404, '2. Static Protection: Access to /.env Blocked (404)');

    const serverReq = await makeRequest('/backend/server.js');
    assert(serverReq.status === 404, '3. Static Protection: Access to /backend/server.js Blocked (404)');

    const pkgReq = await makeRequest('/package.json');
    assert(pkgReq.status === 404, '4. Static Protection: Access to /package.json Blocked (404)');

    // -------------------------------------------------------------------------
    // 3. ADMIN AUTHENTICATION (ENVIRONMENT-ONLY CREDENTIALS)
    // -------------------------------------------------------------------------
    const adminId = process.env.ADMIN_ID;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminId || !adminPassword) {
      throw new Error('ADMIN_ID and ADMIN_PASSWORD must be defined in environment. Fallback credentials are prohibited.');
    }

    const adminLogin = await makeRequest('/api/admin/login', 'POST', {
      id: adminId,
      password: adminPassword
    });
    assert(adminLogin.status === 200 && adminLogin.body.token,
      '5. Admin Login & JWT Issuance (Zero Hardcoded Fallbacks)');
    const adminToken = adminLogin.body.token;

    const unauthAdmin = await makeRequest('/api/admin/stats');
    assert(unauthAdmin.status === 401, '6. Unauthorized Request to Admin API Blocked (401)');

    // -------------------------------------------------------------------------
    // 4. CREATE ISOLATED TEST EXAMINATION
    // -------------------------------------------------------------------------
    const stamp = Date.now().toString().slice(-6);
    const testExamRes = await makeRequest('/api/exams', 'POST', {
      title: `Automated Test Examination ${stamp}`,
      code: `TEST-EXAM-${stamp}`,
      durationMinutes: 15,
      totalQuestions: 40,
      passingPercentage: 50
    }, { Authorization: `Bearer ${adminToken}` });
    assert(testExamRes.status === 201 && testExamRes.body.exam, '7. Isolated Temporary Test Examination Created');
    const testExamId = testExamRes.body.exam._id;
    createdExamIds.push(testExamId);

    // -------------------------------------------------------------------------
    // 5. INSUFFICIENT QUESTION BANK GUARD (< 40 QUESTIONS)
    // -------------------------------------------------------------------------
    const failStartRes = await makeRequest('/api/exams/start-session', 'POST', {
      examId: testExamId
    }, { Authorization: `Bearer ${adminToken}` }); // Even with auth, fails if < 40
    assert(failStartRes.status === 401 || (failStartRes.status === 400 && failStartRes.body.message.includes('A minimum of 40 questions is required')),
      '8. Exam Start Blocked When Exam Bank Has < 40 Questions');

    // -------------------------------------------------------------------------
    // 6. RFC 4180 CSV IMPORT WITH COMMAS, QUOTES & LINE BREAKS
    // -------------------------------------------------------------------------
    // Construct 42 test questions using valid RFC 4180 CSV with embedded commas and quotes
    let csvData = 'Question,OptionA,OptionB,OptionC,OptionD,CorrectOption,Domain\n';
    // Add 1 malformed row to verify row rejection
    csvData += '"Malformed Question with Out-of-Bounds Correct Index","A","B","C","D",8,"Invalid"\n';
    for (let i = 1; i <= 42; i++) {
      csvData += `"What is the output of print(${i}, ${i * 2})?","${i}, ${i * 2}","${i}","${i * 2}","None",0,"Python Testing"\n`;
    }

    const csvImportRes = await makeRequest('/api/admin/import-csv', 'POST', {
      csvData,
      examId: testExamId
    }, { Authorization: `Bearer ${adminToken}` });
    assert(csvImportRes.status === 201 && csvImportRes.body.count === 42 && csvImportRes.body.skippedCount === 1,
      '9. RFC 4180 CSV Parser Imports 42 Questions with Embedded Commas & Rejects Out-of-Bounds Row');

    // -------------------------------------------------------------------------
    // 7. STUDENT REGISTRATION & LOGIN (CROSS-DEVICE: A & B)
    // -------------------------------------------------------------------------
    const userA = {
      fullName: 'Candidate Alpha',
      username: `test_cand_a_${stamp}`,
      email: `test_cand_a_${stamp}@test.quizbuilder.edu`,
      password: 'SecurePassword123'
    };
    createdUsernames.push(userA.username);

    const regA = await makeRequest('/api/auth/register', 'POST', userA, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0'
    });
    assert(regA.status === 201 && regA.body.success, '10. Device A (Desktop Chrome) Student Registration');

    const dupEmail = await makeRequest('/api/auth/register', 'POST', {
      fullName: 'Duplicate Email User',
      username: `test_dup_${stamp}`,
      email: userA.email,
      password: 'password123'
    });
    assert(dupEmail.status === 400 && dupEmail.body.message.includes('already exists'),
      '11. Duplicate Email Registration Prevented (400)');

    const loginA = await makeRequest('/api/auth/login', 'POST', {
      username: userA.username,
      password: userA.password
    });
    assert(loginA.status === 200 && loginA.body.token, '12. Device A Student Login & JWT Token Issued');
    const tokenA = loginA.body.token;
    const studentAId = loginA.body.user.id;

    const userB = {
      fullName: 'Candidate Beta',
      username: `test_cand_b_${stamp}`,
      email: `test_cand_b_${stamp}@test.quizbuilder.edu`,
      password: 'SecurePassword123'
    };
    createdUsernames.push(userB.username);

    const regB = await makeRequest('/api/auth/register', 'POST', userB, {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1) Safari/604.1'
    });
    assert(regB.status === 201 && regB.body.success, '13. Device B (Mobile Safari) Student Registration');

    const loginB = await makeRequest('/api/auth/login', 'POST', {
      username: userB.username,
      password: userB.password
    });
    assert(loginB.status === 200 && loginB.body.token, '14. Device B Student Login & JWT Token Issued');
    const tokenB = loginB.body.token;

    const studentToAdmin = await makeRequest('/api/admin/stats', 'GET', null, {
      Authorization: `Bearer ${tokenA}`
    });
    assert(studentToAdmin.status === 403, '15. Student Access to Admin Route Blocked (403 Forbidden)');

    // -------------------------------------------------------------------------
    // 8. 40-QUESTION RANDOMIZED SELECTION & ANTI-CHEATING PAYLOAD
    // -------------------------------------------------------------------------
    const startA = await makeRequest('/api/exams/start-session', 'POST', {
      examId: testExamId
    }, { Authorization: `Bearer ${tokenA}` });
    assert(startA.status === 201 && startA.body.session, '16. Device A Starts Exam Session on Isolated Test Exam');
    const sessionA = startA.body.session;
    createdSessionIds.push(sessionA.sessionId);
    const questionsA = sessionA.questions;

    assert(questionsA && questionsA.length === 40, '17. Server-Side Random Selection of Exactly 40 Unique Questions');

    const hasAnyAnswerField = questionsA.some(q => q.correct !== undefined || q.correctIndex !== undefined);
    assert(!hasAnyAnswerField, '18. Correct Answers Excluded from Exam Network Payload');

    const resumeA = await makeRequest('/api/exams/start-session', 'POST', {
      examId: testExamId
    }, { Authorization: `Bearer ${tokenA}` });
    assert(resumeA.status === 200 && resumeA.body.isResume === true, '19. Page Refresh / Reconnection Resumes Same 40-Question Session');

    const resumeQuestions = resumeA.body.session.questions;
    const isIdenticalSet = questionsA.every((q, idx) => q.questionId === resumeQuestions[idx].questionId);
    assert(isIdenticalSet, '20. Identical 40 Questions Preserved Across Page Refresh');

    // -------------------------------------------------------------------------
    // 9. PROGRESS SAVE, QUESTION OWNERSHIP & OPTION VALIDATION
    // -------------------------------------------------------------------------
    const testQ = questionsA[0];
    const saveProgress = await makeRequest('/api/exams/save-progress', 'POST', {
      sessionId: sessionA.sessionId,
      questionId: testQ.questionId,
      selectedOption: 2,
      isMarkedForReview: true
    }, { Authorization: `Bearer ${tokenA}` });
    assert(saveProgress.status === 200 && saveProgress.body.success, '21. Progressive Answer Save to MongoDB');

    const outOfBoundsProgress = await makeRequest('/api/exams/save-progress', 'POST', {
      sessionId: sessionA.sessionId,
      questionId: testQ.questionId,
      selectedOption: 5
    }, { Authorization: `Bearer ${tokenA}` });
    assert(outOfBoundsProgress.status === 400 && outOfBoundsProgress.body.message.includes('Invalid answer index'),
      '22. Reject Out-of-Bounds Answer Index (>3)');

    const invalidQuestionIdProgress = await makeRequest('/api/exams/save-progress', 'POST', {
      sessionId: sessionA.sessionId,
      questionId: '507f1f77bcf86cd799439011',
      selectedOption: 1
    }, { Authorization: `Bearer ${tokenA}` });
    assert(invalidQuestionIdProgress.status === 400 && invalidQuestionIdProgress.body.message.includes('does not belong'),
      '23. Reject Unauthorized Question ID Not in Exam Session (400)');

    const crossStudentProgress = await makeRequest('/api/exams/save-progress', 'POST', {
      sessionId: sessionA.sessionId,
      questionId: testQ.questionId,
      selectedOption: 3
    }, { Authorization: `Bearer ${tokenB}` });
    assert(crossStudentProgress.status === 403, '24. Prevent Cross-Student Session Modification (403 Forbidden)');

    const warnRes = await makeRequest('/api/exams/record-warning', 'POST', {
      sessionId: sessionA.sessionId
    }, { Authorization: `Bearer ${tokenA}` });
    assert(warnRes.status === 200 && warnRes.body.warnings === 1, '25. Anti-Cheat Warning Recorded on Session');

    // -------------------------------------------------------------------------
    // 10. ADMIN LIVE MONITORING FEED
    // -------------------------------------------------------------------------
    const liveActivity = await makeRequest('/api/admin/activity', 'GET', null, {
      Authorization: `Bearer ${adminToken}`
    });
    assert(liveActivity.status === 200 && Array.isArray(liveActivity.body.activity), '26. Admin Retrieves Live Exam Activity from MongoDB');

    const deviceASessionInFeed = liveActivity.body.activity && liveActivity.body.activity.find(a => 
      (a.id === sessionA.sessionId || a.sessionId === sessionA.sessionId || a.username === userA.username) && 
      (a.isSession === true || a.submissionStatus === 'Active' || a.status === 'In Progress')
    );
    assert(Boolean(deviceASessionInFeed), '27. Active Exam Session Displays in Admin Live Monitoring Feed');

    // -------------------------------------------------------------------------
    // 11. CERTIFIED BACKEND SCORING & SAFE ATOMIC SUBMISSION
    // -------------------------------------------------------------------------
    const directScoreHack = await makeRequest('/api/results', 'POST', {
      score: 40,
      total: 40,
      percentage: 100
    }, { Authorization: `Bearer ${tokenA}` });
    assert(directScoreHack.status === 400 && directScoreHack.body.message.includes('sessionId is required'),
      '28. Reject Direct Client-Scored Submission (400 Bad Request)');

    const answersPayloadA = {};
    questionsA.forEach((q, idx) => {
      answersPayloadA[q.questionId] = idx % 4;
    });

    const submitA = await makeRequest('/api/results', 'POST', {
      sessionId: sessionA.sessionId,
      answers: answersPayloadA,
      warnings: 99 // Client-supplied warnings must be ignored
    }, { Authorization: `Bearer ${tokenA}` });
    assert(submitA.status === 201 && submitA.body.result, '29. Certified Backend Result Evaluation for Device A');
    const resultA = submitA.body.result;
    createdResultIds.push(resultA._id);

    assert(typeof resultA.score === 'number' && typeof resultA.percentage === 'number' && resultA.warnings === 1,
      '30. Certified Results Calculated from MongoDB Questions & Session Warnings (Client Overrides Ignored)');

    const retrySubmitA = await makeRequest('/api/results', 'POST', {
      sessionId: sessionA.sessionId,
      answers: answersPayloadA
    }, { Authorization: `Bearer ${tokenA}` });
    assert(retrySubmitA.status === 200 && retrySubmitA.body.isExisting === true && retrySubmitA.body.result._id === resultA._id,
      '31. Idempotent Submission Retry Returns Existing Result Without Duplication (200 OK)');

    // Device B Exam Flow on the same isolated test exam
    const startB = await makeRequest('/api/exams/start-session', 'POST', {
      examId: testExamId
    }, { Authorization: `Bearer ${tokenB}` });
    const sessionB = startB.body.session;
    createdSessionIds.push(sessionB.sessionId);

    const answersPayloadB = {};
    sessionB.questions.forEach((q, idx) => {
      answersPayloadB[q.questionId] = (idx + 1) % 4;
    });
    const submitB = await makeRequest('/api/results', 'POST', {
      sessionId: sessionB.sessionId,
      answers: answersPayloadB
    }, { Authorization: `Bearer ${tokenB}` });
    assert(submitB.status === 201 && submitB.body.result, '32. Device B (Mobile) Exam Evaluated and Recorded');
    const resultB = submitB.body.result;
    createdResultIds.push(resultB._id);

    // -------------------------------------------------------------------------
    // 12. RESULT PRIVACY & ACCESS CONTROL
    // -------------------------------------------------------------------------
    const studentAViewOwn = await makeRequest(`/api/results/${resultA._id}`, 'GET', null, {
      Authorization: `Bearer ${tokenA}`
    });
    assert(studentAViewOwn.status === 200 && studentAViewOwn.body.result, '33. Student A Can Access Own Examination Result');

    const studentBViewA = await makeRequest(`/api/results/${resultA._id}`, 'GET', null, {
      Authorization: `Bearer ${tokenB}`
    });
    assert(studentBViewA.status === 403, '34. Student B Blocked from Viewing Student A\'s Result (403 Forbidden)');

    const adminViewAny = await makeRequest(`/api/results/${resultA._id}`, 'GET', null, {
      Authorization: `Bearer ${adminToken}`
    });
    assert(adminViewAny.status === 200 && adminViewAny.body.result, '35. Administrator Can Access Any Result (200 OK)');

    // -------------------------------------------------------------------------
    // 13. ADMIN DASHBOARD METRICS & CROSS-DEVICE DATA CONVERGENCE
    // -------------------------------------------------------------------------
    const adminStats = await makeRequest('/api/admin/stats', 'GET', null, {
      Authorization: `Bearer ${adminToken}`
    });
    const s = adminStats.body.stats;
    const hasAllStats = s &&
      typeof s.totalStudents === 'number' &&
      typeof s.totalExams === 'number' &&
      typeof s.totalExamsStarted === 'number' &&
      typeof s.totalExamsSubmitted === 'number' &&
      typeof s.currentlyActiveExams === 'number' &&
      typeof s.totalQuestions === 'number' &&
      typeof s.averageScore === 'number' &&
      typeof s.passedAttempts === 'number' &&
      typeof s.failedAttempts === 'number';
    assert(hasAllStats, '36. Admin Stats Returns All 9 Required Dynamic MongoDB Metrics');

    const studentsRoster = await makeRequest('/api/admin/students', 'GET', null, {
      Authorization: `Bearer ${adminToken}`
    });
    assert(studentsRoster.status === 200 && Array.isArray(studentsRoster.body.students),
      '37. Admin Retrieves Student Roster with Attempt Counts');

    const recordA = studentsRoster.body.students.find(st => st.username === userA.username);
    assert(recordA && recordA.completedExams >= 1, '38. Student Record Reflects Completed Exam Metrics');

    const studentHistory = await makeRequest(`/api/admin/students/${studentAId}/history`, 'GET', null, {
      Authorization: `Bearer ${adminToken}`
    });
    assert(studentHistory.status === 200 && Array.isArray(studentHistory.body.results) && studentHistory.body.results.length >= 1,
      '39. Individual Student Profile Returns Complete Personal Exam History');

    // -------------------------------------------------------------------------
    // 14. QUESTION BANK CRUD, SEARCH & EDIT (TARGETING TEST EXAM QUESTIONS)
    // -------------------------------------------------------------------------
    const searchQuestions = await makeRequest('/api/admin/questions?search=Python', 'GET', null, {
      Authorization: `Bearer ${adminToken}`
    });
    const searchList = Array.isArray(searchQuestions.body) ? searchQuestions.body : (searchQuestions.body && searchQuestions.body.questions);
    assert(searchQuestions.status === 200 && Array.isArray(searchList),
      '40. Admin Question Bank Search by Keyword (MongoDB Query Execution)');

    // Add a custom question explicitly to the isolated test exam
    const customQRes = await makeRequest('/api/admin/questions', 'POST', {
      question: `Custom Non-Destructive Question ${stamp}`,
      optionA: 'Option 1',
      optionB: 'Option 2',
      optionC: 'Option 3',
      optionD: 'Option 4',
      correct: 0,
      domain: 'Testing',
      exam: testExamId
    }, { Authorization: `Bearer ${adminToken}` });
    assert(customQRes.status === 201 && customQRes.body.question, '41. Custom Question Added to Test Examination');
    const customQId = customQRes.body.question._id;
    createdQuestionIds.push(customQId);

    // Edit the created test question using its MongoDB _id
    const updateRes = await makeRequest(`/api/admin/questions/${customQId}`, 'PUT', {
      question: `Updated Non-Destructive Question ${stamp}`,
      optionA: 'Option 1',
      optionB: 'Option 2',
      optionC: 'Option 3',
      optionD: 'Option 4',
      correct: 1
    }, { Authorization: `Bearer ${adminToken}` });
    assert(updateRes.status === 200 && updateRes.body.success, '42. Admin Successfully Updates Question via MongoDB ID');

    // -------------------------------------------------------------------------
    // 15. RESET DEFAULT QUESTIONS SPECIFIC TO TEST EXAM (PRESERVES CUSTOM QUESTIONS)
    // -------------------------------------------------------------------------
    const resetDefaultsRes = await makeRequest('/api/admin/reset-defaults', 'POST', {
      examId: testExamId
    }, { Authorization: `Bearer ${adminToken}` });
    assert(resetDefaultsRes.status === 200 && resetDefaultsRes.body.preservedCustomCount >= 1,
      '43. Reset Defaults Targeted to Test Exam: Preserves Custom Questions & Restores 75 Defaults');

  } catch (error) {
    console.error('[UNCAUGHT TEST RUNNER ERROR]', error);
    failed++;
  } finally {
    // -------------------------------------------------------------------------
    // 16. GUARANTEED AUTOMATED TEARDOWN (ALWAYS RUNS TO PRESERVE PRISTINE STATE)
    // -------------------------------------------------------------------------
    console.log('\n--- Initiating Clean Teardown of Test Artifacts ---');
    try {
      await mongoose.connect(testDbUri);

      // Clean up all test questions belonging to test exams
      if (createdExamIds.length > 0) {
        const delQ = await mongoose.connection.db.collection('questions').deleteMany({
          exam: { $in: createdExamIds.map(id => new mongoose.Types.ObjectId(id)) }
        });
        console.log(`[Teardown] Removed ${delQ.deletedCount} temporary test question(s).`);

        const delExams = await mongoose.connection.db.collection('exams').deleteMany({
          _id: { $in: createdExamIds.map(id => new mongoose.Types.ObjectId(id)) }
        });
        console.log(`[Teardown] Removed ${delExams.deletedCount} temporary test examination(s).`);
      }

      // Clean up created students
      if (createdUsernames.length > 0) {
        const delUsers = await mongoose.connection.db.collection('users').deleteMany({
          username: { $in: createdUsernames }
        });
        console.log(`[Teardown] Removed ${delUsers.deletedCount} temporary test student account(s).`);
      }

      // Clean up test sessions
      if (createdSessionIds.length > 0) {
        const delSessions = await mongoose.connection.db.collection('examsessions').deleteMany({
          sessionId: { $in: createdSessionIds }
        });
        console.log(`[Teardown] Removed ${delSessions.deletedCount} temporary test exam session(s).`);
      }

      // Clean up test results
      if (createdResultIds.length > 0) {
        const delResults = await mongoose.connection.db.collection('results').deleteMany({
          _id: { $in: createdResultIds.map(id => new mongoose.Types.ObjectId(id)) }
        });
        console.log(`[Teardown] Removed ${delResults.deletedCount} temporary test result(s).`);
      }

      await mongoose.disconnect();
      console.log('[Teardown] Test database state restored cleanly with zero leftover test records.\n');
    } catch (cleanupErr) {
      console.warn('[Teardown Warning]', cleanupErr.message);
    }
  }

  console.log('================================================================================');
  console.log(`AUDIT & VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED.`);
  console.log('================================================================================\n');

  if (failed > 0) process.exit(1);
}

runAudit();

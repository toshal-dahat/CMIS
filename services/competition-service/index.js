// Lambda handler wrapper for Competition Service
const express = require('express');
const serverless = require('serverless-http');
const { v4: uuidv4 } = require('uuid');
const { requireAuth, requireAdmin, requireJudge } = require('./src/lib/jwt');
const competitionService = require('./src/services/competitionService');
const teamService = require('./src/services/teamService');
const submissionService = require('./src/services/submissionService');
const judgeAssignmentService = require('./src/services/judgeAssignmentService');
const scoreService = require('./src/services/scoreService');
const s3PresignService = require('./src/services/s3PresignService');
const summaryService = require('./src/services/summaryService');
const synthesisFeedbackService = require('./src/services/synthesisFeedbackService');
const SUMMARY_SIZE_LIMIT_BYTES = 15 * 1024 * 1024; // 15 MB size cap for summarization
const SUMMARY_RATE_LIMIT_SECONDS = 60; // simple rate limit based on last summary write

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Instantiate requireJudge middleware with the service
const judgeMiddleware = requireJudge(judgeAssignmentService);

// ── Health ─────────────────────────────────────────────
app.get('/api/competitions/health', (req, res) => {
  res.json({ status: 'healthy', service: 'competition-service', timestamp: new Date().toISOString() });
});

// ════════════════════════════════════════════════════════
// COMPETITION CRUD (Admin)
// ════════════════════════════════════════════════════════

// List all competitions
app.get('/api/competitions', requireAuth, async (req, res) => {
  try {
    const competitions = await competitionService.listCompetitions();
    res.json(competitions);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Get single competition
app.get('/api/competitions/:competitionId', requireAuth, async (req, res) => {
  try {
    const competition = await competitionService.getCompetition(req.params.competitionId);
    if (!competition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Competition not found' });
    res.json(competition);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Create competition (admin only)
app.post('/api/competitions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const competition = await competitionService.createCompetition(req.body);
    res.status(201).json(competition);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: status === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Update competition (admin only)
app.put('/api/competitions/:competitionId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const competition = await competitionService.updateCompetition(req.params.competitionId, req.body);
    res.json(competition);
  } catch (err) {
    const status = err.statusCode || 500;
    const errorCode = status === 400 ? 'BAD_REQUEST' : status === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR';
    res.status(status).json({ error: errorCode, message: err.message });
  }
});

// ════════════════════════════════════════════════════════
// FEEDBACK & SYNTHESIS (Bounty 19)
// ════════════════════════════════════════════════════════

// Admin: trigger Bedrock synthesis for a team's judge feedback
app.post('/api/competitions/:competitionId/teams/:teamId/synthesize', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { competitionId, teamId } = req.params;

    const competition = await competitionService.getCompetition(competitionId);
    if (!competition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Competition not found' });

    const team = await teamService.getTeam(competitionId, teamId);
    if (!team) return res.status(404).json({ error: 'NOT_FOUND', message: 'Team not found' });

    const result = await synthesisFeedbackService.synthesize(competitionId, teamId);
    res.status(201).json({
      narrative: result.synthesizedFeedback,
      synthesizedAt: result.synthesizedAt,
      judgeCount: result.judgeCount,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    const code = status === 422 ? 'UNPROCESSABLE' : status === 502 ? 'AI_ERROR' : 'INTERNAL_SERVER_ERROR';
    res.status(status).json({ error: code, message: err.message });
  }
});

app.get('/api/competitions/:competitionId/teams/:teamId/feedback', requireAuth, async (req, res) => {
  try {
    const { competitionId, teamId } = req.params;
    const competition = await competitionService.getCompetition(competitionId);
    if (!competition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Competition not found' });

    const allAssignments = await judgeAssignmentService.listAssignments(competitionId);
    const teamAssignments = allAssignments.filter(j =>
      j.teamIds && (j.teamIds.includes(teamId) || j.teamIds.includes(`${competitionId}_${teamId}`))
    );

    const releaseDate = competition.feedbackReleaseDate ? new Date(competition.feedbackReleaseDate) : null;
    const now = new Date();

    if (releaseDate && now < releaseDate) {
      return res.status(423).json({
        error: 'FEEDBACK_LOCKED',
        message: 'Feedback has not been released yet',
        released: false,
        releasedAt: competition.feedbackReleaseDate,
        totalJudges: teamAssignments.length,
      });
    }

    const scores = await scoreService.getScoresByTeam(competitionId, teamId);
    const isAdmin = req.user?.groups?.includes('Admin') || req.user?.groups?.includes('admin') || req.user?.isAdmin;

    const feedback = scores.map(s => ({
      ...(isAdmin ? { judgeUserId: s.judgeUserId } : {}),
      feedback: s.feedback || '',
      ratings: s.ratings || {},
      gradedAt: s.gradedAt,
    }));

    res.json({
      released: true,
      releasedAt: competition.feedbackReleaseDate || null,
      feedbackCount: feedback.length,
      totalJudges: teamAssignments.length,
      feedback,
    });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

app.get('/api/competitions/:competitionId/teams/:teamId/synthesized-feedback', requireAuth, async (req, res) => {
  try {
    const { competitionId, teamId } = req.params;
    const competition = await competitionService.getCompetition(competitionId);
    if (!competition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Competition not found' });

    if (competition.feedbackReleaseDate && new Date() < new Date(competition.feedbackReleaseDate)) {
      return res.status(403).json({
        error: 'FEEDBACK_NOT_RELEASED',
        message: 'Feedback has not been released yet.',
        releaseDate: competition.feedbackReleaseDate,
      });
    }

    let synthesis = await synthesisFeedbackService.getSynthesizedFeedback(competitionId, teamId);

    // Auto-generate if not yet synthesized — runs Bedrock on first access after release date
    if (!synthesis) {
      const result = await synthesisFeedbackService.synthesize(competitionId, teamId);
      synthesis = { synthesizedFeedback: result.synthesizedFeedback, synthesizedAt: result.synthesizedAt, synthesisModelId: synthesisFeedbackService.BEDROCK_MODEL_ID };
    }

    res.json({
      narrative: synthesis.synthesizedFeedback,
      synthesizedAt: synthesis.synthesizedAt,
      modelId: synthesis.synthesisModelId,
    });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// ════════════════════════════════════════════════════════
// TEAMS
// ════════════════════════════════════════════════════════

// List teams for a competition
app.get('/api/competitions/:competitionId/teams', requireAuth, async (req, res) => {
  try {
    const teams = await teamService.listTeams(req.params.competitionId);
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Create team (admin only)
app.post('/api/competitions/:competitionId/teams', requireAuth, requireAdmin, async (req, res) => {
  try {
    const team = await teamService.createTeam(req.params.competitionId, req.body);
    res.status(201).json(team);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: status === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// ════════════════════════════════════════════════════════
// JUDGE ASSIGNMENTS (Admin)
// ════════════════════════════════════════════════════════

// Assign judge to competition with specific teams (admin only)
app.post('/api/competitions/:competitionId/judges', requireAuth, requireAdmin, async (req, res) => {
  try {
    const assignment = await judgeAssignmentService.assignJudge(req.params.competitionId, req.body);
    res.status(201).json(assignment);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: status === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// List judge assignments for a competition (admin only)
app.get('/api/competitions/:competitionId/judges', requireAuth, requireAdmin, async (req, res) => {
  try {
    const assignments = await judgeAssignmentService.listAssignments(req.params.competitionId);
    res.json(assignments);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// ════════════════════════════════════════════════════════
// SUBMISSIONS
// ════════════════════════════════════════════════════════

// Allowed submission MIME types → file extension
const ALLOWED_FILE_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

// Request presigned upload URL for a submission (PDF, PPT, or PPTX)
app.post('/api/competitions/:competitionId/submissions/upload-url', requireAuth, async (req, res) => {
  try {
    const { teamId, fileName, fileType } = req.body;
    if (!teamId) return res.status(400).json({ error: 'BAD_REQUEST', message: 'teamId is required' });
    if (!fileName) return res.status(400).json({ error: 'BAD_REQUEST', message: 'fileName is required' });

    // Validate file type; default to PDF if not provided
    const resolvedType = fileType && ALLOWED_FILE_TYPES[fileType] ? fileType : 'application/pdf';
    const ext = ALLOWED_FILE_TYPES[resolvedType];

    if (fileType && !ALLOWED_FILE_TYPES[fileType]) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'Only PDF, PPT, and PPTX files are accepted',
      });
    }

    // Verify competition exists and deadline hasn't passed
    const competition = await competitionService.getCompetition(req.params.competitionId);
    if (!competition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Competition not found' });

    if (competition.submissionDeadline && new Date() > new Date(competition.submissionDeadline)) {
      return res.status(400).json({ error: 'DEADLINE_PASSED', message: 'Submission deadline has passed' });
    }

    const submissionId = uuidv4();
    const s3Key = `submissions/${req.params.competitionId}/${teamId}/${submissionId}.${ext}`;
    const uploadUrl = await s3PresignService.getPresignedPutUrl(s3Key, 120, resolvedType);

    res.json({ uploadUrl, s3Key, submissionId, expiresInSeconds: 120 });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Complete submission upload — confirms the file exists in S3
app.post('/api/competitions/:competitionId/submissions/complete', requireAuth, async (req, res) => {
  try {
    const { teamId, s3Key, fileName, fileType } = req.body;
    if (!teamId || !s3Key) return res.status(400).json({ error: 'BAD_REQUEST', message: 'teamId and s3Key are required' });

    // Ensure competition exists so we can pull rubric for auto-summary
    const competition = await competitionService.getCompetition(req.params.competitionId);
    if (!competition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Competition not found' });

    await s3PresignService.headObject(s3Key);

    // Preserve the uploaded file's MIME type. Accept from client, otherwise
    // infer from the s3Key extension (upload-url already validated the type).
    let resolvedFileType = fileType && ALLOWED_FILE_TYPES[fileType] ? fileType : null;
    if (!resolvedFileType) {
      const ext = (s3Key.split('.').pop() || '').toLowerCase();
      resolvedFileType = Object.keys(ALLOWED_FILE_TYPES).find(k => ALLOWED_FILE_TYPES[k] === ext) || 'application/pdf';
    }

    const submission = await submissionService.upsertSubmission(req.params.competitionId, teamId, {
      s3Key,
      fileName: fileName || `submission.${ALLOWED_FILE_TYPES[resolvedFileType]}`,
      fileType: resolvedFileType,
    });

    // Kick off AI summary generation immediately (fire-and-forget).
    // For PPT/PPTX the summarize flow will convert to PDF via LibreOffice before Textract.
    const rubric = competition.rubric || competitionService.DEFAULT_RUBRIC;
    const rubricLabels = (Array.isArray(rubric) ? rubric : []).map(r => r.label);
    summaryService.summarize({
      competitionId: req.params.competitionId,
      teamId,
      s3Key: submission.s3Key,
      fileType: submission.fileType,
      rubricLabels,
      headObject: s3PresignService.headObject,
      refresh: true,
    }).catch(err => {
      console.error('Auto summary generation failed', {
        competitionId: req.params.competitionId,
        teamId,
        fileType: submission.fileType,
        error: err.message,
      });
    });

    res.json(submission);
  } catch (err) {
    console.error('Submission complete failed:', {
      competitionId: req.params.competitionId,
      body: req.body,
      errorName: err.name,
      errorMessage: err.message,
      httpStatusCode: err.$metadata?.httpStatusCode,
    });

    // S3 HeadObject returns 404 with ListBucket permission, or 403 without it.
    // AWS SDK v3 sets err.message = "UnknownError" for HEAD responses (no body).
    const s3Status = err.$metadata?.httpStatusCode;
    if (err.name === 'NotFound' || s3Status === 404 || s3Status === 403) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'File not found in S3. Ensure the file was uploaded before confirming.' });
    }
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'Unknown error' });
  }
});

// Get submission download URL (presigned GET for inline PDF viewing)
app.get('/api/competitions/:competitionId/submissions/:teamId/download-url', requireAuth, async (req, res) => {
  try {
    const submission = await submissionService.getSubmission(req.params.competitionId, req.params.teamId);
    if (!submission) return res.status(404).json({ error: 'NOT_FOUND', message: 'No submission found for this team' });

    const downloadUrl = await s3PresignService.getPresignedGetUrl(submission.s3Key, 300);
    res.json({ downloadUrl, expiresInSeconds: 300, submission });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// ════════════════════════════════════════════════════════
// JUDGE-SPECIFIC ROUTES
// ════════════════════════════════════════════════════════

// Get all competitions where current user is assigned as a judge
app.get('/api/judge/assignments', requireAuth, async (req, res) => {
  try {
    const assignments = await judgeAssignmentService.getAssignmentsByJudge(req.user.userId);
    res.json(assignments);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Get teams assigned to this judge for a competition (enriched with submission + score status)
app.get('/api/judge/competitions/:competitionId/teams', requireAuth, judgeMiddleware, async (req, res) => {
  try {
    const assignedTeamIds = req.judgeAssignment.teamIds || [];
    const competitionId = req.params.competitionId;
    const competition = await competitionService.getCompetition(competitionId);
    if (!competition) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Competition not found' });
    }
    const rubric = competition.rubric || competitionService.DEFAULT_RUBRIC;
    const allTeams = await teamService.listTeams(competitionId);

    // Filter to only teams assigned to this judge
    const myTeams = allTeams.filter(t => assignedTeamIds.includes(t.teamId));

    // Enrich each team with submission and grading status
    const enriched = await Promise.all(myTeams.map(async (team) => {
      const submission = await submissionService.getSubmission(competitionId, team.teamId);
      const score = await scoreService.getScore(competitionId, team.teamId, req.user.userId);
      const scoreTotal = computeScoreTotal(score, rubric);

      return {
        ...team,
        hasSubmission: !!submission,
        submittedAt: submission?.submittedAt || null,
        hasSummary: !!submission?.summary,
        gradingStatus: score ? 'GRADED' : 'PENDING',
        score: score || null,
        scoreTotal,
      };
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Generate or fetch a cached summary for a team's submission
app.post('/api/judge/competitions/:competitionId/teams/:teamId/summary', requireAuth, judgeMiddleware, async (req, res) => {
  try {
    const { competitionId, teamId } = req.params;
    const assignedTeamIds = req.judgeAssignment.teamIds || [];

    if (!assignedTeamIds.includes(teamId)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'You are not assigned to grade this team' });
    }

    const competition = await competitionService.getCompetition(competitionId);
    if (!competition) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Competition not found' });
    }

    const submission = await submissionService.getSubmission(competitionId, teamId);
    if (!submission) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'No submission found for this team' });
    }

    // Rate limit based on last summary timestamp stored on the submission record
    const lastSummaryAt = submission.summaryAt ? new Date(submission.summaryAt).getTime() : null;
    const now = Date.now();
    if (lastSummaryAt && now - lastSummaryAt < SUMMARY_RATE_LIMIT_SECONDS * 1000) {
      const retryAfter = Math.ceil((SUMMARY_RATE_LIMIT_SECONDS * 1000 - (now - lastSummaryAt)) / 1000);
      return res.status(429).json({
        error: 'RATE_LIMITED',
        message: `Please wait ${retryAfter} seconds before requesting another summary`,
        retryAfterSeconds: retryAfter,
      });
    }

    // Enforce size cap before attempting Textract
    const head = await s3PresignService.headObject(submission.s3Key);
    const size = Number(head.contentLength || 0);
    if (size > SUMMARY_SIZE_LIMIT_BYTES) {
      return res.status(413).json({
        error: 'PAYLOAD_TOO_LARGE',
        message: `Submission is ${Math.round(size / (1024 * 1024))}MB which exceeds the ${SUMMARY_SIZE_LIMIT_BYTES / (1024 * 1024)}MB summarization limit`,
      });
    }

    const rubric = competition.rubric || competitionService.DEFAULT_RUBRIC;
    const rubricLabels = rubric.map(r => r.label);

    const summaryResult = await summaryService.summarize({
      competitionId,
      teamId,
      s3Key: submission.s3Key,
      fileType: submission.fileType,
      rubricLabels,
      headObject: s3PresignService.headObject
    });

    res.json({
      summary: summaryResult.summaryText,
      cached: summaryResult.cached,
      updatedAt: summaryResult.summaryAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Get this judge's score for a specific team
app.get('/api/judge/competitions/:competitionId/teams/:teamId/score', requireAuth, judgeMiddleware, async (req, res) => {
  try {
    const score = await scoreService.getScore(req.params.competitionId, req.params.teamId, req.user.userId);
    if (!score) return res.status(404).json({ error: 'NOT_FOUND', message: 'No score found' });
    res.json(score);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Submit or update a score for a team
app.post('/api/judge/competitions/:competitionId/teams/:teamId/score', requireAuth, judgeMiddleware, async (req, res) => {
  try {
    // Verify this judge is assigned to this specific team
    const assignedTeamIds = req.judgeAssignment.teamIds || [];
    if (!assignedTeamIds.includes(req.params.teamId)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'You are not assigned to grade this team' });
    }

    const competition = await competitionService.getCompetition(req.params.competitionId);
    if (!competition) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Competition not found' });
    }

    const rubric = competition.rubric && Array.isArray(competition.rubric) ? competition.rubric : competitionService.DEFAULT_RUBRIC;
    const rubricKeys = rubric.map(r => r.key);

    const { ratings, feedback } = req.body;
    if (!ratings || typeof ratings !== 'object') {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'ratings object is required' });
    }

    // Validate ratings against rubric
    for (const entry of rubric) {
      if (!(entry.key in ratings)) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: `Missing rating for criterion "${entry.key}"` });
      }
      const value = Number(ratings[entry.key]);
      if (!Number.isFinite(value)) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: `Rating for "${entry.key}" must be a number` });
      }
      if (value < entry.min || value > entry.max) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: `Rating for "${entry.key}" must be between ${entry.min} and ${entry.max}`,
        });
      }
    }

    // Block unknown criteria keys to avoid stale drafts
    for (const key of Object.keys(ratings)) {
      if (!rubricKeys.includes(key)) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: `Criterion "${key}" is no longer valid for this competition` });
      }
    }

    const score = await scoreService.upsertScore(
      req.params.competitionId,
      req.params.teamId,
      req.user.userId,
      { ratings, feedback }
    );

    res.status(201).json(score);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// ════════════════════════════════════════════════════════
// ADMIN SCORES OVERVIEW
// ════════════════════════════════════════════════════════

// Get all scores for a competition (admin only)
app.get('/api/competitions/:competitionId/scores', requireAuth, requireAdmin, async (req, res) => {
  try {
    const scores = await scoreService.getScoresByCompetition(req.params.competitionId);
    res.json(scores);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// ════════════════════════════════════════════════════════
// LAMBDA ENTRYPOINT
// ════════════════════════════════════════════════════════

const expressHandler = serverless(app, {
  request: (request, event, context) => {
    // Strip the API Gateway stage prefix from the URL
    const stage = event.requestContext?.stage;
    if (stage && request.url.startsWith(`/${stage}/`)) {
      request.url = request.url.replace(`/${stage}`, '');
    }
  }
});

exports.handler = async (event, context) => {
  return expressHandler(event, context);
};

// Export Express app for local testing
exports.app = app;

function computeScoreTotal(score, rubric) {
  if (!score || !score.ratings) return null;
  const ratings = score.ratings;
  if (!rubric || !Array.isArray(rubric)) {
    return Object.values(ratings).reduce((sum, v) => (Number.isFinite(Number(v)) ? sum + Number(v) : sum), 0);
  }

  let total = 0;
  for (const entry of rubric) {
    const value = Number(ratings[entry.key]);
    if (!Number.isFinite(value)) {
      return null; // missing or invalid rating; avoid partial totals
    }
    const weight = Number.isFinite(entry.weight) ? entry.weight : 1;
    total += value * weight;
  }

  return total;
}

const competitionService = require("./competitionService");
const teamService = require("./teamService");
const scoreService = require("./scoreService");
const roomService = require("./roomService");
const synthesisFeedbackService = require("./synthesisFeedbackService");

function isReleaseDue(feedbackReleaseDate, now) {
  if (!feedbackReleaseDate) return false;
  const releaseTime = new Date(feedbackReleaseDate);
  return !Number.isNaN(releaseTime.getTime()) && releaseTime <= now;
}

function hasWrittenFeedback(score) {
  return Boolean(score?.feedback && String(score.feedback).trim());
}

/**
 * A team is ready for synthesis if it lives in at least one room (i.e. has
 * judges assigned via rooms) AND at least one of those judges has submitted
 * a graded score with written feedback.
 */
function isTeamReadyForSynthesis(teamId, roomedTeamIds, scores) {
  if (!roomedTeamIds.has(teamId)) return false;

  return scores.some((score) =>
    score.teamId === teamId &&
    score.status === "GRADED" &&
    hasWrittenFeedback(score)
  );
}

async function processCompetitionRelease(competition) {
  const [teams, rooms, scores] = await Promise.all([
    teamService.listTeams(competition.competitionId),
    roomService.listRooms(competition.competitionId),
    scoreService.getScoresByCompetition(competition.competitionId),
  ]);

  const roomedTeamIds = new Set();
  for (const room of rooms) {
    for (const tid of room.teamIds || []) {
      roomedTeamIds.add(tid);
    }
  }

  const readyTeams = teams.filter((team) =>
    isTeamReadyForSynthesis(team.teamId, roomedTeamIds, scores)
  );

  const synthesisResults = await Promise.allSettled(
    readyTeams.map((team) =>
      synthesisFeedbackService.synthesize(competition.competitionId, team.teamId, false)
    )
  );

  const failedTeams = [];
  let synthesizedCount = 0;
  let cachedCount = 0;

  synthesisResults.forEach((result, index) => {
    const team = readyTeams[index];
    if (result.status === "fulfilled") {
      if (result.value.cached) cachedCount += 1;
      else synthesizedCount += 1;
      return;
    }

    failedTeams.push({
      teamId: team.teamId,
      teamName: team.teamName,
      message: result.reason?.message || "Automatic synthesis failed",
    });
  });

  const summary = {
    checkedAt: new Date().toISOString(),
    totalTeams: teams.length,
    readyTeams: readyTeams.length,
    pendingTeams: Math.max(teams.length - readyTeams.length, 0),
    synthesizedCount,
    cachedCount,
    failedTeams,
  };

  if (failedTeams.length > 0) {
    await competitionService.recordAutoSynthesisFailure(
      competition.competitionId,
      failedTeams.map((team) => `${team.teamName}: ${team.message}`).join(" | "),
      summary
    );
  } else {
    await competitionService.recordAutoSynthesisSuccess(
      competition.competitionId,
      competition.feedbackReleaseDate,
      summary
    );
  }

  return summary;
}

async function runScheduledReleaseCheck() {
  const now = new Date();
  const competitions = await competitionService.listCompetitions();
  const dueCompetitions = competitions.filter((competition) =>
    isReleaseDue(competition.feedbackReleaseDate, now) &&
    competition.autoSynthesisCompletedForReleaseDate !== competition.feedbackReleaseDate
  );

  const processed = [];
  for (const competition of dueCompetitions) {
    try {
      const summary = await processCompetitionRelease(competition);
      processed.push({
        competitionId: competition.competitionId,
        name: competition.name,
        releaseDate: competition.feedbackReleaseDate,
        status: summary.failedTeams.length > 0 ? "partial_failure" : "completed",
        ...summary,
      });
    } catch (err) {
      const summary = {
        checkedAt: new Date().toISOString(),
        totalTeams: 0,
        readyTeams: 0,
        pendingTeams: 0,
        synthesizedCount: 0,
        cachedCount: 0,
        failedTeams: [],
      };

      await competitionService.recordAutoSynthesisFailure(
        competition.competitionId,
        err.message || "Scheduled feedback release run failed",
        summary
      );

      processed.push({
        competitionId: competition.competitionId,
        name: competition.name,
        releaseDate: competition.feedbackReleaseDate,
        status: "failed",
        error: err.message,
        ...summary,
      });
    }
  }

  return {
    triggeredAt: now.toISOString(),
    competitionsChecked: competitions.length,
    competitionsDue: dueCompetitions.length,
    processed,
  };
}

module.exports = {
  isTeamReadyForSynthesis,
  runScheduledReleaseCheck,
};

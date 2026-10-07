// fitness.js — Calculates how good a timetable is
//
// Score = 10000 minus all penalty points
// A score of 10000 = perfect timetable with zero violations
// A score below ~9000 usually means hard constraint violations exist

const { evaluateConstraints } = require('./constraints');

const MAX_SCORE = 10000;

function calculateFitness(chromosome, institutionData) {
  // Empty chromosome = worst possible score
  if (!chromosome || chromosome.length === 0) {
    return { score: 0, violations: {}, isValid: false, totalPenalty: MAX_SCORE };
  }

  const { violations, totalPenalty } = evaluateConstraints(chromosome, institutionData);

  // Score can't go below 0
  const score = Math.max(0, MAX_SCORE - totalPenalty);

  // "Valid" means ALL hard constraints are satisfied (zero hard violations)
  const hardViolationTotal =
    violations.H1 + violations.H2 + violations.H3 +
    violations.H4 + violations.H5 + violations.H6 +
    (violations.HU || 0);

  const isValid = hardViolationTotal === 0;

  return { score, violations, isValid, totalPenalty };
}

module.exports = { calculateFitness, MAX_SCORE };

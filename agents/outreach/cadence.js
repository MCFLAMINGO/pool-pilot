'use strict';

/**
 * Hard cadence caps — tuned to stay under typical automation / spam tripwires.
 * Override with env: OUTREACH_X_PER_DAY, OUTREACH_TG_PER_DAY, OUTREACH_DM_PER_DAY
 */
module.exports = {
  x: {
    perDay: Number(process.env.OUTREACH_X_PER_DAY || 3),
    minGapMs: Number(process.env.OUTREACH_X_GAP_MS || 4 * 60 * 60 * 1000)
  },
  tgBroadcast: {
    perDay: Number(process.env.OUTREACH_TG_PER_DAY || 5),
    minGapMs: Number(process.env.OUTREACH_TG_GAP_MS || 90 * 60 * 1000)
  },
  tgDm: {
    perDay: Number(process.env.OUTREACH_DM_PER_DAY || 8),
    minGapMs: Number(process.env.OUTREACH_DM_GAP_MS || 20 * 60 * 1000)
  },
  /** Quiet hours UTC — no posts in this window */
  quietUtc: {
    startHour: Number(process.env.OUTREACH_QUIET_START || 3),
    endHour: Number(process.env.OUTREACH_QUIET_END || 11)
  }
};

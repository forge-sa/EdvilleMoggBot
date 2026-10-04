import { config } from './config.js';
import { daysBetween, todayIso } from './dates.js';

// Edvillianity, out of 3000:
//   GPA     1000  - linear in GPA / GPA_MAX
//   Tenure   600  - share of Edville's lifetime you've been there for
//                   (day-one students always max this out)
//   Class    400  - linear in class / 11
//   IELTS    500  - band / 9, nothing if not taken
//   SAT      500  - from 400 (nothing) to 1600 (full), nothing if not taken
const WEIGHTS = { gpa: 1000, tenure: 600, grade: 400, ielts: 500, sat: 500 };

const clamp = (x) => Math.min(1, Math.max(0, x));

export function edvillianity(user, today = todayIso()) {
  const lifetime = Math.max(1, daysBetween(config.schoolOpened, today));
  const total =
    WEIGHTS.gpa * clamp(user.gpa / config.gpaMax) +
    WEIGHTS.tenure * clamp(daysBetween(user.since, today) / lifetime) +
    WEIGHTS.grade * clamp(user.grade / 11) +
    WEIGHTS.ielts * (user.ielts ? clamp(user.ielts / 9) : 0) +
    WEIGHTS.sat * (user.sat ? clamp((user.sat - 400) / 1200) : 0);
  return Math.min(config.maxPoints, Math.round(total));
}

const TIERS = [
  [2850, 'Edville Final Boss 👑'],
  [2550, 'Gigachad of Edville'],
  [2100, 'Edville Mogger'],
  [1650, 'Certified Edvillian'],
  [1200, 'Edville Regular'],
  [750, 'Edville Rookie'],
  [0, 'Edville Tourist'],
];

export function tier(points) {
  return TIERS.find(([min]) => points >= min)[1];
}

export function bar(points, width = 10) {
  const filled = Math.round((points / config.maxPoints) * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

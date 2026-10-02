import { config } from './config.js';
import { daysBetween, todayIso } from './dates.js';

// Edvillianity, out of 1000:
//   GPA     500  - linear in GPA / GPA_MAX
//   Tenure  300  - share of Edville's lifetime you've been there for
//                  (day-one students always max this out)
//   Class   200  - linear in class / 11
const WEIGHTS = { gpa: 500, tenure: 300, grade: 200 };

const clamp = (x) => Math.min(1, Math.max(0, x));

export function edvillianity(user, today = todayIso()) {
  const lifetime = Math.max(1, daysBetween(config.schoolOpened, today));
  const tenure = clamp(daysBetween(user.since, today) / lifetime);
  const total =
    WEIGHTS.gpa * clamp(user.gpa / config.gpaMax) +
    WEIGHTS.tenure * tenure +
    WEIGHTS.grade * clamp(user.grade / 11);
  return Math.round(total);
}

const TIERS = [
  [950, 'Edville Final Boss 👑'],
  [850, 'Gigachad of Edville'],
  [700, 'Edville Mogger'],
  [550, 'Certified Edvillian'],
  [400, 'Edville Regular'],
  [250, 'Edville Rookie'],
  [0, 'Edville Tourist'],
];

export function tier(points) {
  return TIERS.find(([min]) => points >= min)[1];
}

export function bar(points, width = 10) {
  const filled = Math.round((points / 1000) * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

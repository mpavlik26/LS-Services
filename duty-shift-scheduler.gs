// ─── Sheet layout constants ────────────────────────────────────────────────
const ROW_DAY_NUMBERS   = 7;   // row containing day-of-month numbers (1..31)
const ROW_DAY_NAMES     = 8;   // row containing Czech day-of-week names
const ROW_EMPLOYEES_START = 9; // first row with an employee name
const COL_EMPLOYEE_NAMES  = 2; // column containing employee names (B)
const COL_FIRST_DAY       = 3; // column of the first day of the month (C)

// Availability tokens
const TOKEN_CANNOT      = '-';
const TOKEN_LAST_RESORT = '*';
const TOKEN_DONT_MIND   = '?';
const TOKEN_WANTS       = '!';
const TOKEN_ASSIGNED    = 1;   // numeric 1 means already assigned

// Czech day-of-week tokens
const DAY_FRIDAY   = 'pá';
const DAY_SATURDAY = 'so';
const DAY_SUNDAY   = 'ne';
const DAY_HOLIDAY  = 'sv';

// ─── Menu ──────────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Duty Scheduler')
    .addItem('Assign duty shifts', 'assignDutyShifts')
    .addToUi();
}

// ─── Entry point ───────────────────────────────────────────────────────────

function assignDutyShifts() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data  = sheet.getDataRange().getValues();

  const { employees, days } = parseSheet(data);

  // Pre-count "wants" per employee (for R-WANTS proportional distribution)
  employees.forEach(emp => {
    emp.wantsCount = days.filter(d => emp.availability[d.col] === TOKEN_WANTS).length;
  });

  // Resolve each day in column order
  days.forEach(day => {
    if (day.alreadyAssigned) return; // R-ASSIGN-JUST-ONE

    const chosen = selectEmployee(day, employees, days);
    if (!chosen) return;

    // Write the assignment back to the sheet
    sheet.getRange(chosen.row, day.col).setValue(TOKEN_ASSIGNED);

    // Update in-memory state so subsequent days see the new assignment
    chosen.availability[day.col] = TOKEN_ASSIGNED;
    chosen.totalAssigned++;
    if (day.isWeekendOrHoliday) chosen.weekendAssigned++;
    if (chosen.availability[day.col] === TOKEN_WANTS) chosen.wantedAndAssigned++;
  });

  SpreadsheetApp.getActiveSpreadsheet().toast('Duty shifts assigned.', 'Done', 5);
}

// ─── Sheet parser ──────────────────────────────────────────────────────────

function parseSheet(data) {
  // Collect day columns
  const days = [];
  let col = COL_FIRST_DAY;
  while (col < data[ROW_DAY_NUMBERS - 1].length + 1) {
    const dayNum = data[ROW_DAY_NUMBERS - 1][col - 1];
    if (dayNum === '' || dayNum === null || dayNum === undefined) break;
    if (typeof dayNum !== 'number' && isNaN(Number(dayNum))) break;

    const dayName = String(data[ROW_DAY_NAMES - 1][col - 1]).trim().toLowerCase();
    const isWeekend  = dayName === DAY_SATURDAY || dayName === DAY_SUNDAY;
    const isHoliday  = dayName === DAY_HOLIDAY;
    const isFriday   = dayName === DAY_FRIDAY;

    // Check whether any employee already has 1 in this column
    let alreadyAssigned = false;
    for (let r = ROW_EMPLOYEES_START - 1; r < data.length; r++) {
      if (data[r][COL_EMPLOYEE_NAMES - 1] === '' || data[r][COL_EMPLOYEE_NAMES - 1] === null) break;
      if (data[r][col - 1] === TOKEN_ASSIGNED || data[r][col - 1] === 1) {
        alreadyAssigned = true;
        break;
      }
    }

    days.push({
      col,
      dayNum: Number(dayNum),
      dayName,
      isWeekend,
      isHoliday,
      isFriday,
      isWeekendOrHoliday: isWeekend || isHoliday,
      alreadyAssigned,
    });
    col++;
  }

  // Collect employees
  const employees = [];
  for (let r = ROW_EMPLOYEES_START - 1; r < data.length; r++) {
    const name = data[r][COL_EMPLOYEE_NAMES - 1];
    if (name === '' || name === null || name === undefined) break;

    const availability = {};
    days.forEach(d => {
      const raw = data[r][d.col - 1];
      availability[d.col] = (raw === 1 || raw === '1') ? TOKEN_ASSIGNED : String(raw ?? '').trim();
    });

    employees.push({
      name: String(name),
      row: r + 1,        // 1-based sheet row
      availability,
      totalAssigned:    days.filter(d => availability[d.col] === TOKEN_ASSIGNED).length,
      weekendAssigned:  days.filter(d => d.isWeekendOrHoliday && availability[d.col] === TOKEN_ASSIGNED).length,
      wantedAndAssigned: 0,
      wantsCount: 0,
    });
  }

  return { employees, days };
}

// ─── Employee selection for a single day ──────────────────────────────────

function selectEmployee(day, employees, allDays) {
  // Build candidate list: employees who have any positive availability token
  const positiveTokens = new Set([TOKEN_LAST_RESORT, TOKEN_DONT_MIND, TOKEN_WANTS]);
  let candidates = employees.filter(emp => positiveTokens.has(emp.availability[day.col]));
  if (!candidates.length) return null;

  // ── R-AT-LEAST-ONE-DUTY-PER-MONTH (9900) ──────────────────────────────────
  // Must run before R-WANTS — higher priority number means higher priority.
  // If any available candidate has no assignments yet, restrict to those first.
  const needsFirst = candidates.filter(emp => emp.totalAssigned === 0);
  if (needsFirst.length) candidates = needsFirst;

  // ── R-WANTS (9800) ────────────────────────────────────────────────────────
  const wantsCandidates = candidates.filter(emp => emp.availability[day.col] === TOKEN_WANTS);
  if (wantsCandidates.length) {
    return pickByWantsRatio(wantsCandidates);
  }

  // ── R-DO-NOT-MIND-OVER-LAST-RESORT (9700) ─────────────────────────────────
  const dontMind = candidates.filter(emp => emp.availability[day.col] === TOKEN_DONT_MIND);
  if (dontMind.length) candidates = dontMind;

  // ── R-FAIR-ASSIGNMENT (9600) ───────────────────────────────────────────────
  candidates = pickLeastTotalAssigned(candidates);

  // ── R-FAIR-WEEKEND-ASSIGNMENTS (9500) ─────────────────────────────────────
  if (day.isWeekendOrHoliday) {
    candidates = pickLeastWeekendAssigned(candidates);
  }

  // ── R-UNINTERRUPTED-WEEKENDS (9400) ───────────────────────────────────────
  if (day.isWeekend || day.isFriday) {
    candidates = applyUninterruptedWeekends(day, candidates, allDays, employees);
  }

  // Break ties arbitrarily (stable: first in sheet order)
  return candidates[0] ?? null;
}

// ─── Rule helpers ─────────────────────────────────────────────────────────

// R-WANTS: pick proportionally to wantsCount (weighted random)
function pickByWantsRatio(candidates) {
  const totalWants = candidates.reduce((s, e) => s + (e.wantsCount || 1), 0);
  // Subtract already-assigned duties from weight so over-assigned employees
  // are less likely to win again
  const weights = candidates.map(e => Math.max(0, (e.wantsCount || 1) - e.totalAssigned));
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  if (totalWeight === 0) {
    // All weights zeroed out — fall back to least assigned
    return pickLeastTotalAssigned(candidates)[0];
  }

  let rand = Math.random() * totalWeight;
  for (let i = 0; i < candidates.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

// R-UNINTERRUPTED-WEEKENDS: if an adjacent weekend day (or Friday) is already
// assigned to someone, strongly prefer that same person.
function applyUninterruptedWeekends(day, candidates, allDays, allEmployees) {
  // Find columns of the surrounding weekend block (Fri/Sat/Sun)
  const weekendBlockCols = getWeekendBlockCols(day, allDays);

  // Find employees already assigned within this block
  const assignedInBlock = new Set();
  weekendBlockCols.forEach(c => {
    if (c === day.col) return;
    allEmployees.forEach(emp => {
      if (emp.availability[c] === TOKEN_ASSIGNED) assignedInBlock.add(emp.name);
    });
  });

  if (!assignedInBlock.size) return candidates; // no prior assignment in block

  const preferred = candidates.filter(emp => assignedInBlock.has(emp.name));
  return preferred.length ? preferred : candidates;
}

function getWeekendBlockCols(day, allDays) {
  // Walk backwards/forwards to collect the Friday–Sunday block around this day
  const idx = allDays.findIndex(d => d.col === day.col);
  const block = [day.col];

  // Walk backward
  for (let i = idx - 1; i >= 0; i--) {
    const d = allDays[i];
    if (d.isWeekend || d.isFriday) block.push(d.col);
    else break;
  }
  // Walk forward
  for (let i = idx + 1; i < allDays.length; i++) {
    const d = allDays[i];
    if (d.isWeekend || d.isFriday) block.push(d.col);
    else break;
  }
  return block;
}

// R-FAIR-ASSIGNMENT: return subset with fewest total assignments
function pickLeastTotalAssigned(candidates) {
  const min = Math.min(...candidates.map(e => e.totalAssigned));
  return candidates.filter(e => e.totalAssigned === min);
}

// R-FAIR-WEEKEND-ASSIGNMENTS: return subset with fewest weekend/holiday assignments
function pickLeastWeekendAssigned(candidates) {
  const min = Math.min(...candidates.map(e => e.weekendAssigned));
  return candidates.filter(e => e.weekendAssigned === min);
}

const THRESHOLD_TOLERANCE = 1e-9;
const MINUTES_AND_SECONDS = /^(\d+)\s*[:：分′'’]\s*(\d{1,2}(?:[.]\d+)?)\s*(?:秒|″|”|"|['’′]{2})?$/u;
const SECONDS_ONLY = /^(\d+)\s*秒?$/u;

export function parseRun(input) {
  const time = String(input ?? '').trim();
  const clock = time.match(MINUTES_AND_SECONDS);
  if (clock && Number(clock[2]) >= 60) {
    throw new Error('分钟格式中的秒数须小于60。');
  }

  const seconds = clock
    ? Number(clock[1]) * 60 + Number(clock[2])
    : Number(time.match(SECONDS_ONLY)?.[1]);
  if (!Number.isFinite(seconds)) {
    throw new Error('请用“分:秒”格式或以整数秒填写长跑时间。');
  }
  return seconds;
}

export function thresholdScore(group, key, value) {
  const fasterIsBetter = key === 'sprint' || key === 'run';
  for (const row of group.rows) {
    const threshold = row[key];
    if (threshold == null) continue;

    const meetsThreshold = fasterIsBetter
      ? value <= threshold + THRESHOLD_TOLERANCE
      : value >= threshold - THRESHOLD_TOLERANCE;
    if (meetsThreshold) return row.points;
  }
  return 0;
}

function measurement(input, label, isValid, requirement) {
  const hasValue = typeof input === 'number' || (typeof input === 'string' && input.trim() !== '');
  const value = hasValue ? Number(input) : NaN;
  if (!Number.isFinite(value) || !isValid(value)) {
    throw new Error(`${label}${requirement}。`);
  }
  return value;
}

function bonusPoints(group, improvement, metric) {
  if (!(improvement > 0)) return 0;
  const match = group.bonus.find(row =>
    row[metric] != null && improvement >= row[metric] - THRESHOLD_TOLERANCE);
  return match?.points ?? 0;
}

export function fitnessResult(input, data) {
  const group = data.groups[`${input.sex}_${input.year}`];
  if (!group) throw new Error('请选择有效的性别和年级组。');

  const positive = value => value > 0;
  const nonnegative = value => value >= 0;
  const height = measurement(input.height, '身高', positive, '须为正数');
  const weight = measurement(input.weight, '体重', positive, '须为正数');
  const values = {
    lung: measurement(input.lung, '肺活量', nonnegative, '须为非负数'),
    sprint: measurement(input.sprint, '50米跑时间', positive, '须为正数'),
    reach: measurement(input.reach, '坐位体前屈', () => true, '须为有限数值'),
    jump: measurement(input.jump, '立定跳远', nonnegative, '须为非负数'),
    strength: measurement(input.strength, '力量项目次数',
      value => Number.isInteger(value) && nonnegative(value), '须为非负整数'),
    run: measurement(parseRun(input.run), '长跑时间', positive, '须为正数'),
  };

  const bmi = Math.round(weight / (height / 100) ** 2 * 10) / 10;
  if (!Number.isFinite(bmi)) throw new Error('身高、体重超出可计算范围。');
  const lowerNormalBmi = input.sex === 'male' ? 17.9 : 17.2;
  let bmiPoints = 100;
  if (bmi >= 28) bmiPoints = 60;
  else if (bmi >= 24 || bmi < lowerNormalBmi) bmiPoints = 80;

  const points = { bmi: bmiPoints };
  for (const [metric, value] of Object.entries(values)) {
    points[metric] = thresholdScore(group, metric, value);
  }
  const base = Object.entries(points)
    .reduce((weighted, [metric, score]) => weighted + data.weights[metric] * score, 0) / 100;

  const topRow = group.rows[0];
  const strengthBonus = bonusPoints(group, values.strength - topRow.strength, 'strength_extra');
  const runBonus = bonusPoints(group, topRow.run - values.run, 'run_seconds_faster');
  const total = Math.min(120, base + strengthBonus + runBonus);
  let level = '不及格';
  if (total >= 90) level = '优秀';
  else if (total >= 80) level = '良好';
  else if (total >= 60) level = '及格';

  return { bmi, points, base, strengthBonus, runBonus, total, level, values };
}

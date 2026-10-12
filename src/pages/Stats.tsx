import { useBuilder, useLogs, usePlanned } from '../db/hooks';
import { computeStats } from '../core/stats';
import { CATEGORY, CATEGORY_ORDER, loggableIndices, logStreak, parentReport, totals } from '../core/logs';
import { studyGoalFor } from '../core/routine';
import { addDays, currentIndex, days as dayList, hoursText, monthDay, todayKey, weekdayName } from '../core/time';
import { Progress, Section, Sheet, useToast } from '../ui/components';
import { subjectColor } from '../ui/colors';

/** 週報：讀書 vs 休閒、各類別與各科時數、記錄完整度、連續記錄天數；可分享給家長（只含總數）。 */
export function StatsSheet(props: { onClose: () => void }) {
  const builder = useBuilder();
  const logs = useLogs();
  const planned = usePlanned();
  const toast = useToast();
  const today = todayKey();
  const from = addDays(today, -6);
  const week = dayList(from, 7);
  const weekLogs = logs.filter((l) => l.day >= from && l.day <= today);
  const t = totals(weekLogs);
  const nowIdx = currentIndex(new Date());

  // 記錄完整度從第一筆記錄（那一天的那一格）算起，開始用 App 之前的時間不算
  const first = logs.reduce<{ day: string; index: number } | null>(
    (m, l) => (m === null || l.day < m.day || (l.day === m.day && l.index < m.index) ? { day: l.day, index: l.index } : m), null);
  // 每天：讀書、休閒、其他、目標，以及「已過的需記錄格」與「其中已記錄」
  const perDay = week.map((d) => {
    const plan = builder.plan(d);
    const dl = weekLogs.filter((l) => l.day === d);
    const logged = new Set(dl.map((l) => l.index));
    const due = first === null || d < first.day ? [] :
      loggableIndices(plan).filter((i) => (d < today || i < nowIdx) && (d > first.day || i >= first.index));
    const dt = totals(dl);
    return { d, study: dt.study, leisure: dt.leisure, other: dt.other, goal: studyGoalFor(builder.routine, plan.isSchoolDay), due: due.length, done: due.filter((i) => logged.has(i)).length };
  });
  const goalTotal = perDay.reduce((a, x) => a + x.goal, 0);
  const dueTotal = perDay.reduce((a, x) => a + x.due, 0);
  const completeness = dueTotal ? perDay.reduce((a, x) => a + x.done, 0) / dueTotal : null;
  const streak = logStreak(new Set(logs.map((l) => l.day)), today);
  const max = Math.max(1, ...perDay.map((x) => Math.max(x.study + x.leisure + x.other, x.goal)));

  const plan = computeStats(planned.filter((p) => p.day >= from && p.day <= today).map((p) => ({ subject: p.subject || undefined, status: p.status })));
  const cats = CATEGORY_ORDER.filter((c) => t.byCategory[c]);
  const catMax = Math.max(1, ...cats.map((c) => t.byCategory[c] ?? 0));
  const subjects = Object.entries(t.bySubject).sort((a, b) => b[1] - a[1]);
  const subMax = subjects[0]?.[1] ?? 1;

  const reportText = parentReport({ from, to: today, totals: t, goalTotal, completeness, streak });
  const share = () => {
    const text = reportText;
    // 分享必須由點擊直接觸發，前面不能有 await
    if (navigator.share) {
      navigator.share({ text }).catch((e: Error) => {
        if (e.name !== 'AbortError') copy(text);
      });
    } else {
      copy(text);
    }
  };
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast('週報已複製', '可以貼到 LINE 傳給家長'),
      () => toast('無法複製', text, '⚠️'),
    );
  };

  return (
    <Sheet title="週報" onClose={props.onClose}>
      <Section title={`最近 7 天（${monthDay(from)}–${monthDay(today)}）`} pad>
        <div className="stats" style={{ flexWrap: 'wrap', rowGap: 10 }}>
          <div><div className="n" style={{ color: 'var(--accent)' }}>{hoursText(t.study)}</div><div className="l">讀書（目標 {hoursText(goalTotal)}）</div></div>
          <div><div className="n" style={{ color: 'var(--teal)' }}>{hoursText(t.leisure)}</div><div className="l">休閒</div></div>
          <div><div className="n">{completeness === null ? '—' : `${Math.round(completeness * 100)}%`}</div><div className="l">記錄完整度</div></div>
          <div><div className="n">{streak}</div><div className="l">連續記錄天數</div></div>
        </div>

        <div className="trend" role="img" aria-label="最近 7 天讀書與休閒格數">
          {perDay.map((x) => (
            <div key={x.d} className="col" title={`${monthDay(x.d)} 讀書 ${x.study}・休閒 ${x.leisure}・其他 ${x.other}・目標 ${x.goal}`}>
              <div style={{ height: `${(x.other / max) * 100}%`, background: 'var(--text-2)', opacity: 0.45 }} />
              <div style={{ height: `${(x.leisure / max) * 100}%`, background: 'var(--teal)' }} />
              <div style={{ height: `${(x.study / max) * 100}%`, background: x.study >= x.goal && x.goal > 0 ? 'var(--ok)' : 'var(--accent)' }} />
            </div>
          ))}
        </div>
        <div className="trend-x">
          {perDay.map((x) => (
            <div key={x.d}>
              {weekdayName(x.d)}
              <div style={{ fontVariantNumeric: 'tabular-nums' }}>{x.study}/{x.goal}</div>
            </div>
          ))}
        </div>
        <div className="stack-legend">
          <span><i style={{ background: 'var(--accent)' }} />讀書</span>
          <span><i style={{ background: 'var(--ok)' }} />讀書達標</span>
          <span><i style={{ background: 'var(--teal)' }} />休閒</span>
          <span><i style={{ background: 'var(--text-2)', opacity: 0.45 }} />其他</span>
          <span>數字＝讀書格／目標格</span>
        </div>
      </Section>

      <Section title="時間花在哪裡">
        {cats.length === 0 && <div className="empty">還沒有記錄。點「今天」右下角「＋ 記錄」開始。</div>}
        {cats.map((c) => (
          <div key={c} className="row" style={{ display: 'block' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>{CATEGORY[c].icon} {CATEGORY[c].name}
                {c === 'leisure' && Object.keys(t.byLabel).length > 0 && (
                  <span className="small muted">（{Object.entries(t.byLabel).map(([l, n]) => `${l} ${hoursText(n)}`).join('、')}）</span>
                )}
              </span>
              <span className="muted">{hoursText(t.byCategory[c] ?? 0)}</span>
            </div>
            <Progress value={t.byCategory[c] ?? 0} max={catMax} color={CATEGORY[c].color} />
          </div>
        ))}
      </Section>

      {subjects.length > 0 && (
        <Section title="各科讀書時數">
          {subjects.map(([name, n]) => (
            <div key={name} className="row" style={{ display: 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>{name}</span>
                <span className="muted">{hoursText(n)}</span>
              </div>
              <Progress value={n} max={subMax} color={subjectColor(name)} />
            </div>
          ))}
        </Section>
      )}

      <Section title="排程計畫">
        <div className="row"><span className="grow">計畫格</span><span className="value">{plan.total} 格</span></div>
        <div className="row"><span className="grow">完成／部分／未做</span><span className="value">{plan.done}／{plan.partial}／{plan.skipped}</span></div>
        <div className="row"><span className="grow">計畫完成率</span><b>{plan.checkedIn === 0 ? '尚未打卡' : `${Math.round(plan.completionRate * 100)}%`}</b></div>
      </Section>

      <Section footer="家長版只有讀書、休閒、其他的總時數與各科時數，不含每一格做了什麼。">
        <button className="row" style={{ justifyContent: 'center', color: 'var(--accent)', fontWeight: 600 }} onClick={share}>📤 分享週報給家長</button>
        <button className="row" style={{ justifyContent: 'center', color: 'var(--accent)' }} onClick={() => copy(reportText)}>📋 複製週報文字</button>
      </Section>
    </Sheet>
  );
}

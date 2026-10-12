import { useMemo, useState } from 'react';
import type { Builder } from '../db/hooks';
import { acceptSuggestions, occupiedMap, schedTasks, usePlanned, useTasks } from '../db/hooks';
import { suggest } from '../core/scheduler';
import { dayTitle, days, rangeLabel, todayKey } from '../core/time';
import { Section, Sheet } from '../ui/components';
import { subjectColor } from '../ui/colors';

const key = (day: string, index: number) => `${day}#${index}`;

/** 自動排程建議（7 天）：預覽後勾選接受。 */
export function SuggestionSheet(props: { startDay: string; builder: Builder; onClose: () => void }) {
  const { builder } = props;
  const planned = usePlanned();
  const tasks = useTasks();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const src = { planned, tasks };

  const result = useMemo(() => {
    const today = todayKey();
    const first = props.startDay > today ? props.startDay : today;
    return suggest({
      plans: days(first, 7).map((d) => builder.plan(d)),
      existing: occupiedMap(src.planned),
      classes: builder.classes,
      tasks: schedTasks(src.tasks, src.planned),
      routine: builder.routine,
      now: new Date(),
    });
  }, [builder, planned, tasks, props.startDay]);

  const chosen = result.suggestions.filter((s) => !excluded.has(key(s.day, s.index)));
  const byDay = new Map<string, typeof result.suggestions>();
  for (const s of result.suggestions) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);

  const toggle = (k: string) => {
    const next = new Set(excluded);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setExcluded(next);
  };

  const accept = async () => {
    await acceptSuggestions(chosen);
    props.onClose();
  };

  return (
    <Sheet title="排程建議（7 天）" onClose={props.onClose} onDone={accept} doneText={`接受 ${chosen.length} 格`} doneDisabled={chosen.length === 0}>
      <div className="section-foot" style={{ margin: '12px 14px 0' }}>
        每天只排可支配格的 {Math.round(builder.routine.maxFillRatio * 100)}%，保留休息緩衝；國英數當天有課就排 1 格複習。點一下可取消勾選。
      </div>

      {Object.keys(result.unplaced).length > 0 && (
        <Section title="排不下的任務">
          {Object.entries(result.unplaced).map(([id, n]) => (
            <div key={id} className="row warn">
              ⚠️ {src.tasks.find((t) => t.id === id)?.title ?? '任務'}：還差 {n} 格（截止前沒有足夠空格）
            </div>
          ))}
        </Section>
      )}

      {result.suggestions.length === 0 && (
        <Section>
          <div className="empty">目前沒有需要安排的內容，或空格已排滿。<br />可以先到「任務」新增作業或段考。</div>
        </Section>
      )}

      {[...byDay.entries()].map(([day, list]) => (
        <Section key={day} title={dayTitle(day)}>
          {list.map((s) => {
            const k = key(s.day, s.index);
            const off = excluded.has(k);
            return (
              <button key={k} className="row" onClick={() => toggle(k)}>
                <span style={{ fontSize: 18, color: off ? 'var(--text-2)' : 'var(--accent)' }}>{off ? '○' : '●'}</span>
                <span className="time">{rangeLabel(s.index)}</span>
                <span className="grow" style={{ opacity: off ? 0.45 : 1 }}>{s.title}</span>
                {s.subject && <span className="bar" style={{ background: subjectColor(s.subject), width: 8, height: 8, borderRadius: 4, alignSelf: 'center' }} />}
              </button>
            );
          })}
        </Section>
      ))}
    </Sheet>
  );
}

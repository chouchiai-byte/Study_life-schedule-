import { useRef, useState } from 'react';
import { exportBackup, importBackup, saveRoutine, updateRoutine } from '../db/db';
import { useBuilder } from '../db/hooks';
import { DEFAULT_ROUTINE } from '../core/routine';
import type { RoutineConfig } from '../core/routine';
import { freeIndices, flexibleIndices } from '../core/types';
import { addDays, mondayOf, todayKey } from '../core/time';
import { Section, Sheet, Stepper, TimeSelect, Toggle, useConfirm, useToast } from '../ui/components';
import { askPermission, notificationStatus } from '../services/notify';
import { FileReady } from '../ui/FileReady';
import type { ReadyFile } from '../ui/FileReady';

/** 作息、每日複習、排程、提醒、備份。修改後各畫面的格數立即重算。 */
export function SettingsSheet(props: { onClose: () => void }) {
  const builder = useBuilder();
  const r = builder.routine;
  const toast = useToast();
  const ask = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [perm, setPerm] = useState(notificationStatus());
  const [ready, setReady] = useState<ReadyFile | null>(null);

  const set = <K extends keyof RoutineConfig>(k: K, v: RoutineConfig[K]) => updateRoutine({ [k]: v } as Partial<RoutineConfig>);

  const monday = mondayOf(todayKey());
  const weekday = builder.plan(monday);
  const saturday = builder.plan(addDays(monday, 5));

  const subjects = [...builder.subjects, ...r.dailyReviewSubjects.filter((s) => !builder.subjects.includes(s))];

  const minutes = (k: keyof RoutineConfig, min: number, max: number, step: number) => (
    <select value={r[k] as number} onChange={(e) => set(k, Number(e.target.value) as never)}>
      {Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => min + i * step).map((m) => (
        <option key={m} value={m}>{m} 分鐘</option>
      ))}
    </select>
  );

  const backup = async () => {
    const json = await exportBackup();
    const d = new Date();
    setReady({ hint: '建議存到「檔案」App，或傳給家長保存。', blob: new Blob([json], { type: 'application/json' }), name: `半時格備份_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json` });
  };

  const restore = async (file: File) => {
    if (!(await ask('還原會用備份檔取代目前所有資料，確定嗎？', '還原'))) return;
    try {
      await importBackup(await file.text());
      toast('已還原備份');
    } catch (e) {
      toast('還原失敗', e instanceof Error ? e.message : String(e), '⚠️');
    }
  };

  return (
    <Sheet title="設定" onClose={props.onClose}>
      <Section title="目前格數" footer="1 格 = 30 分鐘">
        <div className="row"><span className="grow">上學日</span><span className="value">可支配 {freeIndices(weekday).length} 格・彈性 {flexibleIndices(weekday).length} 格</span></div>
        <div className="row"><span className="grow">週六</span><span className="value">可支配 {freeIndices(saturday).length} 格</span></div>
      </Section>

      <Section title="每日讀書目標（自己決定）" footer="讀書、作業、補習課程都算進讀書格。">
        {(['studyGoalWeekday', 'studyGoalWeekend'] as const).map((k) => (
          <div key={k} className="row">
            <div className="grow">
              {k === 'studyGoalWeekday' ? '上學日' : '假日與停課日'}
              <div className="sub">{r[k]} 格 = {r[k] / 2} 小時</div>
            </div>
            <Stepper value={r[k]} min={0} max={20} onChange={(v) => updateRoutine({ [k]: v, studyGoalSet: true })} />
          </div>
        ))}
      </Section>

      <Section title="上學日作息">
        <div className="row"><span className="label">起床</span><TimeSelect value={r.wake} onChange={(v) => set('wake', v)} min={300} max={540} /></div>
        <div className="row"><span className="label">出門</span><TimeSelect value={r.leaveHome} onChange={(v) => set('leaveHome', v)} min={300} max={540} step={5} /></div>
        <div className="row"><span className="label">到校（早自習）</span><TimeSelect value={r.schoolStart} onChange={(v) => set('schoolStart', v)} min={360} max={540} step={5} /></div>
        <div className="row"><span className="label">放學</span><TimeSelect value={r.schoolEnd} onChange={(v) => set('schoolEnd', v)} min={720} max={1140} step={5} /></div>
        <div className="row"><span className="label">放學通勤</span>{minutes('commuteMinutes', 0, 120, 5)}</div>
      </Section>

      <Section title="每天共通">
        <div className="row"><span className="label">晚餐開始</span><TimeSelect value={r.dinnerStart} onChange={(v) => set('dinnerStart', v)} min={1020} max={1260} /></div>
        <div className="row"><span className="label">晚餐長度</span>{minutes('dinnerMinutes', 0, 120, 15)}</div>
        <div className="row"><span className="label">洗澡開始</span><TimeSelect value={r.bathStart} onChange={(v) => set('bathStart', v)} min={1080} max={1410} /></div>
        <div className="row"><span className="label">洗澡長度</span>{minutes('bathMinutes', 0, 90, 15)}</div>
        <div className="row"><span className="label">最早就寢（彈性格開始）</span><TimeSelect value={r.bedtimeEarliest} onChange={(v) => set('bedtimeEarliest', v)} min={1260} max={1440} step={30} /></div>
        <div className="row"><span className="label">最晚就寢</span><TimeSelect value={r.bedtimeLatest} onChange={(v) => set('bedtimeLatest', v)} min={1260} max={1440} step={30} /></div>
        {r.bedtimeLatest < r.bedtimeEarliest && <div className="row small danger">最晚就寢不能早於最早就寢。</div>}
      </Section>

      <Section title="週末與停課日" footer="週末的補習、複習課程請到「課表 › 自建課程與時段」新增，會自動扣除可支配格。">
        <div className="row"><span className="label">起床</span><TimeSelect value={r.weekendWake} onChange={(v) => set('weekendWake', v)} min={360} max={660} /></div>
        <div className="row"><span className="label">午餐開始</span><TimeSelect value={r.lunchStart} onChange={(v) => set('lunchStart', v)} min={660} max={840} /></div>
        <div className="row"><span className="label">午餐長度</span>{minutes('lunchMinutes', 0, 120, 15)}</div>
      </Section>

      <Section title="每日複習科目" footer="當天有上這些科目，排程建議會在晚上各排 1 格複習。">
        {subjects.map((s) => (
          <label key={s} className="row">
            <span className="grow">{s}</span>
            <Toggle
              checked={r.dailyReviewSubjects.includes(s)}
              onChange={(on) => set('dailyReviewSubjects', on ? [...r.dailyReviewSubjects, s] : r.dailyReviewSubjects.filter((x) => x !== s))}
            />
          </label>
        ))}
      </Section>

      <Section title="排程">
        <div className="row" style={{ display: 'block' }}>
          <div>每天最多排滿可支配格的 {Math.round(r.maxFillRatio * 100)}%</div>
          <input type="range" min={0.5} max={1} step={0.05} value={r.maxFillRatio} onChange={(e) => set('maxFillRatio', Number(e.target.value))} style={{ width: '100%' }} />
        </div>
      </Section>

      <Section title="提醒" footer="網頁 App 開著時會在每格開始前 5 分鐘提醒。App 關閉後的提醒，請到「任務」頁右上角匯出行事曆，交給 iPhone 行事曆提醒。">
        <div className="row">
          <span className="grow">通知權限<div className="sub">{perm === 'granted' ? '已允許' : perm === 'denied' ? '已拒絕（請到 iPhone 設定 › 通知 開啟）' : perm === 'unsupported' ? '需先「加入主畫面」後從主畫面開啟' : '尚未允許'}</div></span>
          {perm === 'default' && <button className="btn secondary" onClick={async () => setPerm(await askPermission())}>允許通知</button>}
        </div>
        <label className="row"><span className="grow">每格開始前 5 分鐘提醒</span><Toggle checked={r.notifyBeforeBlocks} onChange={(v) => set('notifyBeforeBlocks', v)} /></label>
        <label className="row"><span className="grow">睡前提醒明日課表與備忘</span><Toggle checked={r.bedtimeSummary} onChange={(v) => set('bedtimeSummary', v)} /></label>
        {r.bedtimeSummary && (
          <div className="row"><span className="label">提醒時間</span><TimeSelect value={r.bedtimeSummaryAt} onChange={(v) => set('bedtimeSummaryAt', v)} min={1140} max={1410} /></div>
        )}
      </Section>

      <Section title="資料備份" footer="資料只存在這支手機的瀏覽器裡。建議每週匯出一次備份，存到「檔案」或傳給家長。">
        <button className="row" style={{ color: 'var(--accent)' }} onClick={backup}>⬇︎ 匯出備份檔</button>
        <button className="row" style={{ color: 'var(--accent)' }} onClick={() => fileRef.current?.click()}>⬆︎ 從備份檔還原</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ''; }} />
      </Section>

      <Section>
        <button className="row danger" style={{ justifyContent: 'center' }} onClick={async () => { if (await ask('恢復預設作息？', '恢復')) saveRoutine(DEFAULT_ROUTINE); }}>恢復預設作息</button>
      </Section>
      {ready && <FileReady file={ready} onClose={() => setReady(null)} />}
    </Sheet>
  );
}

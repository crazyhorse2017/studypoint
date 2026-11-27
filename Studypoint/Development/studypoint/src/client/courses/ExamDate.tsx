// A course's exam date (CRD-07 exam cram). Three selects instead of a native date input (AGENTS 17).
// Until that date, every card in the course is scheduled to be seen at least once more before the exam.

import { useState } from 'react';
import { Button, Select, useToast } from '../ds/index.ts';
import { setExamDate } from '../cards/cardsApi.ts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function ExamDate({ courseId, examAt, onChanged }: { courseId: string; examAt: number | null; onChanged: (at: number | null) => void }) {
  const toast = useToast();
  const today = new Date();
  const init = examAt ? new Date(examAt) : null;
  const [month, setMonth] = useState<string | null>(init ? String(init.getMonth()) : null);
  const [day, setDay] = useState<string | null>(init ? String(init.getDate()) : null);
  const [year, setYear] = useState<string>(String((init ?? today).getFullYear()));
  const [busy, setBusy] = useState(false);
  const daysIn = month !== null ? new Date(Number(year), Number(month) + 1, 0).getDate() : 31;

  const save = async (clear: boolean) => {
    setBusy(true);
    try {
      // 9:00 local time on the exam day.
      const at = clear || month === null || day === null ? null : new Date(Number(year), Number(month), Math.min(Number(day), daysIn), 9).getTime();
      await setExamDate(courseId, at);
      onChanged(at);
      if (clear) {
        setMonth(null);
        setDay(null);
      }
      toast.show({ message: clear ? 'Exam date removed' : 'Exam date saved. Cards in this course will be reviewed before it.' });
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Couldn’t save the exam date.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <Select label="Month" value={month} placeholder="Month" options={MONTHS.map((m, i) => ({ value: String(i), label: m }))} onChange={setMonth} />
        </div>
        <div className="w-24">
          <Select label="Day" value={day} placeholder="Day" options={Array.from({ length: daysIn }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} onChange={setDay} />
        </div>
        <div className="w-28">
          <Select label="Year" value={year} options={[0, 1].map((k) => String(today.getFullYear() + k)).map((y) => ({ value: y, label: y }))} onChange={setYear} />
        </div>
        <Button variant="primary" loading={busy} disabled={month === null || day === null} onClick={() => void save(false)}>
          Save exam date
        </Button>
        {examAt ? (
          <Button variant="ghost" disabled={busy} onClick={() => void save(true)}>
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}

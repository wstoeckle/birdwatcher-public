import { useMemo, useState } from 'react';
import type { ActivityDay } from '../types';

export function ActivityPanel({
  days,
  selectedDay,
  onSelectDay,
  title = 'Activity',
}: {
  days: ActivityDay[];
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
  title?: string;
}) {
  const sortedDays = useMemo(() => [...days].sort((a, b) => b.day.localeCompare(a.day)), [days]);
  const [month, setMonth] = useState(() => monthStart(new Date()));
  if (sortedDays.length === 0) return null;

  const dayCounts = new Map(sortedDays.map((day) => [day.day, day]));
  const earliestMonth = monthStart(new Date(`${sortedDays[sortedDays.length - 1]!.day}T12:00:00`));
  const latestMonth = monthStart(new Date());
  const week = sortedDays.slice(0, 7);

  return (
    <section className="activity-panel" aria-label={title}>
      <div className="daily-log">
        <h2 className="species-table-title">Last 7 days</h2>
        <div className="daily-log-list">
          {week.map((day) => (
            <button
              className={`daily-log-row ${selectedDay === day.day ? 'is-selected' : ''}`}
              key={day.day}
              type="button"
              onClick={() => onSelectDay(selectedDay === day.day ? null : day.day)}
            >
              <span>
                <time className="daily-log-date" dateTime={day.day}>
                  {formatDay(day.day)}
                </time>
                <span className="daily-log-species">{formatSpecies(day.species)}</span>
              </span>
              <strong className="daily-log-total">{day.total.toLocaleString()}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="activity-calendar">
        <div className="calendar-head">
          <button
            className="calendar-nav"
            type="button"
            onClick={() => setMonth((m) => addMonths(m, -1))}
            disabled={month <= earliestMonth}
            aria-label="Previous month"
          >
            ‹
          </button>
          <h2 className="species-table-title">{formatMonth(month)}</h2>
          <button
            className="calendar-nav"
            type="button"
            onClick={() => setMonth((m) => addMonths(m, 1))}
            disabled={month >= latestMonth}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
            <span key={`${day}-${index}`}>{day}</span>
          ))}
        </div>
        <div className="calendar-grid">
          {calendarCells(month).map((cell, index) => {
            if (!cell) return <span className="calendar-empty" key={`empty-${index}`} />;
            const activity = dayCounts.get(cell);
            const total = activity?.total ?? 0;
            return (
              <button
                className={`calendar-day density-${density(total, month, dayCounts)} ${
                  selectedDay === cell ? 'is-selected' : ''
                }`}
                key={cell}
                type="button"
                onClick={() => onSelectDay(selectedDay === cell ? null : cell)}
                aria-label={`${formatDay(cell)}: ${total.toLocaleString()} sightings`}
              >
                {Number(cell.slice(-2))}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function calendarCells(month: Date): (string | null)[] {
  const first = monthStart(month);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(formatIsoDay(new Date(first.getFullYear(), first.getMonth(), day)));
  }
  return cells;
}

function density(dayTotal: number, month: Date, dayCounts: Map<string, ActivityDay>): number {
  if (dayTotal <= 0) return 0;
  const monthPrefix = formatIsoDay(month).slice(0, 7);
  const max = Math.max(
    1,
    ...[...dayCounts.values()]
      .filter((day) => day.day.startsWith(monthPrefix))
      .map((day) => day.total),
  );
  return Math.max(1, Math.min(4, Math.ceil((dayTotal / max) * 4)));
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function formatIsoDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMonth(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatDay(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatSpecies(species: { species: string; count: number }[]): string {
  return species
    .slice(0, 5)
    .map((row) => `${row.species} ${row.count.toLocaleString()}`)
    .join(' · ');
}

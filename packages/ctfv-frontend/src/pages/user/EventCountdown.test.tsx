// @vitest-environment jsdom
import {cleanup,render,screen,act} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {EventCountdown} from './EventCountdown';

afterEach(()=>{cleanup();vi.useRealTimers();});

it('counts down to a future event start',()=>{
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));
  render(<EventCountdown startsAt='2026-07-01T12:00:10.000Z' endsAt='2026-07-01T13:00:00.000Z'/>);
  expect(screen.getByText('Starts in')).toBeTruthy();
  expect(screen.getByLabelText('10 seconds')).toBeTruthy();
});

it('switches the countdown target from start to end when the event begins',async()=>{
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));
  render(<EventCountdown startsAt='2026-07-01T12:00:02.000Z' endsAt='2026-07-01T12:00:10.000Z'/>);
  expect(screen.getByText('Starts in')).toBeTruthy();
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(screen.getByText('Ends in')).toBeTruthy();
  expect(screen.getByLabelText('8 seconds')).toBeTruthy();
});

it('shows the ended state after the scheduled end',()=>{
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-01T12:00:02.000Z'));
  render(<EventCountdown startsAt='2026-07-01T12:00:00.000Z' endsAt='2026-07-01T12:00:01.000Z'/>);
  expect(screen.getByText('Event has ended')).toBeTruthy();
});

it('renders nothing when the event has no schedule',()=>{
  const {container}=render(<EventCountdown startsAt={null} endsAt={null}/>);
  expect(container.firstChild).toBeNull();
});

it('uses a rolling reel class so reduced-motion styles can disable its animation',()=>{
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));
  render(<EventCountdown startsAt='2026-07-01T12:00:10.000Z' endsAt={null}/>);
  expect(document.querySelector('.countdown-reel')).toBeTruthy();
});
it('rolls each updated digit from the value shown on the previous tick',async()=>{
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));
  render(<EventCountdown startsAt='2026-07-01T12:00:10.000Z' endsAt={null}/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
  expect(screen.getByLabelText('9 seconds').querySelector('.countdown-reel')?.getAttribute('data-from')).toBe('10');
  await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
  expect(screen.getByLabelText('8 seconds').querySelector('.countdown-reel')?.getAttribute('data-from')).toBe('09');
});
it('does not keep a one-second interval when no schedule is configured',()=>{
  vi.useFakeTimers();
  const {container}=render(<EventCountdown startsAt={null} endsAt={null}/>);
  expect(container.firstChild).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
it('stops its interval after the event has ended',()=>{
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-01T12:00:02.000Z'));
  render(<EventCountdown startsAt='2026-07-01T12:00:00.000Z' endsAt='2026-07-01T12:00:01.000Z'/>);
  expect(screen.getByText('Event has ended')).toBeTruthy();
  expect(vi.getTimerCount()).toBe(0);
});

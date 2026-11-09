import { expect,it } from 'vitest';
import { localInputToUtc,utcToLocalInput } from './utils';
it('round trips scheduled wall times across whole-hour and fractional-hour zones',()=>{
  for(const zone of ['UTC','America/New_York','Asia/Kolkata','Australia/Sydney']){
    const wall='2026-06-15T12:30';
    expect(utcToLocalInput(localInputToUtc(wall,zone),zone)).toBe(wall);
  }
});
it('rejects a nonexistent daylight-saving time instead of silently moving the schedule',()=>{
  expect(()=>localInputToUtc('2026-03-08T02:30','America/New_York')).toThrow(/does not exist/i);
});

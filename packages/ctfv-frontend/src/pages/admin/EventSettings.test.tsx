// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { EventSettings } from './EventSettings';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('reports invitation-list outages without claiming the list is empty',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({name:'Event',description:'',timezone:'UTC',startsAt:null,endsAt:null,scoreboardFrozenAt:null,paused:false,scoreboardPublic:true,viewChallengesAfterEnd:true,registrationMode:'public',maxTeamSize:4,allowedEmailDomains:[]})).mockResolvedValueOnce(Response.json({error:'Unavailable'},{status:503})));
  render(<EventSettings/>);
  expect((await screen.findByRole('status')).textContent).toMatch(/invitation.*could not be loaded/i);
  expect(screen.queryByText('No invitations yet.')).toBeNull();
});
it('shows nonexistent local-time errors without sending a changed schedule',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(Response.json({name:'Event',description:'',timezone:'America/New_York',startsAt:null,endsAt:null,scoreboardFrozenAt:null,paused:false,scoreboardPublic:true,viewChallengesAfterEnd:true,registrationMode:'public',maxTeamSize:4,allowedEmailDomains:[]})).mockResolvedValueOnce(Response.json([]));
  vi.stubGlobal('fetch',fetch);
  render(<EventSettings/>);
  const starts=await screen.findByLabelText('Starts at');
  fireEvent.change(starts,{target:{value:'2026-03-08T02:30'}});
  fireEvent.click(screen.getByRole('button',{name:'Save settings'}));
  expect((await screen.findByRole('alert')).textContent).toMatch(/does not exist/i);
  expect(fetch.mock.calls.some(([,init])=>init?.method==='PUT')).toBe(false);
});

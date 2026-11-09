// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ChallengeExtras} from './Challenges';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('shows a hint-loading failure instead of silently presenting an empty list',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({error:'Hints temporarily unavailable'},{status:503})).mockResolvedValueOnce(Response.json({attachments:[]})));
  render(<ChallengeExtras challengeId='c'/>);
  expect((await screen.findByRole('alert')).textContent).toContain('Hints temporarily unavailable');
});
it('reports a download network failure without an unhandled rejection',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({hints:[]})).mockResolvedValueOnce(Response.json({attachments:[{id:'f',filename:'challenge.zip',size:1024}]})).mockRejectedValueOnce(new Error('Network unavailable')));
  render(<ChallengeExtras challengeId='c'/>);
  fireEvent.click(await screen.findByRole('button',{name:/challenge.zip/}));
  expect((await screen.findByRole('alert')).textContent).toContain('Network unavailable');
});

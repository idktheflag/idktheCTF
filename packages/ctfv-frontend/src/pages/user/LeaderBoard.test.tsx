// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LeaderBoard } from './LeaderBoard';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('keeps a successfully loaded leaderboard available when score history fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ leaderboard:[{teamId:'t',username:'Example team',totalPoints:100}] }))).mockRejectedValueOnce(new Error('History unavailable')));
  render(<MemoryRouter><LeaderBoard /></MemoryRouter>);
  expect(await screen.findByRole('link',{name:'Example team'})).toBeTruthy();
  expect(screen.queryByText(/Error fetching leaderboard:/)).toBeNull();
});
it('shows rankings while the optional history request is still pending', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ leaderboard:[{teamId:'t',username:'Ready team',totalPoints:100}] })).mockImplementationOnce(() => new Promise<Response>(() => {})));
  render(<MemoryRouter><LeaderBoard /></MemoryRouter>);
  expect(await screen.findByRole('link',{name:'Ready team'})).toBeTruthy();
  expect(screen.queryByText('Loading leaderboard...')).toBeNull();
});
it('renders large score histories without overflowing the argument stack', async () => {
  const points=Array.from({length:150000},(_,at)=>({at,score:at%100}));
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({leaderboard:[{teamId:'t',username:'Large history team',totalPoints:99}]})).mockResolvedValueOnce(Response.json({teams:[{teamId:'t',teamName:'Large history team',points}]})));
  render(<MemoryRouter><LeaderBoard/></MemoryRouter>);
  expect(await screen.findByRole('img',{name:'Team scores over time'})).toBeTruthy();
});
it('keeps negative score histories within the chart bounds',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({leaderboard:[{teamId:'t',username:'Team',totalPoints:-20}]})).mockResolvedValueOnce(Response.json({teams:[{teamId:'t',teamName:'Team',points:[{at:1,score:10},{at:2,score:-20}]}]})));
  render(<MemoryRouter><LeaderBoard/></MemoryRouter>);
  const graph=await screen.findByRole('img',{name:'Team scores over time'});
  const coordinates=graph.querySelector('polyline')!.getAttribute('points')!.split(' ');
  for(const pair of coordinates){const y=Number(pair.split(',')[1]);expect(y).toBeGreaterThanOrEqual(20);expect(y).toBeLessThanOrEqual(240);}
});

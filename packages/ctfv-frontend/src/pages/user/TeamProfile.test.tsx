// @vitest-environment jsdom
import {act,cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter,Route,Routes,useNavigate} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
import {TeamProfile} from './TeamProfile';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('clears a previous team error when navigating to an available team',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({error:'Old team unavailable'},{status:404})).mockResolvedValueOnce(Response.json({team:{id:'new',name:'Available team',members:[]},stats:{rank:null,totalPoints:0,solves:0,attempts:0,correctAttempts:0,accuracy:0,hintSpend:0,lastSolveAt:null},solvedChallenges:[]})));
  let navigate!:ReturnType<typeof useNavigate>;
  function Navigation(){navigate=useNavigate();return null;}
  render(<MemoryRouter initialEntries={['/team/old']}><Navigation/><Routes><Route path='/team/:teamId' element={<TeamProfile/>}/></Routes></MemoryRouter>);
  expect(await screen.findByText('Old team unavailable')).toBeTruthy();
  await act(async()=>navigate('/team/new'));
  expect(await screen.findByRole('heading',{name:'Available team'})).toBeTruthy();
  expect(screen.queryByText('Old team unavailable')).toBeNull();
});

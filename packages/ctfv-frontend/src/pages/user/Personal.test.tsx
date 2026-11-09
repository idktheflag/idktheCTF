// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Personal from './Personal';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('ignores an old profile response after navigating to another competitor',async()=>{
  const pending: ((response:Response)=>void)[]=[];
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>((resolve)=>pending.push(resolve))));
  let navigate!: ReturnType<typeof useNavigate>;
  function Navigation(){navigate=useNavigate();return null;}
  render(<MemoryRouter initialEntries={['/personal/old']}><Navigation/><Routes><Route path='/personal/:userId' element={<Personal/>}/></Routes></MemoryRouter>);
  await act(async()=>navigate('/personal/current'));
  await act(async()=>pending[1](Response.json({username:'Current competitor',rank:1,totalPoints:100,solvedChallenges:[]})));
  expect(screen.getByText('Current competitor')).toBeTruthy();
  await act(async()=>pending[0](Response.json({username:'Old competitor',rank:2,totalPoints:50,solvedChallenges:[]})));
  expect(screen.queryByText('Old competitor')).toBeNull();
  expect(screen.getByText('Current competitor')).toBeTruthy();
});

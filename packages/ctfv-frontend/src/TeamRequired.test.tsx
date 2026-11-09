// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { TeamRequired } from './App';
vi.mock('@/auth-context',()=>{const user={userId:'p',emailVerified:true,isAdmin:false};return {useAuth:()=>({user})};});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('does not treat a membership service failure as a missing team and allows retry',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({error:'Database unavailable'},{status:503})).mockResolvedValueOnce(Response.json({team:{id:'team'}})));
  render(<MemoryRouter initialEntries={['/challenges']}><Routes><Route path='/challenges' element={<TeamRequired><p>Challenge content</p></TeamRequired>}/><Route path='/teams' element={<p>Team creation page</p>}/></Routes></MemoryRouter>);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Team creation page')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/retry/i}));
  expect(await screen.findByText('Challenge content')).toBeTruthy();
});

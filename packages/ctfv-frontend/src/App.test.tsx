// @vitest-environment jsdom
import { cleanup,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import App from './App';
afterEach(()=>{cleanup();localStorage.clear();sessionStorage.clear();vi.unstubAllGlobals();});
it('renders the public leaderboard through the actual app router and auth provider',async()=>{
  window.history.replaceState({},'','/leaderboard');
  vi.stubGlobal('fetch',vi.fn(async(input)=>String(input).endsWith('/scoreboard-history')?Response.json({teams:[]}):Response.json({leaderboard:[{teamId:'team',username:'Smoke test team',totalPoints:100}]})));
  render(<App/>);
  expect(await screen.findByRole('link',{name:'Smoke test team'})).toBeTruthy();
  expect(screen.getByRole('heading',{name:'Leaderboard'})).toBeTruthy();
});
it('redirects an unauthenticated admin visit to a working login form',async()=>{
  window.history.replaceState({},'','/admin/dashboard');
  render(<App/>);
  await waitFor(()=>expect(window.location.pathname).toBe('/login'));
  expect(await screen.findByLabelText('Email')).toBeTruthy();
  expect(screen.getByLabelText('Password')).toBeTruthy();
});

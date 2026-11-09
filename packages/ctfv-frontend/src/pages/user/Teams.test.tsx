// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { Teams } from './Teams';
vi.mock('@/auth-context',()=>{const user={userId:'p',emailVerified:true,isAdmin:false};return{useAuth:()=>({user})};});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('does not offer team creation when membership failed to load and supports retry',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({error:'Service unavailable'},{status:503})).mockResolvedValueOnce(Response.json({teams:[]})).mockResolvedValueOnce(Response.json({team:{id:'t',name:'Existing team',captainId:'p',joinCode:'CODE'}})).mockResolvedValueOnce(Response.json({teams:[]})));
  render(<MemoryRouter><Teams/></MemoryRouter>);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Create team'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/retry/i}));
  expect(await screen.findByRole('link',{name:'Existing team'})).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

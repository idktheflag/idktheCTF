// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
import {Login} from './Login';
const {login}=vi.hoisted(()=>({login:vi.fn()}));
vi.mock('@/auth-context',()=>({useAuth:()=>({login})}));
afterEach(()=>{cleanup();login.mockReset();});
it('shows the server reason when login is rate limited',async()=>{
  login.mockRejectedValueOnce(new Error('Too many sign-in attempts. Wait a minute and try again.'));
  render(<MemoryRouter><Login/></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Email'),{target:{value:'p@example.test'}});
  fireEvent.change(screen.getByLabelText('Password'),{target:{value:'example-password'}});
  fireEvent.submit(screen.getByLabelText('Password').closest('form')!);
  expect(await screen.findByText('Too many sign-in attempts. Wait a minute and try again.')).toBeTruthy();
});

// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { TeamsAdmin } from './TeamsAdmin';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('prevents repeated moderation requests while the first is pending',async()=>{
  let finish!: (response:Response)=>void;
  const fetch=vi.fn().mockResolvedValueOnce(Response.json({teams:[{id:'t',name:'Team',memberCount:1,isBanned:true,hidden:false,createdAt:1000}],total:1})).mockImplementationOnce(()=>new Promise<Response>((resolve)=>{finish=resolve;}));
  vi.stubGlobal('fetch',fetch);
  render(<TeamsAdmin/>);
  const restore=await screen.findByRole('button',{name:'Restore'});
  fireEvent.click(restore);fireEvent.click(restore);
  expect(fetch.mock.calls.filter(([,init])=>init?.method==='PATCH')).toHaveLength(1);
  finish(Response.json({error:'Try again'},{status:503}));
  expect((await screen.findByRole('alert')).textContent).toContain('Try again');
});

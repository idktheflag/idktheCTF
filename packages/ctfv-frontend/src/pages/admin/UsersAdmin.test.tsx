// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { UsersAdmin } from './UsersAdmin';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('prevents repeated moderation requests while the first is pending',async()=>{
  let finish!: (response:Response)=>void;
  const fetch=vi.fn().mockResolvedValueOnce(Response.json({users:[{id:'u',username:'Player',email:'p@example.test',teamName:null,isAdmin:false,isBanned:true,emailVerified:true}],total:1})).mockImplementationOnce(()=>new Promise<Response>((resolve)=>{finish=resolve;}));
  vi.stubGlobal('fetch',fetch);
  render(<UsersAdmin/>);
  const restore=await screen.findByRole('button',{name:'Restore'});
  fireEvent.click(restore);fireEvent.click(restore);
  expect(fetch.mock.calls.filter(([,init])=>init?.method==='PATCH')).toHaveLength(1);
  finish(Response.json({error:'Try again'},{status:503}));
  expect((await screen.findByRole('alert')).textContent).toContain('Try again');
});
it('lets the account owner promote a participant to organizer',async()=>{
  const user={id:'u',username:'Player',email:'p@example.test',teamName:null,isAdmin:false,isBanned:false,emailVerified:true,isOwner:false};
  const updated={...user,isAdmin:true};
  const fetch=vi.fn()
    .mockResolvedValueOnce(Response.json({users:[user],total:1,canManageRoles:true}))
    .mockResolvedValueOnce(Response.json({updated:true,isAdmin:true}))
    .mockResolvedValueOnce(Response.json({users:[updated],total:1,canManageRoles:true}));
  vi.stubGlobal('fetch',fetch);vi.stubGlobal('confirm',vi.fn(()=>true));
  render(<UsersAdmin/>);
  fireEvent.click(await screen.findByRole('button',{name:'Make organizer'}));
  expect(await screen.findByRole('button',{name:'Remove organizer'})).toBeTruthy();
  const roleRequest=fetch.mock.calls.find(([url,init])=>String(url).includes('/role')&&init?.method==='PATCH');
  expect(roleRequest?.[1]?.body).toBe(JSON.stringify({isAdmin:true}));
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContentAdmin } from './ContentAdmin';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('prevents duplicate publishes while a save is pending',async()=>{
  let finish!: (response:Response)=>void;
  const fetch=vi.fn().mockResolvedValueOnce(Response.json({announcements:[]})).mockResolvedValueOnce(Response.json({pages:[]})).mockImplementationOnce(()=>new Promise<Response>((resolve)=>{finish=resolve;}));
  vi.stubGlobal('fetch',fetch);
  render(<ContentAdmin/>);
  await act(async()=>{});
  fireEvent.change(screen.getByPlaceholderText('Title'),{target:{value:'Draft title'}});
  fireEvent.change(screen.getByPlaceholderText('Markdown content'),{target:{value:'Draft body'}});
  const publish=screen.getByRole('button',{name:'Publish announcement'});
  fireEvent.click(publish);
  fireEvent.click(publish);
  expect(fetch.mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(1);
  await act(async()=>finish(Response.json({error:'Please retry'},{status:503})));
  expect(screen.getByRole('alert').textContent).toContain('Please retry');
  expect((screen.getByPlaceholderText('Title') as HTMLInputElement).value).toBe('Draft title');
});
it('reports a rejected save and preserves the draft for retry',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({announcements:[]})).mockResolvedValueOnce(Response.json({pages:[]})).mockRejectedValueOnce(new Error('Network unavailable')));
  render(<ContentAdmin/>);
  await act(async()=>{});
  fireEvent.change(screen.getByPlaceholderText('Title'),{target:{value:'Keep this draft'}});
  fireEvent.click(screen.getByRole('button',{name:'Publish announcement'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Network unavailable');
  expect((screen.getByPlaceholderText('Title') as HTMLInputElement).value).toBe('Keep this draft');
  expect((screen.getByPlaceholderText('Title') as HTMLInputElement).disabled).toBe(false);
});

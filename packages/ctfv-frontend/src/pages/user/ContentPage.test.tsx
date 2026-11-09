// @vitest-environment jsdom
import {act,cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter,Route,Routes,useNavigate} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
import {ContentPage} from './ContentPage';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('renders markdown without executing raw HTML or retaining javascript links',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({page:{title:'Safety check',body:'<script>window.bad=true</script>\n\n[Unsafe](javascript:alert%281%29)\n\n**Normal text**'}})));
  const {container}=render(<MemoryRouter initialEntries={['/pages/test']}><Routes><Route path='/pages/:slug' element={<ContentPage/>}/></Routes></MemoryRouter>);
  expect(await screen.findByRole('heading',{name:'Safety check'})).toBeTruthy();
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('a')?.getAttribute('href')||'').not.toMatch(/^javascript:/i);
  expect(screen.getByText('Normal text').tagName).toBe('STRONG');
});
it('recovers when navigating from an unavailable page to a valid page',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({error:'Page unavailable'},{status:404})).mockResolvedValueOnce(Response.json({page:{title:'Available page',body:'Content'}})));
  let navigate!:ReturnType<typeof useNavigate>;
  function Navigation(){navigate=useNavigate();return null;}
  render(<MemoryRouter initialEntries={['/pages/old']}><Navigation/><Routes><Route path='/pages/:slug' element={<ContentPage/>}/></Routes></MemoryRouter>);
  expect(await screen.findByText('Page unavailable')).toBeTruthy();
  await act(async()=>navigate('/pages/new'));
  expect(await screen.findByRole('heading',{name:'Available page'})).toBeTruthy();
});

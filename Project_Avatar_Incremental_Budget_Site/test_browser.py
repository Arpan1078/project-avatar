
import json,threading
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
checks=[]
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(Path('.').resolve())))
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}'
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True)
  page=browser.new_page(viewport={'width':1400,'height':1000},accept_downloads=True)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  page.goto(url+'/index.html')
  page.wait_for_selector('#total')
  assert page.locator('#error').inner_text()==''
  assert '7,728' in page.locator('#total').inner_text()
  checks.append('Reduced incremental default total renders')
  assert page.locator('.projectLogo img').evaluate('(i)=>i.complete&&i.naturalWidth>0')
  assert page.locator('.projectLogo').get_attribute('href')=='index.html'
  checks.append('Supplied Project Avatar artwork loads and links to index')
  page.locator('footer').scroll_into_view_if_needed()
  assert page.locator('footer img').evaluate('(i)=>i.complete&&i.naturalWidth>0')
  assert page.locator('footer a').get_attribute('href')=='https://github.com/Arpan1078/project-avatar'
  checks.append('Supplied Team Firebenders artwork links to repository')
  assert 'Works offline' not in page.locator('body').inner_text()
  assert 'Page-link fragments' not in page.locator('body').inner_text()
  checks.append('Requested unnecessary footer copy removed')
  assert page.evaluate('state.prices.appHours')==0 and page.evaluate('state.prices.support')==0
  checks.append('App completion and recurring support default zero')
  page.locator('#theme').select_option('dark')
  assert page.locator('html').get_attribute('data-theme')=='dark'
  checks.append('Dark mode works with branding')
  page.locator('nav a[href="catalogue.html"]').click()
  page.wait_for_selector('#prices .item')
  assert page.locator('html').get_attribute('data-theme')=='dark'
  page.locator('#drone_autel').fill('5500')
  page.locator('.projectLogo').click()
  page.wait_for_selector('#total')
  assert page.evaluate('state.dronePrices.autel')==5500
  checks.append('Logo returns to index; edited prices persist without URL payload')
  page.locator('summary').filter(has_text='Water sources & extra access equipment').click()
  before=page.locator('#total').inner_text()
  page.locator('#f_water').select_option('river')
  assert page.locator('#total').inner_text()==before
  assert page.evaluate('last.unconfirmed.some(t=>t.includes("Natural water"))')
  checks.append('Rivers accepted without invented water purchase; access flag shown')
  page.locator('summary').filter(has_text='Extra consumables only').click()
  assert not page.evaluate('last.rows.some(r=>r.category==="Extra consumables")')
  checks.append('Existing supplies excluded')
  page.locator('summary').filter(has_text='Agricultural pilots & aircraft').click()
  page.locator('#agMode').select_option('volunteer')
  page.locator('#f_agHours').fill('10')
  assert page.evaluate('last.rows.some(r=>r.label.startsWith("Aircraft operating EXPENSE"))')
  assert page.evaluate('last.otherWages')==0
  checks.append('Volunteer-pilot expense reimbursement does not add wages')
  page.locator('[data-field="aviationCovered"]').check()
  assert page.evaluate('last.unconfirmed.some(t=>t.includes("UNCONFIRMED donor"))')
  checks.append('Unconfirmed full donation remains flagged')
  page.locator('[data-field="aviationConfirmed"]').check()
  assert not page.evaluate('last.rows.some(r=>r.category==="Aviation expenses")')
  checks.append('Confirmed fully donated flight expenses can be zero')
  page.locator('#f_aidExtra').fill('300')
  assert page.evaluate('last.rows.some(r=>r.category==="Mutual aid"&&r.amount===300)')
  checks.append('Only extra mutual-aid obligations are charged')
  page.locator('summary').filter(has_text='Add another extra system cost').click()
  page.locator('#addCustom').click()
  page.locator('[data-custom="0"][data-key="name"]').fill('New field adapter')
  page.locator('[data-custom="0"][data-key="price"]').fill('100')
  assert 'New field adapter' in page.locator('#lineItems').text_content()
  checks.append('Custom incremental cost works')
  with page.expect_download() as d:page.locator('#save').click()
  dest=Path('roundtrip_v4.json');d.value.save_as(dest)
  with page.expect_download() as d:page.locator('#csv').click()
  f=Path('incremental_budget.csv');d.value.save_as(f)
  assert 'Responder wages' in f.read_text(encoding='utf-8-sig')
  checks.append('JSON and CSV exports work')
  page.locator('#preset').select_option('village')
  page.locator('#load').set_input_files(dest.resolve())
  assert page.evaluate('state.custom[0].name')=='New field adapter'
  checks.append('JSON reload preserves extra cost')
  page.locator('#theme').select_option('light')
  assert page.locator('html').get_attribute('data-theme')=='light'
  page.set_viewport_size({'width':390,'height':844})
  assert page.locator('#total').is_visible()
  assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
  checks.append('Light mode and mobile layout work')
  page.emulate_media(media='print')
  assert page.locator('.controls').is_hidden()
  checks.append('Print hides setup controls')
  assert not errors,errors
  checks.append('No uncaught JavaScript errors')
  browser.close()
finally:server.shutdown()
print(json.dumps({'passed':len(checks),'checks':checks},indent=2))

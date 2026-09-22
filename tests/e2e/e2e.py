"""
Test de bout en bout dans un vrai Chromium (optionnel).
Prérequis : pip install playwright && playwright install chromium
Lancement : python tests/e2e/e2e.py

Vérifie les deux chemins critiques :
  1. export blob révoqué immédiatement après le clic (hook MAIN world)
  2. export http relu par le service worker, encodé en Windows-1252
"""
import asyncio, functools, http.server, json, os, shutil, sys, tempfile, threading, urllib.parse
from playwright.async_api import async_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8766
EXPECTED = {
    'blob': 'id;label;amount;date\n001;Widget, large;1234,50;15/03/2024\n002;Gadget;12,5;01/04/2024\n',
    'http': 'name;value;when\nalpha;12345,6;31/01/2024 10:00:00\nbeta;7,25;01/02/2024 11:30:00\n',
    # la colonne PERIODE contient une date impossible : elle reste intacte, par sécurité
}
EXPECTED_APEX = 'SOCIETE;PERIODE;MONTANT\nACME_FR;30-JUN-2026;1234567,89\nACME_DE;31-FEB-2026;-42,5\n'
APEX_MODES = ['location', 'redirect', 'open', 'iframe-attr', 'iframe-html', 'iframe-jquery']
APEX_FILES = {}
APEX_GET_HITS = []
APEX_CSV = 'SOCIETE,PERIODE,MONTANT\nACME_FR,30-JUN-2026,"1,234,567.89"\nACME_DE,31-FEB-2026,-42.5\n'

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/apex/wwv_flow.ajax':
            self.rfile.read(int(self.headers.get('Content-Length') or 0))
            file_id = str(132512409061323997 + len(APEX_FILES))
            APEX_FILES[file_id] = APEX_CSV.encode('utf-8')
            body = json.dumps({'regions': [{'id': '48715', 'download': {'id': file_id}}]}).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        self.send_error(404)

    def do_GET(self):
        if self.path.startswith('/apex/wwv_flow.ajax'):
            APEX_GET_HITS.append(self.path)
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            file_id = json.loads(q['p_json'][0])['regions'][0]['downloadFileId']
            body = APEX_FILES.pop(file_id, None)  # servi une seule fois, comme APEX
            if body is None:
                page = b'<HTML><TITLE>404 Not found</TITLE><H1>Not found</H1></HTML>'
                self.send_response(404); self.send_header('Content-Type', 'text/html')
                self.send_header('Content-Length', str(len(page))); self.end_headers(); self.wfile.write(page)
                return
            self.send_response(200); self.send_header('Content-Type', 'text/csv')
            self.send_header('Content-Disposition', 'attachment; filename="rapport_scenario.csv"')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        if self.path.startswith('/app/export.csv'):
            body = 'name,value,when\nalpha,"12,345.6",2024-01-31T10:00:00\nbeta,7.25,2024-02-01T11:30:00\n'.encode('cp1252')
            self.send_response(200)
            self.send_header('Content-Type', 'text/csv')
            self.send_header('Content-Disposition', 'attachment; filename="report_http.csv"')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()
    def log_message(self, *a): pass

def prepare_extension(tmp):
    ext = os.path.join(tmp, 'ext')
    shutil.copytree(ROOT, ext, ignore=shutil.ignore_patterns('tests', 'node_modules', '.git'))
    with open(os.path.join(ext, 'manifest.json'), encoding='utf-8') as f:
        m = json.load(f)
    m['host_permissions'] = ['http://localhost/*']  # évite la demande interactive
    with open(os.path.join(ext, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(m, f, ensure_ascii=False, indent=2)
    return ext

async def main():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=os.path.join(HERE, 'site')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    tmp = tempfile.mkdtemp()
    ext, dl = prepare_extension(tmp), os.path.join(tmp, 'dl')
    os.makedirs(dl)
    failures = 0
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            os.path.join(tmp, 'profile'), channel='chromium', headless=True, accept_downloads=True, downloads_path=dl,
            args=[f'--disable-extensions-except={ext}', f'--load-extension={ext}'])
        for _ in range(50):
            sws = [w for w in ctx.service_workers if w.url.endswith('/src/background.js')]
            if sws: break
            await asyncio.sleep(0.2)
        await asyncio.sleep(1)
        sw = sws[0]
        # Onglet ouvert AVANT la configuration : doit être couvert sans rechargement
        preopened = await ctx.new_page()
        await preopened.goto(f'http://localhost:{PORT}/apex/index.html')
        await sw.evaluate("""chrome.storage.sync.set({settings: {
            urlPrefixes: ['http://localhost:%d/app/', 'http://localhost:%d/apex/'], notify: false, targetMode: 'manual',
            manualTarget: {delimiter: ';', decimal: ',', dateFormat: 'DD/MM/YYYY'}, timezone: 'wallclock'}})""" % (PORT, PORT))
        await asyncio.sleep(1)
        await asyncio.sleep(1.5)
        before = len(APEX_GET_HITS)
        await preopened.click('#location'); await asyncio.sleep(2.5)
        preopened_hits = len(APEX_GET_HITS) - before
        tab_badges = json.loads(await sw.evaluate("chrome.tabs.query({}).then(ts => Promise.all(ts.filter(t => (t.url||'').includes('/apex/')).map(t => chrome.action.getBadgeText({tabId: t.id})))).then(JSON.stringify)"))
        await preopened.close()
        page = await ctx.new_page()
        await page.goto(f'http://localhost:{PORT}/app/index.html')
        await page.click('#blob'); await asyncio.sleep(3)
        await page.click('#http'); await asyncio.sleep(3)
        names = []
        apex = await ctx.new_page()
        apex.on('download', lambda d: names.append(d.suggested_filename))
        if os.environ.get('E2E_VERBOSE'):
            apex.on('console', lambda m: print('   console:', m.text[:160]))
        await apex.goto(f'http://localhost:{PORT}/apex/index.html')
        await asyncio.sleep(0.5)
        hits_by_mode = {}
        for mode in APEX_MODES + ['form-blank']:
            await apex.goto(f'http://localhost:{PORT}/apex/index.html')  # page fraîche par mécanisme
            before = len(APEX_GET_HITS)
            await apex.click('#' + mode)
            await asyncio.sleep(2.5)
            hits_by_mode[mode] = len(APEX_GET_HITS) - before
            if os.environ.get('E2E_VERBOSE'):
                print('   --', mode, hits_by_mode[mode])
        history = json.loads(await sw.evaluate("chrome.storage.local.get('history').then(h => JSON.stringify(h.history || []))"))
        items = json.loads(await sw.evaluate("chrome.downloads.search({}).then(d => JSON.stringify(d.map(x => ({f: x.filename, ext: !!x.byExtensionId}))))"))
        outputs = []
        for it in items:
            if it['ext']:
                with open(it['f'], 'rb') as f:
                    raw = f.read()
                assert raw.startswith(b'\xef\xbb\xbf'), 'BOM UTF-8 manquant'
                outputs.append(raw[3:].decode('utf-8'))
        for name, expected in EXPECTED.items():
            ok = expected in outputs
            failures += not ok
            print(('OK   ' if ok else 'FAIL ') + name)
        ok = preopened_hits == 1
        failures += not ok
        print(('OK   ' if ok else 'FAIL ') + f'onglet ouvert avant configuration, sans F5 : {preopened_hits} requête(s)')
        ok = 'ON' in tab_badges
        failures += not ok
        print(('OK   ' if ok else 'FAIL ') + f'badge d’état : {tab_badges}')
        converted = sum(1 for o in outputs if o == EXPECTED_APEX)
        ok = converted == len(APEX_MODES) + 1
        failures += not ok
        print(('OK   ' if ok else 'FAIL ') + f'apex : {converted}/{len(APEX_MODES) + 1} copies converties')
        for mode, hits in hits_by_mode.items():
            ok = hits == 1
            failures += not ok
            print(('OK   ' if ok else 'FAIL ') + f'apex {mode} : {hits} requête(s) au fichier')
        ok = names.count('rapport_scenario.csv') >= len(APEX_MODES)
        failures += not ok
        print(('OK   ' if ok else 'FAIL ') + f'apex : nom d’origine conservé ({names.count("rapport_scenario.csv")})')
        diag = [h for h in history if h.get('diagnostic')]
        ok = bool(diag) and any(f.get('version') for f in diag[0]['diagnostic']['frames'])
        failures += not ok
        print(('OK   ' if ok else 'FAIL ') + 'mécanisme non couvert (form _blank) : diagnostic produit')
        for h in history:
            print('     ', h['status'], '|', h['message'][:150])
        await ctx.close()
    server.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(1 if failures else 0)

asyncio.run(main())

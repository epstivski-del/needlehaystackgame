"""Browser end-to-end tests (headless Chromium) against the real server.
Three.js is replaced by a no-op stub (the sandbox cannot download it), so this verifies UI, networking, controller, HUD,
practice mode and multiplayer flows — NOT actual 3D pixels."""
import json, subprocess, sys, time, urllib.request, os, atexit
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 3200
BASE = f"http://127.0.0.1:{PORT}"
results = []

def dbg(path, **q):
    qs = "&".join(f"{k}={v}" for k, v in q.items())
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT+1}{path}?{qs}", timeout=5) as r:
        return json.loads(r.read())

def check(name, fn):
    try:
        fn(); results.append(("PASS", name, ""))
    except Exception as e:
        results.append(("FAIL", name, f"{type(e).__name__}: {e}"))

INIT = """
window.__fakeLock = false;
Object.defineProperty(Document.prototype, 'pointerLockElement', { get() { return window.__fakeLock ? document.getElementById('game') : null; } });
HTMLCanvasElement.prototype.requestPointerLock = function () { window.__fakeLock = true; document.dispatchEvent(new Event('pointerlockchange')); };
Document.prototype.exitPointerLock = function () { window.__fakeLock = false; document.dispatchEvent(new Event('pointerlockchange')); };
"""

def new_page(ctx, errors, label):
    pg = ctx.new_page()
    pg.add_init_script(INIT)
    pg.on("pageerror", lambda e: errors.append(f"[{label}] pageerror: {e}"))
    pg.on("console", lambda m: errors.append(f"[{label}] console.error: {m.text}") if m.type == "error" else None)
    pg.route("**/vendor/three.module.js", lambda r: r.fulfill(path=os.path.join(ROOT, "three-stub.module.js"), content_type="text/javascript"))
    return pg

def S(pg, expr):
    return pg.evaluate(f"(() => {{ const n = window.__flock; return ({expr}); }})()")

def wait_for(pg, expr, timeout=8000, label=None):
    try:
        pg.wait_for_function(f"(() => {{ try {{ const n = window.__flock; return !!n && !!({expr}); }} catch (e) {{ return false; }} }})()", timeout=timeout)
    except Exception:
        raise AssertionError(f"timeout waiting for {label or expr}")

def tap(pg, code, hold=0):
    pg.keyboard.down(code)
    if hold: time.sleep(hold)
    pg.keyboard.up(code)

def local_room(pg):  # practice mode: the engine runs inside the page
    return "[...n.S.net.hub.rooms.values()][0]"

def _dump():
    for st, n, e in results: print(("  ✓ " if st == "PASS" else "  ✗ ") + n + (f"\n      {e}" if e else ""))
    print(f"\nbrowser tests: {sum(1 for r in results if r[0]=='PASS')} passed, {sum(1 for r in results if r[0]=='FAIL')} failed")
atexit.register(_dump)

server = subprocess.Popen(["node", os.path.join(ROOT, "harness.js")], env={**os.environ, "PORT": str(PORT)}, stdout=subprocess.PIPE, text=True)
assert "READY" in server.stdout.readline()
errors = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])

        # ---------------------------------------------------------------- menu
        ctx = browser.new_context(viewport={"width": 1280, "height": 720}); pg = new_page(ctx, errors, "solo")
        pg.goto(BASE); wait_for(pg, "document.body.dataset.screen === 'menu'", 10000, "menu screen")
        def t_menu():
            assert pg.locator("text=Play Online").count() == 1
            for t in ["Create Private Room", "Join Room", "Practice Mode", "Settings", "How to Play"]: assert pg.locator(f"button:has-text('{t}')").count() >= 1, t
            assert pg.locator(".logo svg").count() == 1 and "FLOCK" in pg.locator(".logoTxt").inner_text()
            assert pg.title() == "Flock Rush"
        check("main menu loads with all required entries and the Flock Rush logo", t_menu)
        pg.screenshot(path=os.path.join(ROOT, "shot-menu.png"))

        def t_settings():
            pg.click("button:has-text('Settings')"); pg.wait_for_selector("#settingsModal")
            for label in ["Mouse sensitivity", "Master volume", "Music volume", "Effects volume", "Reduced camera shake", "Reduced flashing", "UI scale", "Graphics quality"]:
                assert pg.locator(f"#settingsModal :text('{label}')").count() >= 1, label
            pg.click("#settingsModal button:has-text('Done')")
        check("settings screen exposes all accessibility/audio/graphics options", t_settings)
        def t_howto():
            pg.click("button:has-text('How to Play')"); pg.wait_for_selector("text=Winning"); assert pg.locator(".modal :text('bark')").count() >= 1
            pg.click(".modal button:has-text('Got it')")
        check("how-to-play screen explains the game and closes", t_howto)

        # ---------------------------------------------------------------- practice mode (offline engine, no network)
        pg.fill("#nameIn", "Solo"); pg.click("button:has-text('Practice Mode')"); pg.wait_for_selector(".modal button:has-text('Start')"); pg.click(".modal button:has-text('Start')")
        wait_for(pg, "n.S.inGame && n.S.phase === 'countdown'", 8000, "practice countdown")
        check("practice starts without any server room (local engine)", lambda: (_ for _ in ()).throw(AssertionError("server saw a room")) if dbg("/players", code=S(pg, "n.S.code")).get("err") != "noroom" else None)
        wait_for(pg, "n.S.phase === 'playing'", 8000, "practice playing")
        def t_hud():
            for sel in ["#hudTimer", "#hudName", "#hudPen", "#hudHerded", "#hudSteals", "#hudObj", "#abBark", "#abDash", "#abHowl", "#stamFill", "#mini", "#scoreboard"]: assert pg.locator(sel).count() == 1, sel
            assert pg.locator("#hudName").inner_text().startswith("Solo")
            assert pg.locator("#hudTimer").inner_text() != "0:00"
        check("HUD shows timer, name, pen score, objective, ability bar, stamina, minimap and scoreboard", t_hud)
        pg.click("#pause button:has-text('Into the field')")
        wait_for(pg, "document.pointerLockElement", 3000, "pointer lock")

        def t_field():
            f = S(pg, "n.S.field"); assert len(f["pens"]) == 1 and len(f["sheep"]) >= 18 and len(f["solids"]) > 8
        check("the field is rebuilt on the client from the server's seed (pen, sheep, obstacles)", t_field)
        def t_move():
            x0, z0 = S(pg, "[n.L.x, n.L.z]")
            tap(pg, "KeyW", 0.8)
            x1, z1 = S(pg, "[n.L.x, n.L.z]"); moved = ((x1-x0)**2 + (z1-z0)**2) ** .5
            assert moved > 2.5, f"moved only {moved:.2f}"
            time.sleep(0.3); a = S(pg, "[n.L.x, n.L.z]"); pg.keyboard.down("Shift"); tap(pg, "KeyW", 0.8); pg.keyboard.up("Shift"); b = S(pg, "[n.L.x, n.L.z]")
            sprint = ((b[0]-a[0])**2 + (b[1]-a[1])**2) ** .5
            assert sprint > moved * 1.1, f"sprint {sprint:.2f} vs walk {moved:.2f}"
            assert S(pg, "n.L.stamina") < 100
        check("WASD moves the dog; Shift sprints faster and drains stamina", t_move)
        def t_look():
            y0 = S(pg, "n.L.camYaw")
            pg.evaluate("document.dispatchEvent(new MouseEvent('mousemove', {movementX: 120, movementY: 60}))")
            assert abs(S(pg, "n.L.camYaw") - y0) > 0.1
        check("mouse look rotates the camera (with sensitivity applied)", t_look)
        def t_dir():
            pg.evaluate("window.__flock.L.camYaw = 0"); y0 = S(pg, "[n.L.x, n.L.z]"); tap(pg, "KeyD", 0.5); y1 = S(pg, "[n.L.x, n.L.z]")
            assert y1[0] > y0[0] + 1.0, f"D should move right (+x) for a camera at yaw 0: {y0} -> {y1}"
        check("movement is relative to the camera (D runs right)", t_dir)
        def t_collide():
            f = S(pg, "n.S.field"); s = [s for s in f["solids"] if s["kind"] == "bale"][0]
            pg.evaluate(f"(() => {{ const n = window.__flock; n.L.x = {s['minX'] - 2.0}; n.L.z = {s['cz']}; n.L.vx = n.L.vz = 0; n.L.camYaw = -Math.PI / 2; const pl = n.S.net.conn.player; pl.pos.x = n.L.x; pl.pos.z = n.L.z; pl.pos.t = Date.now(); }})()")
            pg.keyboard.down("KeyW"); time.sleep(1.2); pg.keyboard.up("KeyW")
            x = S(pg, "n.L.x"); assert x <= s["minX"] - 0.3, f"walked into the bale: x={x:.2f} minX={s['minX']:.2f}"
        check("collision: the dog cannot walk through hay bales", t_collide)
        def t_bounds():
            half = S(pg, "n.S.field.half")
            pg.evaluate("(() => { const n = window.__flock; n.L.x = 9999; n.L.z = -9999; })()"); time.sleep(0.25)
            x, z = S(pg, "[n.L.x, n.L.z]"); assert abs(x) < half and abs(z) < half, (x, z)
        check("arena boundary clamps positions outside the field", t_bounds)

        def t_bark():
            pg.evaluate("(() => { const n = window.__flock, r = " + local_room(pg).replace("n.", "n.") + "; n.L.x = 0; n.L.z = 0; n.L.vx = n.L.vz = 0; n.L.dogYaw = 0; const p = r.players.get(n.S.you); p.pos.x = 0; p.pos.z = 0; p.pos.yaw = 0; p.pos.t = Date.now(); const s = r.round.sim.sheep[2]; s.x = 0; s.z = -5; s.vx = s.vz = 0; })()")
            time.sleep(0.2); pg.evaluate("document.dispatchEvent(new MouseEvent('mousedown', {button: 0}))"); time.sleep(0.15)
            r = S(pg, "(() => { const r = " + local_room(pg) + "; const s = r.round.sim.sheep[2]; return [r.players.get(n.S.you).stats.barks, Math.hypot(s.vx, s.vz), s.z]; })()")
            assert r[0] == 1 and r[1] > 2.5, r
            cd = pg.evaluate("document.querySelector('#abBark .cd').style.height"); assert cd and float(cd.strip('%')) > 20, cd
            pg.evaluate("document.dispatchEvent(new MouseEvent('mousedown', {button: 0}))"); time.sleep(0.1)
            assert S(pg, "(() => " + local_room(pg) + ".players.get(n.S.you).stats.barks)()") == 1, "bark cooldown"
        check("clicking barks: server startles the sheep ahead, the cooldown shows and blocks a second bark", t_bark)
        def t_dash():
            time.sleep(3.6); pg.evaluate("window.__flock.L.camYaw = 0"); tap(pg, "KeyW", 0.2)
            x0, z0 = S(pg, "[n.L.x, n.L.z]"); tap(pg, "Space", 0.02); time.sleep(0.3); x1, z1 = S(pg, "[n.L.x, n.L.z]")
            assert ((x1-x0)**2 + (z1-z0)**2) ** .5 > 3.0, "dash covered too little ground"
            assert S(pg, "(() => " + local_room(pg) + ".players.get(n.S.you).stats.dashes)()") == 1
        check("Space dashes forward quickly and the server counts it", t_dash)
        def t_penned():
            room = local_room(pg); pg.evaluate("(() => { const n = window.__flock, r = " + room + ", pen = r.round.field.pens[0], s = r.round.sim.sheep[5]; s.x = pen.cx; s.z = pen.cz; s.vx = s.vz = 0; s.lastPush = n.S.you; s.lastPushT = r.round.sim.time; })()")
            wait_for(pg, "document.querySelector('#hudPen').textContent.startsWith('1 sheep')", 4000, "pen score on the HUD")
            assert pg.locator("#hudHerded").inner_text() == "1"
            assert pg.locator(".toast.good").count() >= 1
        check("a sheep driven into the pen is scored by the engine and shown on the HUD with a toast", t_penned)
        def t_pause():
            pg.evaluate("document.exitPointerLock()"); pg.wait_for_selector("#pause button:has-text('Resume')"); assert pg.locator("#pause button:has-text('Restart round')").count() == 1
            pg.click("#pause button:has-text('Resume')"); wait_for(pg, "document.pointerLockElement", 3000, "relock")
        check("Esc opens the pause menu and Resume recaptures the mouse", t_pause)
        pg.screenshot(path=os.path.join(ROOT, "shot-hud.png"))

        def t_win():
            room = local_room(pg); pg.evaluate("(() => { const n = window.__flock, r = " + room + ", pen = r.round.field.pens[0]; r.round.sim.sheep.forEach((s, i) => { s.x = pen.cx + ((i % 6) - 2.5) * 1.2; s.z = pen.cz + (Math.floor(i / 6) - 1) * 1.1; s.vx = s.vz = 0; s.lastPush = n.S.you; s.lastPushT = r.round.sim.time; }); })()")
            wait_for(pg, "document.body.dataset.screen === 'results'", 9000, "results screen")
            assert "FLOCK PENNED" in pg.locator(".resCard h1").inner_text()
            assert pg.locator(".resTable tbody tr").count() == 1 and pg.locator("button:has-text('Play Again')").count() == 1
        check("penning the whole flock wins the practice round and shows the results screen", t_win)
        pg.screenshot(path=os.path.join(ROOT, "shot-results.png"))
        def t_again():
            pg.click("button:has-text('Play Again')"); wait_for(pg, "n.S.inGame && ['countdown','playing'].includes(n.S.phase)", 8000, "second practice round")
        check("Play Again starts a fresh practice round", t_again)
        def t_quit():
            pg.click("#pause button:has-text('Quit to menu')"); wait_for(pg, "document.body.dataset.screen === 'menu'", 4000, "menu")
        check("Quit returns to the menu", t_quit)
        ctx.close()

        # ---------------------------------------------------------------- multiplayer: two independent browsers
        hctx = browser.new_context(viewport={"width": 1280, "height": 720}); gctx = browser.new_context(viewport={"width": 1280, "height": 720})
        host = new_page(hctx, errors, "host"); guest = new_page(gctx, errors, "guest")
        host.goto(BASE); wait_for(host, "document.body.dataset.screen === 'menu'", 10000, "host menu")
        host.fill("#nameIn", "Alice"); host.click("button:has-text('Create Private Room')")
        wait_for(host, "document.body.dataset.screen === 'lobby'", 8000, "host lobby")
        code = S(host, "n.S.code")
        def t_lobby():
            assert len(code) == 5 and host.locator(".code").inner_text() == code
            assert f"/r/{code}" in host.locator(".inviteLink input").input_value()
            for t in ["Roundup", "Team Roundup", "Stampede"]: assert host.locator(f".modeCard:has-text('{t}')").count() >= 1, t
        check("host creates a private room with a 5-character code, invite link and three modes", t_lobby)

        guest.goto(f"{BASE}/r/{code}"); guest.wait_for_selector("#nameIn"); guest.fill("#nameIn", "Bob"); guest.click("button:has-text('Join Game')")
        wait_for(guest, "document.body.dataset.screen === 'lobby'", 8000, "guest lobby")
        wait_for(host, "n.S.room && n.S.room.players.length === 2", 5000, "host sees guest")
        def t_join():
            names = sorted(x["name"] for x in S(guest, "n.S.room.players")); assert names == ["Alice", "Bob"], names
            assert guest.locator("button:has-text('Start Match')").count() == 0 and guest.locator("button:has-text('Ready')").count() >= 1
        check("a friend joins through the invite link; guest sees Ready (not Start), both see both players", t_join)
        host.screenshot(path=os.path.join(ROOT, "shot-lobby.png"))
        def t_notready():
            host.click("button:has-text('Start Match')"); host.wait_for_selector(".toast.bad:has-text('ready up')", timeout=3000)
        check("host cannot start until the guest is ready", t_notready)
        dbg("/settings", code=code, duration=14)
        guest.click("button:has-text('Ready')"); time.sleep(0.4); host.click("button:has-text('Start Match')")
        wait_for(host, "n.S.inGame && n.S.round", 8000, "host in game"); wait_for(guest, "n.S.inGame && n.S.round", 8000, "guest in game")
        def t_same():
            a, b = S(host, "n.S.round.seed"), S(guest, "n.S.round.seed"); assert a == b
            sa, sb = S(host, "n.S.round.you.slot"), S(guest, "n.S.round.you.slot"); assert sa != sb and sa >= 0 and sb >= 0
            assert S(host, "n.S.field.pens.length") == 2 and S(guest, "n.S.field.sheep.length") == S(host, "n.S.field.sheep.length")
        check("both browsers start the same round: same seed, same field, different pens", t_same)
        host.click("#pause button:has-text('Into the field')"); guest.click("#pause button:has-text('Into the field')")
        wait_for(host, "n.S.phase === 'playing'", 8000, "playing"); wait_for(guest, "n.S.phase === 'playing'", 8000, "guest playing")
        def t_sync():
            tap(host, "KeyW", 0.9)
            wait_for(guest, "n.remotes.size >= 1 && [...n.remotes.values()][0].last", 5000, "guest sees host dog")
            hx, hz = S(host, "[n.L.x, n.L.z]"); r = S(guest, "(() => { const r = [...n.remotes.values()][0].last; return [r.x, r.z]; })()")
            assert abs(r[0] - hx) < 3 and abs(r[1] - hz) < 3, (hx, hz, r)
        check("movement is synchronised: the guest sees the host's dog where the host ran", t_sync)
        def t_server_state():
            st = dbg("/state", code=code); assert st["phase"] == "playing" and len(st["pens"]) == 2 and st["sheep"] >= 18
            pl = dbg("/players", code=code); assert len(pl) == 2 and all(p["connected"] for p in pl)
        check("the server holds the authoritative round state for both players", t_server_state)
        host.evaluate("document.dispatchEvent(new MouseEvent('mousedown', {button: 0}))"); time.sleep(0.4)
        check("bark is counted on the server for the host only", lambda: (lambda pl: None if [p["barks"] for p in sorted(pl, key=lambda x: x["id"])] == [1, 0] else (_ for _ in ()).throw(AssertionError(pl)))(dbg("/players", code=code)))
        hslot = S(host, "n.S.round.you.slot"); hid = S(host, "n.S.you")
        dbg("/pen", code=code, slot=hslot, n=6, by=hid)
        def t_scores():
            wait_for(host, "n.S.scores.pens.some(p => p[1] >= 6)", 5000, "host sees scores"); wait_for(guest, "n.S.scores.pens.some(p => p[1] >= 6)", 5000, "guest sees scores")
            assert host.locator("#hudPens .pr").count() == 2
            ph = S(host, "n.S.scores.pens.slice().sort()"); pgs = S(guest, "n.S.scores.pens.slice().sort()"); assert ph == pgs, (ph, pgs)
        check("pen scores update live on both screens and agree", t_scores)
        def t_results():
            wait_for(host, "document.body.dataset.screen === 'results'", 25000, "host results"); wait_for(guest, "document.body.dataset.screen === 'results'", 15000, "guest results")
            th, tg = host.locator(".resCard h1").inner_text(), guest.locator(".resCard h1").inner_text()
            assert "YOU WIN" in th and "ALICE WINS" in tg, (th, tg)
            assert host.locator(".resTable tbody tr").count() == 2 and host.locator("button:has-text('Play Again')").count() == 1 and guest.locator("button:has-text('Waiting for host')").count() == 1
        check("the round ends on the server's timer; the dog with the most sheep wins on both screens", t_results)
        host.screenshot(path=os.path.join(ROOT, "shot-mp-results.png"))
        def t_again_mp():
            dbg("/settings", code=code, duration=60); host.click("button:has-text('Play Again')")
            wait_for(guest, "n.S.inGame && n.S.round && n.S.round.id === 2", 8000, "guest in round 2"); wait_for(host, "n.S.round.id === 2", 8000, "host in round 2")
            assert S(host, "n.S.round.seed") == S(guest, "n.S.round.seed")
        check("host starts another round in the same room; both clients join without reconnecting", t_again_mp)
        def t_reload():
            guest.click("#pause button:has-text('Into the field')") if guest.locator("#pause").count() else None
            guest.reload(); wait_for(guest, "n.S.inGame && n.S.round && n.S.round.id === 2", 10000, "guest back in round 2")
            assert S(guest, "n.S.room.players.length") == 2 and S(guest, "n.S.round.you.slot") >= 0
            pl = dbg("/players", code=code); assert len(pl) == 2 and all(p["connected"] for p in pl)
        check("reloading the guest's tab reconnects to the same room and round with the same dog", t_reload)
        def t_leave():
            host.evaluate("document.exitPointerLock()") if host.locator("#pause").count() == 0 else None
            host.wait_for_selector("#pause button:has-text('Leave room')"); host.click("#pause button:has-text('Leave room')")
            wait_for(host, "document.body.dataset.screen === 'menu'", 4000, "host menu")
            wait_for(guest, "n.S.room && n.S.room.hostId === n.S.you", 6000, "guest becomes host")
        check("when the host leaves, the guest is promoted to host", t_leave)
        hctx.close(); gctx.close()

        # ---------------------------------------------------------------- narrow viewport (phone-sized menu must not overflow)
        mctx = browser.new_context(viewport={"width": 390, "height": 760}); mp = new_page(mctx, errors, "mobile")
        mp.goto(BASE); wait_for(mp, "document.body.dataset.screen === 'menu'", 10000, "mobile menu")
        def t_mobile():
            w = mp.evaluate("document.documentElement.scrollWidth"); assert w <= 392, f"horizontal overflow {w}px"
            assert mp.locator("button:has-text('Play Online')").is_visible()
        check("the menu fits a 390px-wide screen without horizontal scrolling", t_mobile)
        mp.screenshot(path=os.path.join(ROOT, "shot-mobile.png"))
        mctx.close()
        browser.close()
finally:
    server.terminate()
    check("no uncaught page errors or console errors during the whole run", lambda: (_ for _ in ()).throw(AssertionError("\n      ".join(errors[:6]))) if errors else None)
    sys.stdout.flush()

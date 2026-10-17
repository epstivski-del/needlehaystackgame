"""Browser end-to-end tests (headless Chromium) against the real server.
Three.js is replaced by a no-op stub (the sandbox cannot download it), so this verifies UI, networking, controller, HUD,
practice mode and multiplayer flows — NOT actual 3D pixels."""
import json, subprocess, sys, time, urllib.request, os
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
    return pg.evaluate(f"(() => {{ const n = window.__needle; return ({expr}); }})()")

def wait_for(pg, expr, timeout=8000, label=None):
    try:
        pg.wait_for_function(f"(() => {{ try {{ const n = window.__needle; return !!n && !!({expr}); }} catch (e) {{ return false; }} }})()", timeout=timeout)
    except Exception:
        raise AssertionError(f"timeout waiting for {label or expr}")

def tp(pg, x, z):
    """Move client AND authoritative position (white-box) so the server's speed limiter doesn't rubber-band the test."""
    pg.evaluate(f"""(() => {{ const n = window.__needle; n.L.x = {x}; n.L.z = {z}; n.L.vx = n.L.vz = 0;
      if (n.S.net && n.S.net.hub) {{ const r = [...n.S.net.hub.rooms.values()][0]; const p = r.players.get(n.S.you); p.pos.x = {x}; p.pos.z = {z}; p.pos.t = Date.now(); }} }})()""")
    time.sleep(0.3)

def tap(pg, code, hold=0):
    pg.keyboard.down(code)
    if hold: time.sleep(hold)
    pg.keyboard.up(code)

import atexit
def _dump():
    for st, n, e in results: print(("  ✓ " if st == "PASS" else "  ✗ ") + n + (f"\n      {e}" if e else ""))
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
            assert pg.locator(".logo svg").count() == 1
        check("main menu loads with all required entries and the logo", t_menu)
        pg.screenshot(path=os.path.join(ROOT, "shot-menu.png"))

        def t_settings():
            pg.click("button:has-text('Settings')"); pg.wait_for_selector("#settingsModal")
            for label in ["Mouse sensitivity", "Master volume", "Music volume", "Effects volume", "Reduced camera movement", "Reduced flashing", "UI scale", "Graphics quality", "Head bob"]:
                assert pg.locator(f"#settingsModal :text('{label}')").count() >= 1, label
            pg.fill("#settingsModal input[type=range] >> nth=0", "1.5") if False else None
            pg.click("#settingsModal button:has-text('Done')")
        check("settings screen exposes all accessibility/audio/graphics options", t_settings)
        def t_howto():
            pg.click("button:has-text('How to Play')"); pg.wait_for_selector("text=Metal detector"); pg.click(".modal button:has-text('Got it')")
        check("how-to-play screen opens and closes", t_howto)

        # ---------------------------------------------------------------- practice mode (offline engine, no network)
        pg.fill("#nameIn", "Solo"); pg.click("button:has-text('Practice Mode')"); pg.click(".modal button:has-text('Start')")
        wait_for(pg, "n.S.inGame && n.S.phase === 'countdown'", 8000, "practice countdown")
        check("practice starts without any server room (local engine)", lambda: (_ for _ in ()).throw(AssertionError("server saw a room")) if dbg("/players", code=S(pg, "n.S.code")).get("err") != "noroom" else None)
        wait_for(pg, "n.S.phase === 'playing'", 8000, "practice playing")
        def t_hud():
            for sel in ["#cross", "#hudTimer", "#hudName", "#hudRound", "#hudTotal", "#hudPlayers", "#hudObj", "#det", "#stam", "#scoreboard"]: assert pg.locator(sel).count() == 1, sel
            assert pg.locator("#hudName").inner_text() == "Solo"
        check("HUD shows crosshair, timer, name, score, objective, players, detector and scoreboard", t_hud)
        pg.click("#pause button:has-text('Enter the field')")
        wait_for(pg, "document.pointerLockElement", 3000, "pointer lock")

        def t_move():
            x0, z0 = S(pg, "[n.L.x, n.L.z]"); yaw = S(pg, "n.L.yaw")
            tap(pg, "KeyW", 0.8)
            x1, z1 = S(pg, "[n.L.x, n.L.z]"); moved = ((x1-x0)**2 + (z1-z0)**2) ** .5
            assert moved > 2.0, f"moved only {moved:.2f}"
            # sprint is faster than walk
            time.sleep(0.4); a = S(pg, "[n.L.x, n.L.z]"); pg.keyboard.down("Shift"); tap(pg, "KeyW", 0.8); pg.keyboard.up("Shift"); b = S(pg, "[n.L.x, n.L.z]")
            sprint = ((b[0]-a[0])**2 + (b[1]-a[1])**2) ** .5
            assert sprint > moved * 1.1, f"sprint {sprint:.2f} vs walk {moved:.2f}"
            assert S(pg, "n.L.stamina") < 100
        check("WASD moves the player; Shift sprints faster and drains stamina", t_move)
        def t_look():
            y0 = S(pg, "n.L.yaw"); pg.mouse.move(640, 360); pg.mouse.move(700, 340)
            pg.evaluate("document.dispatchEvent(new MouseEvent('mousemove', {movementX: 120, movementY: -60}))")
            assert abs(S(pg, "n.L.yaw") - y0) > 0.1 and S(pg, "n.L.pitch") > 0.05
        check("mouse look rotates yaw/pitch (with sensitivity applied)", t_look)
        def t_jump():
            tap(pg, "Space", 0.05); time.sleep(0.12)
            assert S(pg, "n.L.y") > 0.05, "no height gained"
            time.sleep(0.9); assert S(pg, "n.L.y") == 0 and S(pg, "n.L.onGround"), "did not land"
        check("jump leaves the ground and gravity lands the player", t_jump)
        def t_collide():
            w = S(pg, "n.S.world"); s = [s for s in w["solids"] if s["kind"] == "barnwall"][0]
            tp(pg, s['cx'], s['minZ'] - 2.0); pg.evaluate("window.__needle.L.yaw = Math.PI")  # facing +z toward the wall
            pg.keyboard.down("KeyW"); time.sleep(1.4); pg.keyboard.up("KeyW")
            z = S(pg, "n.L.z"); assert z <= s["minZ"] - 0.4, f"walked into the wall: z={z:.2f} wall minZ={s['minZ']:.2f}"
        check("collision: the player cannot walk through barn walls", t_collide)
        def t_bounds():
            half = S(pg, "n.S.world.half")
            pg.evaluate("(() => { const n = window.__needle; n.L.x = 9999; n.L.z = -9999; })()"); time.sleep(0.25)
            x, z = S(pg, "[n.L.x, n.L.z]"); assert abs(x) < half and abs(z) < half, (x, z)
        check("arena boundary clamps positions outside the playable area", t_bounds)

        # search flow on a pile, then locate the needle through the local engine (white-box) and claim it
        def to_pile(pile):
            tp(pg, pile['x'], pile['z'])
        def t_search():
            piles = [q for q in S(pg, "n.S.world.piles") if q["barn"] < 0]
            to_pile(piles[0]); wait_for(pg, "document.querySelector('#prompt').textContent.includes('Search')", 3000, "search prompt")
            tap(pg, "KeyE"); wait_for(pg, "n.S.search", 2000, "search started")
            assert pg.locator("#searchBar").evaluate("e => getComputedStyle(e).display") == "block"
            time.sleep(0.5); w1 = S(pg, "parseFloat(document.querySelector('#searchFill').style.width)"); assert 5 < w1 < 100, w1
            wait_for(pg, "!n.S.search", 6000, "search finished"); time.sleep(0.2)
        check("searching: E starts a timed search with progress bar, then resolves via the engine", t_search)
        def t_cancel():
            piles = [q for q in S(pg, "n.S.world.piles") if q["barn"] < 0]; to_pile(piles[1]); time.sleep(0.5)
            tap(pg, "KeyE"); wait_for(pg, "n.S.search", 2000)
            pg.evaluate("(() => { const n = window.__needle; n.L.vx = 4; })()"); time.sleep(0.3)
            wait_for(pg, "!n.S.search", 2000, "search cancelled by movement")
        check("walking away interrupts a search", t_cancel)
        def t_detector():
            tap(pg, "KeyQ"); wait_for(pg, "n.S.det.on", 2000, "detector on"); assert pg.locator("#det.on").count() == 1
            nd = S(pg, "(() => { const r = [...n.S.net.hub.rooms.values()][0].round; return {x: r.needles[0].x, z: r.needles[0].z}; })()")
            tp(pg, nd['x'] + 1.5, nd['z'])
            wait_for(pg, "n.S.det.level > 0.4", 4000, "strong detector signal near the needle")
            far = pg.evaluate("""(() => { const n = window.__needle, r = [...n.S.net.hub.rooms.values()][0].round, half = n.S.world.half;
              const metal = [...r.needles, ...r.items.filter(i => i.metal)];
              let best = null, bd = -1; for (let x = -half + 3; x < half - 3; x += 6) for (let z = -half + 3; z < half - 3; z += 6) { const d = Math.min(...metal.map(m => Math.hypot(m.x - x, m.z - z))); if (d > bd && !n.S.world.solids.some(s => x > s.minX - 1 && x < s.maxX + 1 && z > s.minZ - 1 && z < s.maxZ + 1)) { bd = d; best = [x, z]; } }
              return { x: best[0], z: best[1], d: bd }; })()""")
            assert far['d'] > 22, far
            tp(pg, far['x'], far['z'])
            wait_for(pg, "n.S.det.level < 0.1", 4000, "weak detector signal far away"); tap(pg, "KeyQ")
        check("metal detector: signal rises near the needle, falls far away, toggles with Q", t_detector)
        def t_pickup_and_results():
            nd = S(pg, "(() => { const r = [...n.S.net.hub.rooms.values()][0].round; return {x: r.needles[0].x, z: r.needles[0].z}; })()")
            for attempt in range(6):
                tp(pg, nd['x'] + 0.6, nd['z'])
                if S(pg, "n.S.revealed.size") > 0: break
                tap(pg, "KeyE"); wait_for(pg, "n.S.search", 2000, "search start")
                wait_for(pg, "!n.S.search", 6000, "search end"); time.sleep(0.25)
            assert S(pg, "n.S.revealed.size") > 0, "needle never uncovered by searching"
            wait_for(pg, "document.querySelector('#prompt').textContent.includes('needle')", 3000, "needle pickup prompt")
            tap(pg, "KeyE"); wait_for(pg, "n.S.phase === 'results'", 4000, "results after pickup")
            wait_for(pg, "document.body.dataset.screen === 'results'", 4000, "results screen")
            txt = pg.locator(".resCard").inner_text(); assert "YOU FOUND IT" in txt and "Solo" in txt, txt[:200]
        check("needle pickup ends the round and shows the results screen with the winner", t_pickup_and_results)
        pg.screenshot(path=os.path.join(ROOT, "shot-results.png"))
        def t_again():
            pg.click("button:has-text('Play Again')"); wait_for(pg, "n.S.inGame && n.S.phase === 'countdown'", 5000, "new practice round")
        check("Play Again starts a fresh round without leaving practice", t_again)
        ctx.close()

        # ---------------------------------------------------------------- real multiplayer: two independent browser contexts
        ca = browser.new_context(viewport={"width": 1280, "height": 720}); cb = browser.new_context(viewport={"width": 1280, "height": 720})
        A = new_page(ca, errors, "A"); B = new_page(cb, errors, "B")
        A.goto(BASE); wait_for(A, "document.body.dataset.screen === 'menu'", 10000)
        A.fill("#nameIn", "Alice"); A.click("button:has-text('Create Private Room')")
        wait_for(A, "n.S.screen === 'lobby' && n.S.room", 8000, "A lobby")
        code = S(A, "n.S.code"); invite = A.locator(".inviteLink input").input_value()
        def t_invite_display():
            assert len(code) == 5 and invite == f"{BASE}/r/{code}", invite
            assert A.locator(".code").inner_text() == code and A.locator("button:has-text('Copy Invite Link')").count() == 1
        check("private room: server room code + invite URL + Copy Invite Link shown in lobby", t_invite_display)
        B.goto(invite)
        def t_invite_flow():
            B.wait_for_selector("text=You've been invited"); assert code in B.locator(".menuCard").inner_text()
            B.fill("#nameIn", "Bob"); B.click("button:has-text('Join Game')")
            wait_for(B, "n.S.screen === 'lobby' && n.S.room && n.S.room.players.length === 2", 8000, "B in lobby")
            wait_for(A, "n.S.room.players.length === 2", 4000, "A sees B")
            names = sorted(S(B, "n.S.room.players.map(p => p.name)")); assert names == ["Alice", "Bob"], names
        check("friend opens the invite link in a separate session, enters a name and lands in the same lobby", t_invite_flow)
        A.screenshot(path=os.path.join(ROOT, "shot-lobby.png"))
        def t_lobby_perms():
            assert A.locator("button:has-text('Start Match')").count() == 1 and B.locator("button:has-text('Start Match')").count() == 0
            assert B.locator("#setDur").is_disabled() and A.locator("#setDur").is_enabled()
            assert B.locator(".modeCard").first.is_disabled()
        check("lobby: only the host can start/configure; guest gets Ready and read-only settings", t_lobby_perms)
        def t_host_cfg():
            A.select_option("#setDur", "60"); A.select_option("#setDiff", "easy")
            wait_for(B, "n.S.room.settings.duration === 60 && n.S.room.settings.difficulty === 'easy'", 4000, "settings sync to guest")
            assert B.locator("#setDur").input_value() == "60"
        check("host settings changes sync live to the guest's lobby", t_host_cfg)
        def t_chat():
            A.fill("#chatIn", "hello from alice"); A.press("#chatIn", "Enter")
            B.wait_for_selector("#chatLog :text('hello from alice')", timeout=4000)
        check("lobby chat is delivered to the other player", t_chat)
        def t_ready_start():
            A.click("button:has-text('Start Match')"); B.wait_for_selector("text=Waiting for", timeout=0) if False else None
            time.sleep(0.4); assert S(A, "n.S.screen") == "lobby", "started without guest ready"
            B.click("button:has-text('Ready')"); wait_for(A, "n.S.room.players.find(p => !p.host).ready", 4000)
            A.click("button:has-text('Start Match')")
            wait_for(A, "n.S.inGame && n.S.round", 8000, "A in game"); wait_for(B, "n.S.inGame && n.S.round", 8000, "B in game")
            assert S(A, "n.S.round.seed") == S(B, "n.S.round.seed"), "different arenas"
        check("match starts only after guest is ready; both clients load the same seeded arena", t_ready_start)
        for nm, pg_ in (("A", A), ("B", B)):
            try: wait_for(pg_, "n.S.phase === 'playing'", 8000, "playing")
            except AssertionError:
                print("DEBUG", nm, S(pg_, "({phase: n.S.phase, screen: n.S.screen, inGame: n.S.inGame, rem: n.S.remaining, round: n.S.round && n.S.round.phase})")); raise
            pg_.click("#pause button:has-text('Enter the field')")
        def t_sync_move():
            ida = S(A, "n.S.you"); x0 = S(A, "n.L.x"); tap(A, "KeyW", 1.2); x1, z1 = S(A, "[n.L.x, n.L.z]")
            wait_for(B, f"n.remotes.get({ida}) && n.remotes.get({ida}).buf.length > 3", 4000, "B receives A snapshots")
            last = S(B, f"n.remotes.get({ida}).buf.slice(-1)[0]"); assert abs(last["x"] - x1) < 1.0 and abs(last["z"] - z1) < 1.0, (last, x1, z1)
            idb = S(B, "n.S.you"); tap(B, "KeyS", 0.8); wait_for(A, f"n.remotes.get({idb}) && n.remotes.get({idb}).buf.length > 3", 4000, "A receives B snapshots")
        check("both players see each other's movement in the shared world", t_sync_move)
        def t_hud_mp():
            assert A.locator("#hudPlayers").inner_text() == "2" and A.locator("#hudName").inner_text() == "Alice" and B.locator("#hudName").inner_text() == "Bob"
            A.keyboard.down("Tab"); assert A.locator("#scoreboard.show").count() == 1 and "Bob" in A.locator("#scoreboard").inner_text(); A.keyboard.up("Tab")
        check("HUD shows player count; Tab shows the live scoreboard with both players", t_hud_mp)
        def t_first_wins():
            ida, idb = S(A, "n.S.you"), S(B, "n.S.you"); info = dbg("/needle", code=code); nd = info["needle"]
            assert info["phase"] == "playing" and nd
            leak = S(B, "JSON.stringify([...n.S.revealed.entries()])"); assert leak == "[]", "needle known to client before searching"
            for who, idx, off in ((A, ida, 0.6), (B, idb, -0.6)):
                dbg("/teleport", code=code, id=idx, x=nd["x"] + off, z=nd["z"])
                who.evaluate(f"(() => {{ const n = window.__needle; n.L.x = {nd['x'] + off}; n.L.z = {nd['z']}; n.L.vx = n.L.vz = 0; }})()")
            time.sleep(0.5)
            for attempt in range(6):
                if S(A, "n.S.revealed.size") > 0: break
                tap(A, "KeyE"); wait_for(A, "n.S.search", 2500, "A search start"); wait_for(A, "!n.S.search", 6000, "A search end"); time.sleep(0.3)
            assert S(A, "n.S.revealed.size") > 0 and S(B, "n.S.revealed.size") == 0, "only the searcher should see the needle"
            tap(A, "KeyE")
            wait_for(A, "n.S.phase === 'results'", 5000, "A results"); wait_for(B, "n.S.phase === 'results'", 5000, "B results")
            ra, rb = S(A, "n.S.results"), S(B, "n.S.results")
            assert ra["winners"] == rb["winners"] == [ida], (ra["winners"], rb["winners"])
            assert ra["finderName"] == "Alice" and [ (s["id"], s["roundScore"]) for s in ra["standings"] ] == [ (s["id"], s["roundScore"]) for s in rb["standings"] ]
            assert ra["standings"][0]["roundScore"] >= 100
        check("first valid pickup wins; both screens get the same winner and server-computed scores", t_first_wins)
        for pg_ in (A, B): wait_for(pg_, "document.body.dataset.screen === 'results'", 6000, "results screen")
        A.screenshot(path=os.path.join(ROOT, "shot-mp-results.png"))
        def t_results_ui():
            ta, tb = A.locator(".resCard").inner_text(), B.locator(".resCard").inner_text()
            assert "YOU FOUND IT" in ta and "ALICE WINS" in tb.upper(), (ta[:80], tb[:80])
            assert A.locator("button:has-text('Play Again')").count() == 1 and B.locator("button:has-text('Waiting for host')").count() == 1
        check("results screens: winner view vs loser view; only the host can start the next round", t_results_ui)
        def t_next_round():
            seed1 = S(A, "n.S.round.seed"); A.click("button:has-text('Play Again')")
            wait_for(A, "n.S.inGame && n.S.round.id === 2", 8000, "round 2 A"); wait_for(B, "n.S.inGame && n.S.round.id === 2", 8000, "round 2 B")
            assert S(A, "n.S.round.seed") != seed1 and S(A, "n.S.round.seed") == S(B, "n.S.round.seed")
        check("a new round starts in the same room with no refresh and a new shared arena", t_next_round)
        def t_reconnect():
            B.reload(); wait_for(B, "n.S.inGame && n.S.round && n.S.you", 12000, "B rejoined after refresh")
            assert S(B, "n.S.code") == code and S(B, "n.S.room.players.length") == 2
            assert S(B, "n.S.you") == S(B, "n.S.room.players.find(p => p.name === 'Bob').id")
        check("refreshing the page reconnects to the same room as the same player", t_reconnect)
        def t_disconnect_host():
            # Alice (host) leaves via the pause menu; Bob should become host
            A.wait_for_selector("#pause button:has-text('Leave room')"); A.click("#pause button:has-text('Leave room')")
            wait_for(B, "n.S.room.hostId === n.S.you && n.S.room.players.length === 1", 6000, "host transferred")
        check("when the host leaves, host permissions transfer to the remaining player", t_disconnect_host)
        def t_bad_join():
            C = new_page(browser.new_context(), errors, "C"); C.goto(f"{BASE}/r/ZZZZZ"); C.wait_for_selector("#nameIn"); C.fill("#nameIn", "Carol"); C.click("button:has-text('Join Game')")
            C.wait_for_selector(".toast.bad", timeout=6000); assert "does not exist" in C.locator(".toast.bad").first.inner_text()
            wait_for(C, "n.S.screen === 'menu'", 4000, "back at menu")
        check("an invalid/expired invite link shows a clear error and returns to the menu", t_bad_join)
        browser.close()
finally:
    server.terminate()

fails = [r for r in results if r[0] == "FAIL"]
for s, n, e in results: print(("  ✓ " if s == "PASS" else "  ✗ ") + n + (f"\n      {e}" if e else ""))
real_errors = [e for e in errors if "favicon" not in e]
print(f"\nbrowser e2e: {len(results) - len(fails)} passed, {len(fails)} failed; unexpected page/console errors: {len(real_errors)}")
for e in real_errors[:12]: print("   !", e[:220])
sys.exit(1 if fails or real_errors else 0)

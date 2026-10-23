from playwright.sync_api import sync_playwright
import os
os.makedirs('frames',exist_ok=True)
FPS=30;DUR=17.6
with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page(viewport={'width':1280,'height':720},device_scale_factor=1.5)
    pg.goto('file:///workspace/work/ownkey-film/film.html');pg.wait_for_timeout(300)
    for i in range(int(FPS*DUR)):
        pg.evaluate(f'render({i/FPS})');pg.screenshot(path=f'frames/f{i:04d}.png')
    b.close()

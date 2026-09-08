/**
 * Автотесты лендинга VERITAS.
 *
 * Запуск:  node test/qa-landing.js
 * Скриншоты складываются в test/screenshots/
 *
 * Проверяет то, что ломается чаще всего при правках вёрстки:
 * битые картинки, несуществующие якоря навигации, форму, мобильное меню,
 * cookie-баннер, горизонтальный скролл, ошибки в консоли, разновысокие карточки.
 *
 * ВАЖНО: зелёный прогон — не повод говорить «готово».
 * Тесты не видят содержимое картинок и композицию — скриншоты надо смотреть глазами,
 * а результат проверять на живой ссылке, а не только локально.
 */

const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const FILE_URL = 'file://' + path.join(ROOT, 'index.html').split(path.sep).join('/');
const SHOTS = path.join(__dirname, 'screenshots');

const results = [];
function check(name, passed, details) {
  results.push({ name, passed, details });
  console.log(`${passed ? 'OK  ' : 'FAIL'}  ${name}${details ? ' — ' + details : ''}`);
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });

  // ---------- Десктоп ----------
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(FILE_URL, { waitUntil: 'networkidle0' });

  // Прокрутить страницу целиком, иначе loading="lazy" картинки ещё не загружены
  // и проверка ниже даст ложные срабатывания.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise(r => setTimeout(r, 700));
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 300));

  const broken = await page.evaluate(() =>
    Array.from(document.images)
      .filter(i => !i.complete || i.naturalWidth === 0)
      .map(i => i.getAttribute('src'))
  );
  check('Все картинки загрузились', broken.length === 0, broken.join(', '));

  const badAnchors = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="#"]'))
      .map(a => a.getAttribute('href').slice(1))
      .filter(id => id && !document.getElementById(id))
  );
  check('Все якоря навигации ведут на существующие секции', badAnchors.length === 0, badAnchors.join(', '));

  const legalLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="legal/"]')).map(a => a.getAttribute('href'))
  );
  const missingLegal = legalLinks.filter(href => !fs.existsSync(path.join(ROOT, href)));
  check('Юридические страницы на месте', missingLegal.length === 0, missingLegal.join(', '));

  // Карточки в ряду одной высоты (Пантела ловит разновысокие как дефект вёрстки)
  const rowGroups = ['.review-card', '.price-card', '.practice-card'];
  for (const sel of rowGroups) {
    const heights = await page.evaluate(s =>
      Array.from(document.querySelectorAll(s)).map(el => Math.round(el.getBoundingClientRect().height)), sel);
    const uneven = heights.length > 1 && (Math.max(...heights) - Math.min(...heights)) > 2;
    // price-card: у среднего тарифа намеренный подъём/акцент, разница по высоте допустима
    if (sel === '.price-card') {
      check(`Карточки ${sel} отрисовались`, heights.length === 3, heights.join(' / '));
    } else {
      check(`Карточки ${sel} одной высоты`, !uneven, heights.join(' / '));
    }
  }

  // Форма: заполнить и отправить
  await page.type('textarea[name="situation"]', 'Тестовый вопрос: раздел имущества после развода');
  await page.type('input[name="name"]', 'Иван Тестов');
  await page.type('input[name="phone"]', '+7 999 123-45-67');
  await page.click('.consent-check input[type="checkbox"]');
  await page.click('#contactForm button[type="submit"]');
  await new Promise(r => setTimeout(r, 400));
  const formOk = await page.evaluate(() => {
    const el = document.getElementById('formSuccess');
    return el.classList.contains('show') && getComputedStyle(el).display !== 'none';
  });
  check('Форма отправляется и показывает подтверждение', formOk);

  await page.screenshot({ path: path.join(SHOTS, 'desktop-full.jpg'), type: 'jpeg', quality: 60, fullPage: true });

  // ---------- Мобильный ----------
  const mob = await browser.newPage();
  const mobErrors = [];
  mob.on('console', m => { if (m.type() === 'error') mobErrors.push(m.text()); });
  mob.on('pageerror', e => mobErrors.push('PAGEERROR: ' + e.message));

  await mob.setViewport({ width: 390, height: 844, isMobile: true });
  await mob.goto(FILE_URL, { waitUntil: 'networkidle0' });

  const overflow = await mob.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  check('Нет горизонтального скролла на 390px', !overflow);

  await mob.click('#navToggle');
  await new Promise(r => setTimeout(r, 300));
  const navOpen = await mob.evaluate(() => document.getElementById('navMobile').classList.contains('open'));
  check('Мобильное меню открывается', navOpen);

  await mob.screenshot({ path: path.join(SHOTS, 'mobile-nav-open.jpg'), type: 'jpeg', quality: 60 });

  await mob.click('#navToggle');
  await new Promise(r => setTimeout(r, 300));
  const navClosed = await mob.evaluate(() => !document.getElementById('navMobile').classList.contains('open'));
  check('Мобильное меню закрывается', navClosed);

  const cookieShown = await mob.evaluate(() => new Promise(res => {
    setTimeout(() => res(document.getElementById('cookieBanner').classList.contains('show')), 1200);
  }));
  check('Cookie-баннер появляется', cookieShown);

  await mob.click('#cookieAccept');
  await new Promise(r => setTimeout(r, 500));
  const cookieHidden = await mob.evaluate(() =>
    !document.getElementById('cookieBanner').classList.contains('show') &&
    localStorage.getItem('veritas_cookie_consent') === '1'
  );
  check('Cookie-баннер скрывается и запоминает согласие', cookieHidden);

  await mob.screenshot({ path: path.join(SHOTS, 'mobile-full.jpg'), type: 'jpeg', quality: 60, fullPage: true });

  check('Нет ошибок в консоли (десктоп)', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('Нет ошибок в консоли (мобильный)', mobErrors.length === 0, mobErrors.join(' | '));

  await browser.close();

  const failed = results.filter(r => !r.passed);
  console.log(`\nПройдено ${results.length - failed.length} из ${results.length}`);
  console.log(`Скриншоты: ${SHOTS} — посмотреть глазами, тесты не видят композицию и содержимое картинок.`);
  if (failed.length) {
    console.log('\nНе прошли:');
    failed.forEach(f => console.log(' - ' + f.name + (f.details ? ': ' + f.details : '')));
    process.exit(1);
  }
})();
